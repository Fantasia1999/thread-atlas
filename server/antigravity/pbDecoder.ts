import { createDecipheriv } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadBundledDescriptorFiles, loadExtensionDescriptorFiles } from "./descriptors.js";
import { extractText, stepPayload } from "./records.js";
import { ANTIGRAVITY_KEY, arrayOfRecords, isRecord } from "./shared.js";
import { bufferFieldValue, byteFieldValues, decodeZigZag, formatTimestamp, normalizeJsonName, numberFieldValue, parseProtobufField, protobufFieldsDict, readLittleEndianNumber, readVarint } from "./protoUtils.js";

const TRAJECTORY_PROTO_PATHS = [
  "exa/gemini_coder/proto/trajectory.proto",
  "third_party/gemini_coder/proto/trajectory.proto"
];

const PROTO_FIELD_TYPES: Record<number, string> = {
  1: "double",
  2: "float",
  3: "int64",
  4: "uint64",
  5: "int32",
  6: "fixed64",
  7: "fixed32",
  8: "bool",
  9: "string",
  10: "group",
  11: "message",
  12: "bytes",
  13: "uint32",
  14: "enum",
  15: "sfixed32",
  16: "sfixed64",
  17: "sint32",
  18: "sint64"
};

const PROTO_FIELD_LABELS: Record<number, string> = {
  1: "optional",
  2: "required",
  3: "repeated"
};
interface EnumDescriptor {
  fullName: string;
  valuesByNumber: Map<number, string>;
}

interface FieldDescriptor {
  name: string;
  jsonName: string;
  number: number;
  label: string;
  kind: string;
  typeName?: string;
  oneofIndex?: number;
  map: boolean;
}

interface MessageDescriptor {
  fullName: string;
  fieldsByNumber: Map<number, FieldDescriptor>;
  isMapEntry: boolean;
}
export type DescriptorSource = "bundled" | "extension";

export interface DecodedTrajectoryResult {
  descriptorSource: DescriptorSource;
  trajectory: Record<string, unknown>;
}
export class DirectPbDecoder {
  private readonly loadedFiles = new Set<string>();
  private readonly messages = new Map<string, MessageDescriptor>();
  private readonly enums = new Map<string, EnumDescriptor>();

  private constructor(private readonly descriptorFiles: Map<string, Buffer>) {}

  static fromDescriptorFiles(descriptorFiles: Map<string, Buffer>): DirectPbDecoder {
    const decoder = new DirectPbDecoder(descriptorFiles);
    decoder.loadTrajectoryDescriptors();
    return decoder;
  }

  async decodeTrajectoryFile(
    absolutePath: string,
    cascadeId?: string
  ): Promise<Record<string, unknown>> {
    const encrypted = await fs.readFile(absolutePath);
    const plaintext = this.decryptPbFile(encrypted, absolutePath);
    const trajectory = this.decodeMessage(".gemini_coder.Trajectory", plaintext);
    if (cascadeId && isRecord(trajectory) && !trajectory.cascadeId) {
      trajectory.cascadeId = cascadeId;
    }
    return isRecord(trajectory) ? trajectory : { cascadeId };
  }

  async decodeTrajectoryDbFile(
    absolutePath: string,
    cascadeId?: string
  ): Promise<Record<string, unknown>> {
    const db = new DatabaseSync(absolutePath);
    let trajectoryId = "";
    let finalCascadeId = cascadeId ?? "";

    try {
      const metaRow = db.prepare("SELECT trajectory_id, cascade_id FROM trajectory_meta LIMIT 1;").get() as any;
      if (metaRow) {
        trajectoryId = metaRow.trajectory_id ?? "";
        finalCascadeId = metaRow.cascade_id ?? finalCascadeId;
      }
    } catch {
      // Ignore meta query errors
    }

    const steps: any[] = [];
    try {
      const query = db.prepare("SELECT idx, step_payload FROM steps ORDER BY idx;");
      const rows = query.all() as any[];
      for (const row of rows) {
        if (row.step_payload) {
          try {
            const step = this.decodeMessage(".gemini_coder.Step", Buffer.from(row.step_payload));
            steps.push(step);
          } catch {
            // Ignore individual step decode errors
          }
        }
      }
    } catch {
      // Ignore query errors
    }

    return {
      cascadeId: finalCascadeId,
      trajectoryId,
      steps
    };
  }

  private loadTrajectoryDescriptors(): void {
    let loadedTrajectory = false;

    for (const protoPath of TRAJECTORY_PROTO_PATHS) {
      if (!this.descriptorFiles.has(protoPath)) {
        continue;
      }

      this.loadFileDescriptor(protoPath);
      loadedTrajectory = true;
      break;
    }

    if (!loadedTrajectory) {
      throw new Error("Failed to locate Antigravity trajectory descriptor.");
    }

    for (const protoPath of this.descriptorFiles.keys()) {
      this.loadFileDescriptor(protoPath);
    }
  }

  private decryptPbFile(data: Buffer, absolutePath: string): Buffer {
    if (data.length < 28) {
      throw new Error(`Encrypted .pb is too short: ${absolutePath}`);
    }

    const nonce = data.subarray(0, 12);
    const ciphertext = data.subarray(12, data.length - 16);
    const tag = data.subarray(data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", ANTIGRAVITY_KEY, nonce);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error(`Failed to decrypt Antigravity .pb: ${absolutePath}`);
    }
  }

  private loadFileDescriptor(protoPath: string): void {
    if (this.loadedFiles.has(protoPath)) {
      return;
    }

    if (protoPath === "google/protobuf/timestamp.proto") {
      this.loadedFiles.add(protoPath);
      return;
    }

    const rawDescriptor = this.descriptorFiles.get(protoPath);
    if (!rawDescriptor) {
      throw new Error(`Missing protobuf descriptor for ${protoPath}`);
    }

    const descriptorFields = protobufFieldsDict(rawDescriptor);
    const packageName = bufferFieldValue(descriptorFields, 2)?.toString("utf8");
    if (!packageName) {
      throw new Error(`Invalid protobuf descriptor for ${protoPath}`);
    }

    this.loadedFiles.add(protoPath);

    for (const dependency of descriptorFields.get(3) ?? []) {
      if (!Buffer.isBuffer(dependency.value)) {
        continue;
      }

      const dependencyPath = dependency.value.toString("utf8");
      if (this.descriptorFiles.has(dependencyPath) || dependencyPath === "google/protobuf/timestamp.proto") {
        this.loadFileDescriptor(dependencyPath);
      }
    }

    for (const enumBuffer of byteFieldValues(descriptorFields, 5)) {
      this.parseEnumDescriptor(enumBuffer, packageName, "");
    }
    for (const messageBuffer of byteFieldValues(descriptorFields, 4)) {
      this.parseMessageDescriptor(messageBuffer, packageName, "");
    }
  }

  private parseEnumDescriptor(buffer: Buffer, packageName: string, prefix: string): void {
    const values = protobufFieldsDict(buffer);
    const name = bufferFieldValue(values, 1)?.toString("utf8");
    if (!name) {
      return;
    }

    const fullName = prefix ? `.${packageName}.${prefix}${name}` : `.${packageName}.${name}`;
    const valuesByNumber = new Map<number, string>();

    for (const enumValueBuffer of byteFieldValues(values, 2)) {
      const enumValues = protobufFieldsDict(enumValueBuffer);
      const valueName = bufferFieldValue(enumValues, 1)?.toString("utf8");
      const valueNumber = numberFieldValue(enumValues, 2);
      if (valueName && typeof valueNumber === "number") {
        valuesByNumber.set(valueNumber, valueName);
      }
    }

    this.enums.set(fullName, {
      fullName,
      valuesByNumber
    });
  }

  private parseFieldDescriptor(buffer: Buffer): FieldDescriptor | undefined {
    const values = protobufFieldsDict(buffer);
    const name = bufferFieldValue(values, 1)?.toString("utf8");
    if (!name) {
      return undefined;
    }

    const jsonName =
      bufferFieldValue(values, 10)?.toString("utf8") ?? normalizeJsonName(name);
    const number = numberFieldValue(values, 3);
    if (typeof number !== "number") {
      return undefined;
    }

    return {
      name,
      jsonName,
      number,
      label: PROTO_FIELD_LABELS[numberFieldValue(values, 4) ?? 1] ?? "optional",
      kind: PROTO_FIELD_TYPES[numberFieldValue(values, 5) ?? 0] ?? "unknown",
      typeName: bufferFieldValue(values, 6)?.toString("utf8"),
      oneofIndex: numberFieldValue(values, 9),
      map: false
    };
  }

  private parseMessageDescriptor(
    buffer: Buffer,
    packageName: string,
    prefix: string
  ): MessageDescriptor | undefined {
    const values = protobufFieldsDict(buffer);
    const name = bufferFieldValue(values, 1)?.toString("utf8");
    if (!name) {
      return undefined;
    }

    const fullName = prefix ? `.${packageName}.${prefix}${name}` : `.${packageName}.${name}`;
    let isMapEntry = false;
    const optionsBuffer = bufferFieldValue(values, 7);
    if (optionsBuffer) {
      const options = protobufFieldsDict(optionsBuffer);
      isMapEntry = numberFieldValue(options, 7) === 1;
    }

    const fieldsByNumber = new Map<number, FieldDescriptor>();
    const messageDescriptor: MessageDescriptor = {
      fullName,
      fieldsByNumber,
      isMapEntry
    };

    this.messages.set(fullName, messageDescriptor);

    const nestedPrefix = `${prefix}${name}.`;
    for (const enumBuffer of byteFieldValues(values, 4)) {
      this.parseEnumDescriptor(enumBuffer, packageName, nestedPrefix);
    }
    for (const nestedBuffer of byteFieldValues(values, 3)) {
      this.parseMessageDescriptor(nestedBuffer, packageName, nestedPrefix);
    }

    for (const fieldBuffer of byteFieldValues(values, 2)) {
      const field = this.parseFieldDescriptor(fieldBuffer);
      if (!field) {
        continue;
      }

      if (
        field.kind === "message" &&
        field.typeName &&
        this.messages.get(field.typeName)?.isMapEntry
      ) {
        field.map = true;
      }

      fieldsByNumber.set(field.number, field);
    }

    return messageDescriptor;
  }

  decodeMessage(typeName: string, buffer: Buffer): unknown {
    if (typeName === ".google.protobuf.Timestamp") {
      const timestampFields = protobufFieldsDict(buffer);
      return formatTimestamp(numberFieldValue(timestampFields, 1) ?? 0, numberFieldValue(timestampFields, 2) ?? 0);
    }

    const descriptor = this.messages.get(typeName);
    if (!descriptor) {
      return {
        _type: typeName,
        _raw_hex: buffer.toString("hex")
      };
    }

    let offset = 0;
    const output: Record<string, unknown> = {};
    while (offset < buffer.length) {
      const parsed = parseProtobufField(buffer, offset);
      offset = parsed.nextOffset;

      const field = descriptor.fieldsByNumber.get(parsed.fieldNumber);
      if (!field) {
        continue;
      }

      const key = field.jsonName;

      if (field.map && field.typeName && Buffer.isBuffer(parsed.value)) {
        const entry = this.decodeMessage(field.typeName, parsed.value);
        if (isRecord(entry) && "key" in entry && "value" in entry) {
          const mapValue = output[key];
          const nextMap = isRecord(mapValue) ? mapValue : {};
          nextMap[String(entry.key)] = entry.value;
          output[key] = nextMap;
        }
        continue;
      }

      if (
        field.label === "repeated" &&
        Buffer.isBuffer(parsed.value) &&
        !["message", "string", "bytes"].includes(field.kind)
      ) {
        const packed = this.decodePackedRepeated(field, parsed.value);
        const current = Array.isArray(output[key]) ? output[key] : [];
        output[key] = [...current, ...packed];
        continue;
      }

      const decoded = this.decodeValue(field, parsed.value);
      if (field.label === "repeated") {
        const current = Array.isArray(output[key]) ? output[key] : [];
        output[key] = [...current, decoded];
      } else {
        output[key] = decoded;
      }
    }

    return output;
  }

  private decodeValue(field: FieldDescriptor, value: number | Buffer): unknown {
    if (field.kind === "message" && field.typeName && Buffer.isBuffer(value)) {
      return this.decodeMessage(field.typeName, value);
    }

    if (field.kind === "enum" && field.typeName && typeof value === "number") {
      return this.enums.get(field.typeName)?.valuesByNumber.get(value) ?? value;
    }

    if (field.kind === "string" && Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }

    if (field.kind === "bytes" && Buffer.isBuffer(value)) {
      try {
        return value.toString("utf8");
      } catch {
        return value.toString("hex");
      }
    }

    if (field.kind === "bool" && typeof value === "number") {
      return Boolean(value);
    }

    if (field.kind === "sint32" || field.kind === "sint64") {
      return typeof value === "number" ? decodeZigZag(value) : value;
    }

    return value;
  }

  private decodePackedRepeated(field: FieldDescriptor, buffer: Buffer): unknown[] {
    const values: unknown[] = [];

    if (
      [
        "int32",
        "int64",
        "uint32",
        "uint64",
        "bool",
        "enum",
        "sint32",
        "sint64"
      ].includes(field.kind)
    ) {
      let offset = 0;
      while (offset < buffer.length) {
        const decoded = readVarint(buffer, offset);
        offset = decoded.nextOffset;
        values.push(this.decodeValue(field, decoded.value));
      }
      return values;
    }

    const size =
      field.kind === "fixed32" || field.kind === "sfixed32" || field.kind === "float"
        ? 4
        : field.kind === "fixed64" || field.kind === "sfixed64" || field.kind === "double"
          ? 8
          : 0;
    if (!size) {
      return values;
    }

    for (let offset = 0; offset + size <= buffer.length; offset += size) {
      const chunk = buffer.subarray(offset, offset + size);
      values.push(this.decodeValue(field, readLittleEndianNumber(chunk)));
    }

    return values;
  }
}
export async function decodeAntigravityTrajectory(
  absolutePath: string
): Promise<DecodedTrajectoryResult> {
  const cascadeId = path.basename(absolutePath, ".pb");
  const bundledAttempt = await tryDecodeAntigravityTrajectory(
    absolutePath,
    cascadeId,
    "bundled",
    loadBundledDescriptorFiles()
  );

  if (bundledAttempt && isTrajectoryDecodeUsable(bundledAttempt.trajectory)) {
    return bundledAttempt;
  }

  const extensionDescriptors = await loadExtensionDescriptorFiles();
  if (extensionDescriptors) {
    const extensionAttempt = await tryDecodeAntigravityTrajectory(
      absolutePath,
      cascadeId,
      "extension",
      extensionDescriptors
    );
    if (extensionAttempt && isTrajectoryDecodeUsable(extensionAttempt.trajectory)) {
      return extensionAttempt;
    }
    if (extensionAttempt) {
      return extensionAttempt;
    }
  }

  if (bundledAttempt) {
    return bundledAttempt;
  }

  throw new Error("Failed to decode Antigravity trajectory with bundled or extension descriptors.");
}
export async function tryDecodeAntigravityTrajectory(
  absolutePath: string,
  cascadeId: string,
  descriptorSource: DescriptorSource,
  descriptorFiles: Map<string, Buffer>
): Promise<DecodedTrajectoryResult | null> {
  try {
    const decoder = DirectPbDecoder.fromDescriptorFiles(descriptorFiles);
    const isDb = absolutePath.toLowerCase().endsWith(".db");
    const trajectory = isDb
      ? await decoder.decodeTrajectoryDbFile(absolutePath, cascadeId)
      : await decoder.decodeTrajectoryFile(absolutePath, cascadeId);
    return {
      descriptorSource,
      trajectory
    };
  } catch {
    return null;
  }
}

let sharedDecoderInstance: DirectPbDecoder | undefined;

export function getSharedDirectPbDecoder(): DirectPbDecoder {
  if (!sharedDecoderInstance) {
    sharedDecoderInstance = DirectPbDecoder.fromDescriptorFiles(loadBundledDescriptorFiles());
  }
  return sharedDecoderInstance;
}
export function isTrajectoryDecodeUsable(trajectory: Record<string, unknown>): boolean {
  const steps = arrayOfRecords(trajectory.steps);
  if (steps.length === 0) {
    return false;
  }

  return steps.some((step) => {
    const stepType = String(step.type ?? "");
    const [, payload] = stepPayload(step);
    if (extractText(stepType, payload)) {
      return true;
    }
    return hasDecodedPayload(payload);
  });
}

export function hasDecodedPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasDecodedPayload(entry));
  }
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value).filter((key) => !key.startsWith("_"));
  if (keys.length === 0) {
    return false;
  }

  return keys.some((key) => hasDecodedPayload(value[key]));
}
