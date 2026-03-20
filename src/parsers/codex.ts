import type { Message, Session, SessionBundle, ToolCall } from "./types.js";
import {
  addToolCall,
  buildFallbackSession,
  buildSession,
  collectText,
  normalizeRole,
  parseJsonLines,
  previewText,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

const DUPLICATE_MESSAGE_WINDOW_MS = 2_000;

export function parseCodexSession(bundle: SessionBundle): Session {
  const file = bundle.files[0];
  if (!file) {
    return buildFallbackSession(bundle, "codex", "Missing Codex file.");
  }

  const rows = parseJsonLines(file.content) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return buildFallbackSession(bundle, "codex", "No JSONL records found.");
  }

  const messages: Message[] = [];
  const toolMessageIndex = new Map<string, number>();
  let sessionMeta: Record<string, unknown> | undefined;

  for (const row of rows) {
    const timestamp = toIsoTimestamp(row.timestamp);
    const rowType = String(row.type ?? "");
    const payload = (row.payload as Record<string, unknown> | undefined) ?? {};

    if (rowType === "session_meta") {
      sessionMeta = payload;
      continue;
    }

    if (rowType === "event_msg") {
      const eventType = String(payload.type ?? "");
      if (eventType === "user_message" || eventType === "agent_message") {
        const text = collectText(payload.message);
        if (!text.trim()) {
          continue;
        }
        messages.push({
          id: `${bundle.key}:${messages.length}`,
          role: eventType === "user_message" ? "user" : "assistant",
          text,
          createdAt: timestamp,
          rawType: eventType
        });
      }
      continue;
    }

    if (rowType !== "response_item") {
      continue;
    }

    const responseType = String(payload.type ?? "");

    if (responseType === "message") {
      const text = collectText(payload.content);
      messages.push({
        id: `${bundle.key}:${messages.length}`,
        role: normalizeRole(payload.role),
        text,
        createdAt: timestamp,
        rawType: responseType
      });
      continue;
    }

    if (responseType === "reasoning") {
      const summaryText = collectText(payload.summary) || collectText(payload.content);
      if (summaryText.trim()) {
        messages.push({
          id: `${bundle.key}:${messages.length}`,
          role: "assistant",
          text: summaryText,
          createdAt: timestamp,
          rawType: responseType
        });
      }
      continue;
    }

    if (
      responseType === "function_call" ||
      responseType === "custom_tool_call" ||
      responseType === "function_call_output" ||
      responseType === "custom_tool_call_output"
    ) {
      const callId = String(payload.call_id ?? payload.id ?? `${messages.length}`);
      const isOutput = responseType.endsWith("_output");
      const baseCall: ToolCall = {
        id: callId,
        toolName: String(payload.name ?? payload.tool ?? payload.type ?? "tool"),
        kind: responseType,
        status:
          responseType === "function_call_output" || responseType === "custom_tool_call_output"
            ? "completed"
            : "pending",
        args: isOutput ? undefined : stringifyValue(payload.arguments ?? payload.input ?? ""),
        output: isOutput ? stringifyValue(payload.output ?? payload.result ?? "") : undefined,
        startedAt: timestamp,
        finishedAt: isOutput ? timestamp : undefined
      };

      const existingIndex = toolMessageIndex.get(callId);
      if (existingIndex == null) {
        messages.push({
          id: `${bundle.key}:tool:${callId}`,
          role: "tool",
          text: "",
          createdAt: timestamp,
          rawType: responseType,
          toolCalls: [baseCall]
        });
        toolMessageIndex.set(callId, messages.length - 1);
      } else {
        const existingMessage = messages[existingIndex];
        existingMessage.toolCalls = addToolCall(existingMessage.toolCalls, baseCall);
      }
    }
  }

  const cwd =
    typeof sessionMeta?.cwd === "string"
      ? sessionMeta.cwd
      : typeof sessionMeta?.["cwd"] === "string"
        ? String(sessionMeta.cwd)
        : undefined;

  const id = typeof sessionMeta?.id === "string" ? sessionMeta.id : undefined;
  const title =
    cwd != null
      ? `${cwd.split("/").filter(Boolean).at(-1) ?? "workspace"} · Codex`
      : `${bundle.title || "Codex session"}`;
  const dedupedMessages = dedupeCodexMessages(messages);

  return buildSession(bundle, "codex", {
    id,
    title,
    summary: previewText(dedupedMessages.find((message) => message.role === "user")?.text ?? ""),
    cwd,
    startedAt: toIsoTimestamp(sessionMeta?.timestamp),
    updatedAt: dedupedMessages.at(-1)?.createdAt,
    messages: dedupedMessages,
    metadata: {
      cwd: cwd ?? null,
      cli_version:
        typeof sessionMeta?.cli_version === "string" ? sessionMeta.cli_version : null,
      model_provider:
        typeof sessionMeta?.model_provider === "string" ? sessionMeta.model_provider : null
    }
  });
}

function dedupeCodexMessages(messages: Message[]): Message[] {
  const deduped: Message[] = [];

  for (const message of messages) {
    const duplicateIndex = findDuplicateIndex(deduped, message);
    if (duplicateIndex < 0) {
      deduped.push(message);
      continue;
    }

    if (preferCurrentMessage(deduped[duplicateIndex], message)) {
      deduped[duplicateIndex] = message;
    }
  }

  return deduped;
}

function findDuplicateIndex(messages: Message[], candidate: Message): number {
  if (!isDuplicateCandidate(candidate)) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!isDuplicateCandidate(existing)) {
      continue;
    }
    if (isOutsideDuplicateWindow(existing, candidate)) {
      break;
    }
    if (isDuplicatePair(existing, candidate)) {
      return index;
    }
  }

  return -1;
}

function isDuplicateCandidate(message: Message): boolean {
  return Boolean(
    message.text.trim() &&
      (message.rawType === "message" ||
        message.rawType === "user_message" ||
        message.rawType === "agent_message")
  );
}

function isDuplicatePair(left: Message, right: Message): boolean {
  return (
    left.role === right.role &&
    normalizeMessageText(left.text) === normalizeMessageText(right.text) &&
    isDuplicateRawTypePair(left.rawType, right.rawType)
  );
}

function isDuplicateRawTypePair(left?: string, right?: string): boolean {
  return (
    (left === "message" && (right === "user_message" || right === "agent_message")) ||
    (right === "message" && (left === "user_message" || left === "agent_message"))
  );
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isOutsideDuplicateWindow(left: Message, right: Message): boolean {
  const leftTime = parseTimestamp(left.createdAt);
  const rightTime = parseTimestamp(right.createdAt);
  if (leftTime == null || rightTime == null) {
    return false;
  }
  return Math.abs(rightTime - leftTime) > DUPLICATE_MESSAGE_WINDOW_MS;
}

function preferCurrentMessage(existing: Message, candidate: Message): boolean {
  if (existing.rawType === "message") {
    return false;
  }
  if (candidate.rawType === "message") {
    return true;
  }
  return false;
}

function parseTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}
