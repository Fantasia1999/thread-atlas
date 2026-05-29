import { createDecipheriv } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { MetadataValue, SessionBundle, SessionDescriptor } from "../src/parsers/types.js";
import { BUNDLED_ANTIGRAVITY_DESCRIPTORS } from "./antigravityDescriptors.js";
import { extractAntigravityPreviewTitle } from "../src/parsers/antigravity.js";

const ANTIGRAVITY_KEY = Buffer.from("safeCodeiumworldKeYsecretBalloon", "utf8");
const EXTENSION_DESCRIPTOR_REGEX = /fileDesc\)\("([A-Za-z0-9+/=]+)"/g;
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

const TOOL_STEP_TYPES = new Set([
  "CORTEX_STEP_TYPE_RUN_COMMAND",
  "CORTEX_STEP_TYPE_VIEW_FILE",
  "CORTEX_STEP_TYPE_LIST_DIRECTORY",
  "CORTEX_STEP_TYPE_GREP_SEARCH",
  "CORTEX_STEP_TYPE_CODE_ACTION",
  "CORTEX_STEP_TYPE_COMMAND_STATUS"
]);

interface ProtoFieldValue {
  wireType: number;
  value: number | Buffer;
}

type ProtoFieldMap = Map<number, ProtoFieldValue[]>;

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

interface AntigravityData {
  cascadeId: string;
  summary: Record<string, unknown>;
  trajectory: Record<string, unknown>;
}

type DescriptorSource = "bundled" | "extension";

interface DecodedTrajectoryResult {
  descriptorSource: DescriptorSource;
  trajectory: Record<string, unknown>;
}

let bundledDescriptorFiles: Map<string, Buffer> | undefined;
let extensionDescriptorFileMapPromise: Promise<Map<string, Buffer> | null> | undefined;

export function isAntigravityConversationPath(absolutePath: string): boolean {
  const normalized = absolutePath.replaceAll("\\", "/").toLowerCase();
  return (
    (normalized.includes("/.gemini/antigravity/conversations/") ||
      normalized.includes("/.gemini/antigravity-cli/conversations/") ||
      normalized.includes("/.gemini/antigravity-cli/implicit/")) &&
    normalized.endsWith(".pb")
  );
}

export function isAntigravityTranscriptPath(absolutePath: string): boolean {
  const normalized = absolutePath.replaceAll("\\", "/").toLowerCase();
  return (
    (normalized.includes("/.gemini/antigravity/brain/") ||
      normalized.includes("/.gemini/antigravity-cli/brain/")) &&
    normalized.endsWith("/.system_generated/logs/transcript_full.jsonl")
  );
}

export function antigravitySessionIdFromPath(absolutePath: string): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const brainMatch = normalized.match(/\/brain\/([^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/i);
  if (brainMatch?.[1]) {
    return brainMatch[1];
  }

  if (isAntigravityConversationPath(absolutePath)) {
    return path.basename(absolutePath, ".pb");
  }

  return undefined;
}

export async function resolvePreferredAntigravitySessionPath(
  absolutePath: string
): Promise<string | undefined> {
  if (isAntigravityTranscriptPath(absolutePath)) {
    if (await isParseableJsonLinesFile(absolutePath)) {
      return absolutePath;
    }

    const fallback = resolveConversationPathFromTranscriptPath(absolutePath);
    return fallback && (await fileExists(fallback)) ? fallback : undefined;
  }

  if (!isAntigravityConversationPath(absolutePath)) {
    return undefined;
  }

  const cascadeId = path.basename(absolutePath, ".pb");
  const transcriptPath = resolveTranscriptPathFromConversationPath(absolutePath, cascadeId);
  if (transcriptPath && (await isParseableJsonLinesFile(transcriptPath))) {
    return transcriptPath;
  }

  return absolutePath;
}

export async function isScannableAntigravitySessionPath(absolutePath: string): Promise<boolean> {
  if (isAntigravityTranscriptPath(absolutePath)) {
    return await isParseableJsonLinesFile(absolutePath);
  }

  if (!isAntigravityConversationPath(absolutePath)) {
    return false;
  }

  try {
    const { trajectory } = await decodeAntigravityTrajectory(absolutePath);
    return isTrajectoryDecodeUsable(trajectory);
  } catch {
    return false;
  }
}

export function buildAntigravityDescriptor(
  absolutePath: string,
  origin: "local" | "remote",
  stats: {
    size: number;
    mtimeMs: number;
  },
  content?: string
): SessionDescriptor {
  const cascadeId = antigravitySessionIdFromPath(absolutePath) ?? path.basename(absolutePath);
  const loaderBackend = isAntigravityTranscriptPath(absolutePath) ? "transcript" : "direct";

  let title: string | undefined;
  if (content) {
    title = extractAntigravityPreviewTitle(content);
  }

  return {
    key: `file::${absolutePath}`,
    source: "antigravity",
    title: title ?? (isAntigravityTranscriptPath(absolutePath)
      ? buildAntigravityTitle(cascadeId)
      : path.basename(absolutePath)),
    primaryPath: absolutePath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 1,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    metadata: {
      cascadeId,
      loaderBackend
    }
  };
}

async function decodeAntigravityTrajectory(
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

async function findWorkspaceFromHistory(cascadeId: string): Promise<string | undefined> {
  try {
    const historyPath = path.join(os.homedir(), ".gemini", "antigravity-cli", "history.jsonl");
    const content = await fs.readFile(historyPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.conversationId === cascadeId && typeof entry.workspace === "string" && entry.workspace.trim()) {
          return entry.workspace;
        }
      } catch {
        // Ignore JSON parsing errors
      }
    }
  } catch {
    // Ignore file reading errors
  }
  return undefined;
}

export async function loadAntigravityBundle(
  absolutePath: string,
  origin: "local" | "remote"
): Promise<SessionBundle> {
  const preferredPath = await resolvePreferredAntigravitySessionPath(absolutePath);
  if (preferredPath && preferredPath !== absolutePath) {
    return await loadAntigravityBundle(preferredPath, origin);
  }

  if (isAntigravityTranscriptPath(absolutePath)) {
    return await loadAntigravityTranscriptBundle(absolutePath, origin);
  }

  const stats = await fs.stat(absolutePath);
  const { descriptorSource, trajectory } = await decodeAntigravityTrajectory(absolutePath);
  const cascadeId = String(trajectory.cascadeId ?? path.basename(absolutePath, ".pb"));
  const summary = synthesizeDirectSummary(cascadeId, trajectory);
  const brainDir = resolveBrainDirFromConversationPath(absolutePath, cascadeId);
  const data: AntigravityData = {
    cascadeId,
    summary,
    trajectory
  };
  const records = await buildChatRecords({
    data,
    sourceJson: null,
    brainDir
  });
  const historyWorkspace = await findWorkspaceFromHistory(cascadeId);
  const primaryWorkspace = historyWorkspace ?? extractPrimaryWorkspace(summary.workspaces);

  const recordsContent = records.map((record) => JSON.stringify(record)).join("\n");
  const firstUserTitle = extractAntigravityPreviewTitle(recordsContent);
  const title = firstUserTitle ?? buildAntigravityTitle(cascadeId, primaryWorkspace);

  const descriptor = buildAntigravityDescriptor(absolutePath, origin, stats, recordsContent);

  return {
    ...descriptor,
    title,
    metadata: {
      ...descriptor.metadata,
      trajectoryId: toMetadataValue(summary.trajectoryId),
      status: toMetadataValue(summary.status),
      stepCount: toMetadataValue(summary.stepCount),
      descriptorSource,
      primaryWorkspace: toMetadataValue(primaryWorkspace),
      workspaces: stringifyMetadata(summary.workspaces)
    },
    files: [
      {
        path: `${absolutePath}#chat.jsonl`,
        content: recordsContent
      }
    ]
  };
}

async function loadAntigravityTranscriptBundle(
  absolutePath: string,
  origin: "local" | "remote"
): Promise<SessionBundle> {
  const [stats, content] = await Promise.all([
    fs.stat(absolutePath),
    fs.readFile(absolutePath, "utf8")
  ]);
  const descriptor = buildAntigravityDescriptor(absolutePath, origin, stats, content);
  const cascadeId = antigravitySessionIdFromPath(absolutePath) ?? path.basename(absolutePath);
  const rows = parseJsonLines(content);
  const records = buildChatRecordsFromTranscriptRows(cascadeId, rows, absolutePath);
  const recordsContent = records.map((record) => JSON.stringify(record)).join("\n");
  const firstUserTitle = extractAntigravityPreviewTitle(recordsContent);
  const title = firstUserTitle ?? descriptor.title;

  const historyWorkspace = await findWorkspaceFromHistory(cascadeId);

  return {
    ...descriptor,
    title,
    metadata: {
      ...descriptor.metadata,
      stepCount: rows.length,
      loaderBackend: "transcript",
      primaryWorkspace: historyWorkspace ? String(historyWorkspace) : null
    },
    files: [
      {
        path: `${absolutePath}#chat.jsonl`,
        content: recordsContent
      }
    ]
  };
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

  private decodeMessage(typeName: string, buffer: Buffer): unknown {
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

async function tryDecodeAntigravityTrajectory(
  absolutePath: string,
  cascadeId: string,
  descriptorSource: DescriptorSource,
  descriptorFiles: Map<string, Buffer>
): Promise<DecodedTrajectoryResult | null> {
  try {
    const decoder = DirectPbDecoder.fromDescriptorFiles(descriptorFiles);
    const trajectory = await decoder.decodeTrajectoryFile(absolutePath, cascadeId);
    return {
      descriptorSource,
      trajectory
    };
  } catch {
    return null;
  }
}

export function loadBundledDescriptorFiles(): Map<string, Buffer> {
  if (!bundledDescriptorFiles) {
    bundledDescriptorFiles = descriptorMapFromBase64(BUNDLED_ANTIGRAVITY_DESCRIPTORS);
  }

  return bundledDescriptorFiles;
}

async function loadExtensionDescriptorFiles(): Promise<Map<string, Buffer> | null> {
  if (!extensionDescriptorFileMapPromise) {
    extensionDescriptorFileMapPromise = (async () => {
      try {
        const extensionPath = await discoverExtensionBundle();
        const extensionSource = await fs.readFile(extensionPath, "utf8");
        return descriptorMapFromExtensionSource(extensionSource);
      } catch {
        return null;
      }
    })();
  }

  return await extensionDescriptorFileMapPromise;
}

async function discoverExtensionBundle(): Promise<string> {
  const baseDir = path.join(os.homedir(), ".antigravity-server", "bin");
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const extensionPath = path.join(
          baseDir,
          entry.name,
          "extensions",
          "antigravity",
          "dist",
          "extension.js"
        );
        try {
          const stats = await fs.stat(extensionPath);
          return {
            path: extensionPath,
            mtimeMs: stats.mtimeMs
          };
        } catch {
          return undefined;
        }
      })
  );

  const latest = candidates
    .filter((candidate): candidate is { path: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) {
    throw new Error(`Antigravity extension bundle not found under ${baseDir}`);
  }

  return latest.path;
}

function descriptorMapFromBase64(source: Record<string, string>): Map<string, Buffer> {
  const descriptors = new Map<string, Buffer>();
  for (const [fileName, base64] of Object.entries(source)) {
    descriptors.set(fileName, Buffer.from(base64, "base64"));
  }
  return descriptors;
}

function descriptorMapFromExtensionSource(source: string): Map<string, Buffer> {
  const descriptors = new Map<string, Buffer>();

  for (const match of source.matchAll(EXTENSION_DESCRIPTOR_REGEX)) {
    const buffer = Buffer.from(match[1], "base64");
    const fileName = extractDescriptorFileName(buffer);
    if (fileName) {
      descriptors.set(fileName, buffer);
    }
  }

  if (descriptors.size === 0) {
    throw new Error("No protobuf descriptors found in Antigravity extension bundle.");
  }

  return descriptors;
}

function extractDescriptorFileName(buffer: Buffer): string | undefined {
  const fields = protobufFieldsDict(buffer);
  return bufferFieldValue(fields, 1)?.toString("utf8");
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decodeToolCall(toolCall: unknown): Record<string, unknown> | undefined {
  if (!isRecord(toolCall)) {
    return undefined;
  }

  const decoded: Record<string, unknown> = {
    id: toolCall.id,
    name: toolCall.name
  };
  if ("argumentsJson" in toolCall) {
    decoded.arguments = parseMaybeJson(toolCall.argumentsJson);
  }

  return decoded;
}

function stepPayload(step: Record<string, unknown>): [string | undefined, unknown] {
  const payloadKeys = Object.keys(step).filter(
    (key) => !["type", "status", "metadata"].includes(key)
  );
  if (payloadKeys.length === 0) {
    return [undefined, undefined];
  }
  if (payloadKeys.length === 1) {
    const key = payloadKeys[0];
    return [key, step[key]];
  }
  return [
    "payload",
    Object.fromEntries(payloadKeys.map((key) => [key, step[key]]))
  ];
}

function isTrajectoryDecodeUsable(trajectory: Record<string, unknown>): boolean {
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

function hasDecodedPayload(value: unknown): boolean {
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

function extractText(stepType: string, payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (stepType === "CORTEX_STEP_TYPE_USER_INPUT") {
    return asOptionalString(payload.userResponse);
  }
  if (stepType === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
    return (
      asOptionalString(payload.modifiedResponse) ??
      asOptionalString(payload.response) ??
      asOptionalString(payload.thinking) ??
      asOptionalString(payload.stopReason)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE") {
    return asOptionalString(payload.content);
  }
  if (stepType === "CORTEX_STEP_TYPE_ERROR_MESSAGE") {
    const error = isRecord(payload.error) ? payload.error : undefined;
    return (
      asOptionalString(error?.userErrorMessage) ??
      asOptionalString(error?.shortError) ??
      asOptionalString(error?.modelErrorMessage)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_RUN_COMMAND") {
    return asOptionalString(payload.combinedOutput) ?? asOptionalString(payload.commandLine);
  }
  if (stepType === "CORTEX_STEP_TYPE_VIEW_FILE") {
    return asOptionalString(payload.content);
  }
  if (stepType === "CORTEX_STEP_TYPE_NOTIFY_USER") {
    return asOptionalString(payload.notificationContent);
  }
  if (stepType === "CORTEX_STEP_TYPE_TASK_BOUNDARY") {
    return (
      asOptionalString(payload.taskSummary) ??
      asOptionalString(payload.taskStatus) ??
      asOptionalString(payload.taskName)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_COMMAND_STATUS") {
    return asOptionalString(payload.status);
  }
  if (stepType === "CORTEX_STEP_TYPE_CONVERSATION_HISTORY") {
    return asOptionalString(payload.content);
  }
  return undefined;
}

function extractArtifactUris(stepType: string, payload: unknown): string[] {
  if (stepType !== "CORTEX_STEP_TYPE_NOTIFY_USER" || !isRecord(payload)) {
    return [];
  }

  return Array.isArray(payload.reviewAbsoluteUris)
    ? payload.reviewAbsoluteUris.filter((uri): uri is string => typeof uri === "string")
    : [];
}

function inferRole(stepType: string): string {
  const mapping: Record<string, string> = {
    CORTEX_STEP_TYPE_USER_INPUT: "user",
    CORTEX_STEP_TYPE_PLANNER_RESPONSE: "assistant",
    CORTEX_STEP_TYPE_NOTIFY_USER: "assistant",
    CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE: "system",
    CORTEX_STEP_TYPE_ERROR_MESSAGE: "system",
    CORTEX_STEP_TYPE_RUN_COMMAND: "tool",
    CORTEX_STEP_TYPE_VIEW_FILE: "tool",
    CORTEX_STEP_TYPE_LIST_DIRECTORY: "tool",
    CORTEX_STEP_TYPE_GREP_SEARCH: "tool",
    CORTEX_STEP_TYPE_CODE_ACTION: "tool",
    CORTEX_STEP_TYPE_COMMAND_STATUS: "tool",
    CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS: "system",
    CORTEX_STEP_TYPE_CONVERSATION_HISTORY: "system",
    CORTEX_STEP_TYPE_CHECKPOINT: "system",
    CORTEX_STEP_TYPE_TASK_BOUNDARY: "system"
  };

  return mapping[stepType] ?? "system";
}

function compactSummaryText(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.split(/\s+/).join(" ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function latestStepByType(
  steps: Record<string, unknown>[],
  stepType: string
): [number, Record<string, unknown>] | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type === stepType) {
      return [index, step];
    }
  }

  return undefined;
}

function inferDirectSummaryText(
  cascadeId: string,
  trajectory: Record<string, unknown>
): string {
  const steps = arrayOfRecords(trajectory.steps);
  const latestTaskBoundary = latestStepByType(steps, "CORTEX_STEP_TYPE_TASK_BOUNDARY");
  if (latestTaskBoundary) {
    const taskBoundary = isRecord(latestTaskBoundary[1].taskBoundary)
      ? latestTaskBoundary[1].taskBoundary
      : undefined;
    const taskName = compactSummaryText(taskBoundary?.taskName, 80);
    if (taskName) {
      return taskName;
    }
  }

  for (const step of steps) {
    if (step.type !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }

    const userInput = isRecord(step.userInput) ? step.userInput : undefined;
    const summaryText = compactSummaryText(userInput?.userResponse, 80);
    if (summaryText) {
      return summaryText;
    }
  }

  return cascadeId;
}

function stepTimes(step: Record<string, unknown>): string[] {
  const metadata = isRecord(step.metadata) ? step.metadata : undefined;
  if (!metadata) {
    return [];
  }

  const keys = [
    "createdAt",
    "viewableAt",
    "finishedGeneratingAt",
    "lastCompletedChunkAt",
    "completedAt"
  ];

  return keys
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === "string");
}

function synthesizeDirectSummary(
  cascadeId: string,
  trajectory: Record<string, unknown>
): Record<string, unknown> {
  const steps = arrayOfRecords(trajectory.steps);
  const metadata = isRecord(trajectory.metadata) ? trajectory.metadata : undefined;
  const trajectoryMetadata = metadata ?? {};

  let createdTime = asOptionalString(trajectoryMetadata.createdAt);
  if (!createdTime) {
    const firstStepTimes = steps[0] ? stepTimes(steps[0]) : [];
    createdTime = firstStepTimes[0];
  }

  const allTimes: string[] = [];
  if (createdTime) {
    allTimes.push(createdTime);
  }
  for (const step of steps) {
    allTimes.push(...stepTimes(step));
  }

  let lastUserInputTime: string | undefined;
  let lastUserInputStepIndex: number | undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }

    const times = stepTimes(step);
    lastUserInputTime = times.length > 0 ? times.sort().at(-1) : undefined;
    lastUserInputStepIndex = index;
    break;
  }

  const latestNotifyUser = latestStepByType(steps, "CORTEX_STEP_TYPE_NOTIFY_USER");
  const latestTaskBoundary = latestStepByType(steps, "CORTEX_STEP_TYPE_TASK_BOUNDARY");

  const summary: Record<string, unknown> = {
    summary: inferDirectSummaryText(cascadeId, trajectory),
    stepCount: steps.length,
    lastModifiedTime: allTimes.length > 0 ? [...allTimes].sort().at(-1) : undefined,
    trajectoryId: trajectory.trajectoryId,
    createdTime,
    workspaces: trajectoryMetadata.workspaces,
    lastUserInputTime,
    lastUserInputStepIndex,
    trajectoryMetadata: Object.keys(trajectoryMetadata).length > 0 ? trajectoryMetadata : null
  };

  if (latestNotifyUser) {
    summary.latestNotifyUserStep = {
      step: latestNotifyUser[1],
      stepIndex: latestNotifyUser[0]
    };
  }
  if (latestTaskBoundary) {
    summary.latestTaskBoundaryStep = {
      step: latestTaskBoundary[1],
      stepIndex: latestTaskBoundary[0]
    };
  }

  return summary;
}

async function buildChatRecords(options: {
  data: AntigravityData;
  sourceJson: string | null;
  brainDir?: string;
}): Promise<Record<string, unknown>[]> {
  const { data, sourceJson, brainDir } = options;
  const trajectory = isRecord(data.trajectory) ? data.trajectory : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  const steps = arrayOfRecords(trajectory.steps);
  const summaryText = asOptionalString(summary.summary);
  const records: Record<string, unknown>[] = [
    {
      record_type: "session_meta",
      profile: "chat",
      cascade_id: data.cascadeId,
      trajectory_id: trajectory.trajectoryId,
      summary: summaryText,
      created_time: summary.createdTime,
      last_modified_time: summary.lastModifiedTime,
      status: summary.status,
      step_count: summary.stepCount,
      source_json: sourceJson,
      workspaces: summary.workspaces,
      trajectory_metadata: summary.trajectoryMetadata
    }
  ];

  for (const [stepIndex, step] of steps.entries()) {
    const stepType = String(step.type ?? "");
    const metadata = isRecord(step.metadata) ? step.metadata : {};
    const [payloadKey, payload] = stepPayload(step);

    if (stepType === "CORTEX_STEP_TYPE_USER_INPUT" && isRecord(payload)) {
      const content = asOptionalString(payload.userResponse);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "user",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          items: payload.items
        });
      }
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" && isRecord(payload)) {
      const content =
        asOptionalString(payload.modifiedResponse) ?? asOptionalString(payload.response);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          message_id: payload.messageId,
          stop_reason: payload.stopReason
        });
      }

      if (Array.isArray(payload.toolCalls)) {
        for (const [toolCallIndex, toolCall] of payload.toolCalls.entries()) {
          const decodedToolCall = decodeToolCall(toolCall);
          records.push({
            record_type: "tool_call",
            profile: "chat",
            role: "assistant",
            cascade_id: data.cascadeId,
            trajectory_id: trajectory.trajectoryId,
            summary: summaryText,
            source_json: sourceJson,
            step_index: stepIndex,
            tool_call_index: toolCallIndex,
            created_at: metadata.createdAt,
            tool_name: decodedToolCall?.name,
            tool_call: decodedToolCall
          });
        }
      }
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_NOTIFY_USER" && isRecord(payload)) {
      const content = asOptionalString(payload.notificationContent);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          artifact_uris: Array.isArray(payload.reviewAbsoluteUris) ? payload.reviewAbsoluteUris : [],
          blocking: payload.isBlocking
        });
      }
      continue;
    }

    if (TOOL_STEP_TYPES.has(stepType)) {
      records.push({
        record_type: "tool_result",
        profile: "chat",
        role: "tool",
        cascade_id: data.cascadeId,
        trajectory_id: trajectory.trajectoryId,
        summary: summaryText,
        source_json: sourceJson,
        step_index: stepIndex,
        created_at: metadata.createdAt,
        completed_at: metadata.completedAt,
        tool_name: toolNameForStep(step),
        tool_call: decodeToolCall(metadata.toolCall),
        payload_key: payloadKey,
        payload,
        content: extractText(stepType, payload)
      });
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_ERROR_MESSAGE" && isRecord(payload)) {
      const content = extractText(stepType, payload);
      if (content) {
        const errorPayload = isRecord(payload.error) ? payload.error : {};
        records.push({
          record_type: "message",
          profile: "chat",
          role: "system",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          message_type: "error",
          short_error: errorPayload.shortError
        });
      }
    }
  }

  if (brainDir) {
    records.push(...(await artifactRecords(data.cascadeId, trajectory.trajectoryId, summaryText, brainDir)));
  }

  return records;
}

function buildChatRecordsFromTranscriptRows(
  cascadeId: string,
  rows: Array<Record<string, unknown>>,
  sourceJson: string
): Record<string, unknown>[] {
  const timestamps = rows
    .map((row) => asOptionalString(row.created_at))
    .filter((value): value is string => Boolean(value));
  const records: Record<string, unknown>[] = [
    {
      record_type: "session_meta",
      profile: "chat",
      cascade_id: cascadeId,
      created_time: timestamps[0],
      last_modified_time: timestamps.at(-1),
      step_count: rows.length,
      source_json: sourceJson
    }
  ];
  const pendingToolCallIds = new Map<string, string[]>();

  for (const [index, row] of rows.entries()) {
    const stepType = String(row.type ?? "");
    const createdAt = row.created_at;
    const content = asOptionalString(row.content);

    if (stepType === "USER_INPUT") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "user",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content
        });
      }
      continue;
    }

    if (stepType === "PLANNER_RESPONSE") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content,
          thinking: row.thinking
        });
      }

      if (Array.isArray(row.tool_calls)) {
        for (const [toolCallIndex, toolCall] of row.tool_calls.entries()) {
          const toolCallRecord = isRecord(toolCall) ? toolCall : {};
          const toolName = asOptionalString(toolCallRecord.name) ?? "tool";
          const toolCallId = `${row.step_index ?? index}:${toolCallIndex}`;
          const pendingIds = pendingToolCallIds.get(toolName) ?? [];
          pendingIds.push(toolCallId);
          pendingToolCallIds.set(toolName, pendingIds);

          records.push({
            record_type: "tool_call",
            profile: "chat",
            role: "assistant",
            cascade_id: cascadeId,
            source_json: sourceJson,
            step_index: row.step_index ?? index,
            tool_call_index: toolCallIndex,
            created_at: createdAt,
            tool_name: toolName,
            tool_call: {
              id: toolCallId,
              name: toolName,
              arguments: toolCallRecord.args
            }
          });
        }
      }
      continue;
    }

    if (stepType === "CONVERSATION_HISTORY" && !content) {
      continue;
    }

    if (stepType === "SYSTEM_MESSAGE" || stepType === "CONVERSATION_HISTORY") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "system",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content,
          message_type: stepType.toLowerCase()
        });
      }
      continue;
    }

    if (content || stepType) {
      const toolName = transcriptToolName(stepType);
      const pendingIds = pendingToolCallIds.get(toolName) ?? [];
      const toolCallId = pendingIds.shift() ?? `${row.step_index ?? index}:result`;
      if (pendingIds.length > 0) {
        pendingToolCallIds.set(toolName, pendingIds);
      } else {
        pendingToolCallIds.delete(toolName);
      }

      records.push({
        record_type: "tool_result",
        profile: "chat",
        role: "tool",
        cascade_id: cascadeId,
        source_json: sourceJson,
        step_index: row.step_index ?? index,
        created_at: createdAt,
        completed_at: createdAt,
        tool_name: toolName,
        tool_call: {
          id: toolCallId,
          name: toolName
        },
        payload_key: stepType.toLowerCase(),
        payload: row,
        content: content ?? stringifyJsonValue(row)
      });
    }
  }

  return records;
}

function transcriptToolName(stepType: string): string {
  const mapping: Record<string, string> = {
    LIST_DIRECTORY: "list_dir",
    VIEW_FILE: "view_file",
    RUN_COMMAND: "run_command",
    GREP_SEARCH: "grep_search",
    CODE_ACTION: "code_action",
    GENERIC: "generic"
  };
  return mapping[stepType] ?? stepType.toLowerCase();
}

function toolNameForStep(step: Record<string, unknown>): string | undefined {
  const metadata = isRecord(step.metadata) ? step.metadata : undefined;
  const toolCall = isRecord(metadata?.toolCall) ? metadata.toolCall : undefined;
  const toolName = asOptionalString(toolCall?.name);
  if (toolName) {
    return toolName;
  }

  const mapping: Record<string, string> = {
    CORTEX_STEP_TYPE_RUN_COMMAND: "run_command",
    CORTEX_STEP_TYPE_VIEW_FILE: "view_file",
    CORTEX_STEP_TYPE_LIST_DIRECTORY: "list_directory",
    CORTEX_STEP_TYPE_GREP_SEARCH: "grep_search",
    CORTEX_STEP_TYPE_CODE_ACTION: "code_action",
    CORTEX_STEP_TYPE_COMMAND_STATUS: "command_status"
  };
  return mapping[String(step.type ?? "")];
}

async function artifactRecords(
  cascadeId: string,
  trajectoryId: unknown,
  summary: string | undefined,
  brainDir: string
): Promise<Record<string, unknown>[]> {
  try {
    const stats = await fs.stat(brainDir);
    if (!stats.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const paths = await collectMarkdownFiles(brainDir);
  const records: Record<string, unknown>[] = [];

  for (const absolutePath of paths) {
    const metadataPath = `${absolutePath}.metadata.json`;
    let metadata: unknown;
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    } catch {
      metadata = undefined;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    records.push({
      record_type: "artifact",
      profile: "chat",
      role: "artifact",
      cascade_id: cascadeId,
      trajectory_id: trajectoryId,
      summary,
      artifact_path: absolutePath,
      artifact_path_uri: pathToFileURL(absolutePath).toString(),
      artifact_rel_path: path.relative(brainDir, absolutePath),
      content,
      artifact_metadata: metadata
    });
  }

  return records;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return await collectMarkdownFiles(absolutePath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        return [];
      }

      return [absolutePath];
    })
  );

  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function resolveBrainDirFromConversationPath(
  absolutePath: string,
  cascadeId: string
): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const marker = "/conversations/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) {
    return undefined;
  }

  return path.join(normalized.slice(0, index), "brain", cascadeId);
}

function resolveTranscriptPathFromConversationPath(
  absolutePath: string,
  cascadeId: string
): string | undefined {
  const brainDir = resolveBrainDirFromConversationPath(absolutePath, cascadeId);
  return brainDir
    ? path.join(brainDir, ".system_generated", "logs", "transcript_full.jsonl")
    : undefined;
}

function resolveConversationPathFromTranscriptPath(absolutePath: string): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const match = normalized.match(
    /^(.*)\/brain\/([^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/i
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return path.join(match[1], "conversations", `${match[2]}.pb`);
}

async function isParseableJsonLinesFile(absolutePath: string): Promise<boolean> {
  try {
    const rows = parseJsonLines(await fs.readFile(absolutePath, "utf8"));
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("Expected Antigravity transcript JSONL rows to be objects.");
      }
      return parsed;
    });
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const text = JSON.stringify(value, null, 2);
  return text || "";
}

function buildAntigravityTitle(cascadeId: string, primaryWorkspace?: string): string {
  const workspaceName = primaryWorkspace
    ? primaryWorkspace.split(/[\\/]/).filter(Boolean).at(-1)
    : undefined;
  return workspaceName ? `${workspaceName} · Antigravity` : `${cascadeId} · Antigravity`;
}

function extractPrimaryWorkspace(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return normalizeWorkspacePath(item);
      }
      if (isRecord(item)) {
        const candidate =
          asOptionalString(item.workspaceFolderAbsoluteUri) ??
          asOptionalString(item.gitRootAbsoluteUri) ??
          asOptionalString(item.workspace) ??
          asOptionalString(item.path) ??
          asOptionalString(item.root);
        if (candidate) {
          return normalizeWorkspacePath(candidate);
        }
      }
    }
  }

  const candidate = asOptionalString(value);
  return candidate ? normalizeWorkspacePath(candidate) : undefined;
}

function toMetadataValue(value: unknown): MetadataValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return null;
}

function stringifyMetadata(value: unknown): MetadataValue {
  if (value == null) {
    return null;
  }

  const text = JSON.stringify(value);
  return text || null;
}

function normalizeWorkspacePath(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }

  try {
    return fileURLToPath(value);
  } catch {
    return value;
  }
}

function normalizeJsonName(value: string): string {
  const parts = value.split("_");
  return parts[0] + parts.slice(1).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
}

function readVarint(
  buffer: Buffer,
  offset: number
): {
  value: number;
  nextOffset: number;
} {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  while (true) {
    if (cursor >= buffer.length) {
      throw new Error("Unexpected end of varint.");
    }

    const byte = buffer[cursor];
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if (byte < 0x80) {
      return {
        value,
        nextOffset: cursor
      };
    }

    shift += 7;
    if (shift > 63) {
      throw new Error("Varint is too long.");
    }
  }
}

function decodeZigZag(value: number): number {
  return (value >> 1) ^ -(value & 1);
}

function parseProtobufField(
  buffer: Buffer,
  offset: number
): {
  fieldNumber: number;
  wireType: number;
  value: number | Buffer;
  nextOffset: number;
} {
  const tag = readVarint(buffer, offset);
  const fieldNumber = tag.value >> 3;
  const wireType = tag.value & 0x7;
  let cursor = tag.nextOffset;

  if (wireType === 0) {
    const decoded = readVarint(buffer, cursor);
    return {
      fieldNumber,
      wireType,
      value: decoded.value,
      nextOffset: decoded.nextOffset
    };
  }

  if (wireType === 1) {
    return {
      fieldNumber,
      wireType,
      value: readLittleEndianNumber(buffer.subarray(cursor, cursor + 8)),
      nextOffset: cursor + 8
    };
  }

  if (wireType === 2) {
    const decoded = readVarint(buffer, cursor);
    cursor = decoded.nextOffset;
    return {
      fieldNumber,
      wireType,
      value: buffer.subarray(cursor, cursor + decoded.value),
      nextOffset: cursor + decoded.value
    };
  }

  if (wireType === 5) {
    return {
      fieldNumber,
      wireType,
      value: readLittleEndianNumber(buffer.subarray(cursor, cursor + 4)),
      nextOffset: cursor + 4
    };
  }

  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function protobufFieldsDict(buffer: Buffer): ProtoFieldMap {
  let offset = 0;
  const values = new Map<number, ProtoFieldValue[]>();

  while (offset < buffer.length) {
    const parsed = parseProtobufField(buffer, offset);
    offset = parsed.nextOffset;
    const collection = values.get(parsed.fieldNumber) ?? [];
    collection.push({
      wireType: parsed.wireType,
      value: parsed.value
    });
    values.set(parsed.fieldNumber, collection);
  }

  return values;
}

function bufferFieldValue(fields: ProtoFieldMap, fieldNumber: number): Buffer | undefined {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return Buffer.isBuffer(value) ? value : undefined;
}

function numberFieldValue(fields: ProtoFieldMap, fieldNumber: number): number | undefined {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return typeof value === "number" ? value : undefined;
}

function byteFieldValues(fields: ProtoFieldMap, fieldNumber: number): Buffer[] {
  return (fields.get(fieldNumber) ?? [])
    .map((field) => field.value)
    .filter((value): value is Buffer => Buffer.isBuffer(value));
}

function formatTimestamp(seconds: number, nanos: number): string {
  const milliseconds = seconds * 1000 + Math.floor(nanos / 1_000_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const base = date.toISOString().replace(/\.\d{3}Z$/, "");
  if (nanos) {
    const fraction = String(nanos).padStart(9, "0").replace(/0+$/, "");
    return `${base}.${fraction}Z`;
  }

  return `${base}Z`;
}

function readLittleEndianNumber(buffer: Buffer): number {
  if (buffer.length === 4) {
    return buffer.readUInt32LE(0);
  }

  if (buffer.length === 8) {
    return Number(buffer.readBigUInt64LE(0));
  }

  let value = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    value += buffer[index] * 2 ** (index * 8);
  }
  return value;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
