import type {
  Message,
  MetadataValue,
  Session,
  SessionBundle,
  SessionRole,
  SessionSource,
  ToolCall
} from "./types.js";

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse(line))
    .filter((entry): entry is unknown => entry !== null);
}

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

export function previewText(text: string, length = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, length - 1)}...`;
}

export function basenameTitle(input: string): string {
  const segments = input.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? input;
}

export function sessionIdFromPath(input: string): string {
  return basenameTitle(input).replace(/\.[^.]+$/, "") || cryptoRandomId();
}

export function buildSession(
  bundle: SessionBundle,
  source: SessionSource,
  options: {
    id?: string;
    title?: string;
    summary?: string;
    cwd?: string;
    startedAt?: string;
    updatedAt?: string;
    messages: Message[];
    metadata?: Record<string, MetadataValue>;
  }
): Session {
  const messages = sortMessages(options.messages).filter(
    (message) => message.text.trim() || (message.toolCalls?.length ?? 0) > 0
  );
  const firstUserMessage = messages.find((message) => message.role === "user");

  return {
    id: options.id || sessionIdFromPath(bundle.primaryPath),
    source,
    title: options.title || bundle.title || basenameTitle(bundle.primaryPath),
    summary:
      options.summary ||
      previewText(firstUserMessage?.text || messages[0]?.text || bundle.title || "No preview"),
    cwd: options.cwd,
    startedAt: options.startedAt || messages[0]?.createdAt,
    updatedAt: options.updatedAt || messages.at(-1)?.createdAt,
    primaryPath: bundle.primaryPath,
    messageCount: messages.length,
    messages,
    metadata: options.metadata ?? {},
    rawFiles: bundle.files.map((file) => file.path)
  };
}

export function buildFallbackSession(
  bundle: SessionBundle,
  source: SessionSource,
  reason: string
): Session {
  const contentPreview = previewText(bundle.files[0]?.content ?? "", 300);
  return buildSession(bundle, source, {
    messages: [
      {
        id: `${bundle.key}:fallback`,
        role: "system",
        text: `Parser fallback: ${reason}${contentPreview ? `\n\n${contentPreview}` : ""}`
      }
    ]
  });
}

export function addToolCall(
  collection: ToolCall[] | undefined,
  toolCall: ToolCall
): ToolCall[] {
  const next = collection ? [...collection] : [];
  const existingIndex = next.findIndex((entry) => entry.id === toolCall.id);

  if (existingIndex >= 0) {
    next[existingIndex] = {
      ...next[existingIndex],
      ...toolCall
    };
    return next;
  }

  next.push(toolCall);
  return next;
}

export function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
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

  const longestBacktickRun = Array.from(text.matchAll(/`+/g)).reduce(
    (max, match) => Math.max(max, match[0].length),
    0
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));

  return `${fence}\n${text}\n${fence}`;
}

export function extractCommonMetadata(value: Record<string, unknown>): Record<string, MetadataValue> {
  const metadata: Record<string, MetadataValue> = {};
  const keys = ["cwd", "directory", "model", "modelID", "providerID", "cli_version", "sessionId"];

  for (const key of keys) {
    const candidate = value[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean" ||
      candidate === null
    ) {
      metadata[key] = candidate;
    }
  }

  return metadata;
}

function cryptoRandomId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}
