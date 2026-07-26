import type { SessionRole } from "./types.js";

export function collectText(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => collectText(entry, depth + 1))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (record.type === "input_image" && typeof record.image_url === "string") {
    return `![Image](${record.image_url})`;
  }
  const preferredKeys = [
    "text",
    "content",
    "output",
    "message",
    "reasoning",
    "summary",
    "result"
  ];

  for (const key of preferredKeys) {
    if (key in record) {
      const text = collectText(record[key], depth + 1);
      if (text) {
        return text;
      }
    }
  }

  return Object.values(record)
    .map((entry) => collectText(entry, depth + 1))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function normalizeRole(input: unknown): SessionRole {
  const value = String(input ?? "").toLowerCase();
  if (value.includes("developer")) {
    return "developer";
  }
  if (value.includes("system")) {
    return "system";
  }
  if (value.includes("tool")) {
    return "tool";
  }
  if (value.includes("assistant") || value.includes("model")) {
    return "assistant";
  }
  return "user";
}

export function toIsoTimestamp(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) {
    const numeric = Number(input);
    if (!Number.isNaN(numeric) && /^\d+$/.test(input)) {
      return toIsoTimestamp(numeric);
    }
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    const milliseconds = input > 1_000_000_000_000 ? input : input * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  return undefined;
}

const WHITESPACE_RUN = /\s+/g;

export function previewText(text: string, length = 120): string {
  // Incremental whitespace normalization: stop as soon as the preview budget
  // is exceeded instead of normalizing the entire (possibly huge) input.
  let normalized = "";
  let pendingSpace = false;
  let cursor = 0;

  while (cursor < text.length && normalized.length <= length) {
    WHITESPACE_RUN.lastIndex = cursor;
    const match = WHITESPACE_RUN.exec(text);
    if (match && match.index === cursor) {
      pendingSpace = normalized.length > 0;
      cursor = WHITESPACE_RUN.lastIndex;
      continue;
    }

    const segmentEnd = match ? match.index : text.length;
    if (pendingSpace) {
      normalized += " ";
      pendingSpace = false;
    }
    normalized += text.slice(cursor, Math.min(segmentEnd, cursor + length + 2 - normalized.length));
    cursor = segmentEnd;
  }

  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, length - 1)}...`;
}

export function basenameTitle(input: string): string {
  const segments = input.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? input;
}

export function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const text = collectText(value);
  if (text) {
    return text;
  }
  return JSON.stringify(value, null, 2) ?? "";
}

export function formatCodeFence(value: unknown): string {
  const text = stringifyValue(value).replace(/\r\n/g, "\n").trimEnd();
  if (!text.trim()) {
    return "";
  }

  let longestBacktickRun = 0;
  let currentRun = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 96) {
      currentRun += 1;
      if (currentRun > longestBacktickRun) {
        longestBacktickRun = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));

  return `${fence}\n${text}\n${fence}`;
}
