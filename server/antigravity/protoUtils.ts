export interface ProtoFieldValue {
  wireType: number;
  value: number | Buffer;
}

export type ProtoFieldMap = Map<number, ProtoFieldValue[]>;
export function normalizeJsonName(value: string): string {
  const parts = value.split("_");
  return parts[0] + parts.slice(1).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
}

export function readVarint(
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

export function decodeZigZag(value: number): number {
  return (value >> 1) ^ -(value & 1);
}

export function parseProtobufField(
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

export function protobufFieldsDict(buffer: Buffer): ProtoFieldMap {
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

export function bufferFieldValue(fields: ProtoFieldMap, fieldNumber: number): Buffer | undefined {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return Buffer.isBuffer(value) ? value : undefined;
}

export function numberFieldValue(fields: ProtoFieldMap, fieldNumber: number): number | undefined {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return typeof value === "number" ? value : undefined;
}

export function byteFieldValues(fields: ProtoFieldMap, fieldNumber: number): Buffer[] {
  return (fields.get(fieldNumber) ?? [])
    .map((field) => field.value)
    .filter((value): value is Buffer => Buffer.isBuffer(value));
}

export function formatTimestamp(seconds: number, nanos: number): string {
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

export function readLittleEndianNumber(buffer: Buffer): number {
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
