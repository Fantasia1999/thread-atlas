import type {
  Message,
  MetadataValue,
  Session,
  SessionBundle,
  SessionSource,
  ToolCall
} from "../../shared/types.js";
import { basenameTitle, previewText } from "../../shared/parserUtils.js";
export { parseJsonLines, safeJsonParse } from "../../shared/jsonl.js";
export { basenameTitle, collectText, formatCodeFence, normalizeRole, previewText, stringifyValue, toIsoTimestamp } from "../../shared/parserUtils.js";

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
