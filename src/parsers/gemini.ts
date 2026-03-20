import type { Message, Session, SessionBundle, ToolCall } from "./types.js";
import {
  buildFallbackSession,
  buildSession,
  collectText,
  normalizeRole,
  safeJsonParse,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

export function parseGeminiSession(bundle: SessionBundle): Session {
  const file = bundle.files[0];
  if (!file) {
    return buildFallbackSession(bundle, "gemini", "Missing Gemini file.");
  }

  const root = safeJsonParse<unknown>(file.content);
  if (!root) {
    return buildFallbackSession(bundle, "gemini", "Invalid Gemini JSON.");
  }

  const candidates = extractConversation(root);
  if (candidates.length === 0) {
    return buildFallbackSession(bundle, "gemini", "No Gemini conversation records found.");
  }

  const messages: Message[] = candidates
    .map((entry, index) => normalizeGeminiMessage(bundle.key, entry, index))
    .filter((message): message is Message => message !== null);

  return buildSession(bundle, "gemini", {
    messages
  });
}

function extractConversation(root: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(root)) {
    return root.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  }

  if (!root || typeof root !== "object") {
    return [];
  }

  const record = root as Record<string, unknown>;
  const collections = [record.messages, record.conversation, record.events, record.turns];

  for (const candidate of collections) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object"
      );
    }
  }

  return [];
}

function normalizeGeminiMessage(
  prefix: string,
  entry: Record<string, unknown>,
  index: number
): Message | null {
  const role = normalizeRole(entry.role ?? entry.author ?? entry.sender ?? entry.type);
  const text = collectText(entry.content ?? entry.parts ?? entry.text ?? entry.message);
  const toolCalls = extractGeminiToolCalls(entry);

  if (!text.trim() && toolCalls.length === 0) {
    return null;
  }

  return {
    id: `${prefix}:${index}`,
    role,
    text,
    createdAt: toIsoTimestamp(entry.timestamp ?? entry.createTime ?? entry.time),
    rawType: String(entry.type ?? "message"),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
  };
}

function extractGeminiToolCalls(entry: Record<string, unknown>): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const parts = Array.isArray(entry.parts) ? entry.parts : [];

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const record = part as Record<string, unknown>;
    if (record.functionCall) {
      const call = record.functionCall as Record<string, unknown>;
      toolCalls.push({
        id: String(call.id ?? toolCalls.length),
        toolName: String(call.name ?? "functionCall"),
        kind: "functionCall",
        status: "pending",
        args: stringifyValue(call.args)
      });
    }

    if (record.functionResponse) {
      const result = record.functionResponse as Record<string, unknown>;
      toolCalls.push({
        id: String(result.id ?? toolCalls.length),
        toolName: String(result.name ?? "functionResponse"),
        kind: "functionResponse",
        status: "completed",
        output: stringifyValue(result.response)
      });
    }
  }

  if (entry.functionCall && typeof entry.functionCall === "object") {
    const call = entry.functionCall as Record<string, unknown>;
    toolCalls.push({
      id: String(call.id ?? toolCalls.length),
      toolName: String(call.name ?? "functionCall"),
      kind: "functionCall",
      status: "pending",
      args: stringifyValue(call.args)
    });
  }

  return toolCalls;
}
