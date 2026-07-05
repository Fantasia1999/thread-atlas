import type { Message, Session, SessionBundle, ToolCall, SessionRole } from "./types.js";
import {
  addToolCall,
  basenameTitle,
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
const CODEX_TITLE_PREVIEW_LENGTH = 80;

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
  let threadName: string | undefined;

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
      if (eventType === "thread_name_updated") {
        const nextThreadName = normalizeThreadName(payload.thread_name);
        if (nextThreadName) {
          threadName = nextThreadName;
        }
        continue;
      }

      if (eventType === "user_message" || eventType === "agent_message") {
        const text = collectText(payload.message);
        if (!text.trim()) {
          continue;
        }
        let role: SessionRole = eventType === "user_message" ? "user" : "assistant";
        if (role === "user" && isSystemInstructionText(text)) {
          role = "system";
        }
        messages.push({
          id: `${bundle.key}:${messages.length}`,
          role,
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
      let role = normalizeRole(payload.role);
      if (role === "user" && isSystemInstructionText(text)) {
        role = "system";
      }
      messages.push({
        id: `${bundle.key}:${messages.length}`,
        role,
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

  const dedupedMessages = dedupeCodexMessages(messages);
  const id = typeof sessionMeta?.id === "string" ? sessionMeta.id : undefined;
  const firstUserTitle = codexTitleFromMessages(dedupedMessages);
  const title =
    threadName ??
    firstUserTitle ??
    (cwd ? `${basenameTitle(cwd) || "project"} · Codex` : undefined) ??
    `${bundle.title || "Codex session"}`;

  const parentThreadId =
    typeof sessionMeta?.parent_thread_id === "string"
      ? sessionMeta.parent_thread_id
      : typeof (sessionMeta?.source as any)?.subagent?.thread_spawn?.parent_thread_id === "string"
        ? (sessionMeta?.source as any).subagent.thread_spawn.parent_thread_id
        : undefined;

  return buildSession(bundle, "codex", {
    id,
    title,
    summary: previewText(cleanCodexPrompt(dedupedMessages.find((message) => message.role === "user")?.text ?? "")),
    cwd,
    startedAt: toIsoTimestamp(sessionMeta?.timestamp),
    updatedAt: dedupedMessages.at(-1)?.createdAt,
    messages: dedupedMessages,
    metadata: {
      cwd: cwd ?? null,
      threadName: threadName ?? null,
      sessionId: id ?? null,
      parentThreadId: parentThreadId ?? null,
      cli_version:
        typeof sessionMeta?.cli_version === "string" ? sessionMeta.cli_version : null,
      model_provider:
        typeof sessionMeta?.model_provider === "string" ? sessionMeta.model_provider : null
    }
  });
}

export function extractCodexCwd(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  for (const row of rows) {
    if (row.type === "session_meta") {
      const payload = row.payload as Record<string, unknown> | undefined;
      if (typeof payload?.cwd === "string") {
        return payload.cwd;
      }
    }
  }
  return undefined;
}

export function extractCodexSessionId(content: string | unknown[], absolutePath: string): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (row.type === "session_meta") {
        const payload = row.payload as Record<string, unknown> | undefined;
        if (typeof payload?.id === "string") {
          return payload.id;
        }
        if (typeof payload?.session_id === "string") {
          return payload.session_id;
        }
      }
    }
  } catch {
    // ignore
  }

  const base = basenameTitle(absolutePath);
  const match = base.match(/rollout-.*-([a-fA-F0-9-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return undefined;
}

export function extractCodexParentThreadId(content: string | unknown[]): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (row.type === "session_meta") {
        const payload = row.payload as Record<string, unknown> | undefined;
        const parentThreadId =
          typeof payload?.parent_thread_id === "string"
            ? payload.parent_thread_id
            : typeof (payload?.source as any)?.subagent?.thread_spawn?.parent_thread_id === "string"
              ? (payload?.source as any).subagent.thread_spawn.parent_thread_id
              : undefined;
        if (parentThreadId) {
          return parentThreadId;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}


export function extractCodexPreviewTitle(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  let threadName: string | undefined;
  let firstUserTitle: string | undefined;

  for (const row of rows) {
    const rowType = String(row.type ?? "");
    const payload = (row.payload as Record<string, unknown> | undefined) ?? {};

    if (rowType === "event_msg") {
      const eventType = String(payload.type ?? "");
      if (eventType === "thread_name_updated") {
        const nextThreadName = normalizeThreadName(payload.thread_name);
        if (nextThreadName) {
          threadName = nextThreadName;
        }
        continue;
      }
      if (eventType === "user_message" && firstUserTitle == null) {
        const text = collectText(payload.message);
        if (text.trim() && !isSystemInstructionText(text)) {
          firstUserTitle = previewTitle(text);
        }
      }
    } else if (rowType === "response_item") {
      const responseType = String(payload.type ?? "");
      if (responseType === "message") {
        const role = normalizeRole(payload.role);
        if (role === "user" && firstUserTitle == null) {
          const text = collectText(payload.content);
          if (text.trim() && !isSystemInstructionText(text)) {
            firstUserTitle = previewTitle(text);
          }
        }
      }
    }
  }

  return threadName ?? firstUserTitle;
}

function normalizeThreadName(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const value = input.trim();
  return value || undefined;
}

export function cleanCodexPrompt(text: string): string {
  const match = text.match(/(?:##?\s*My request for Codex:)\s*([\s\S]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (text.includes("# Files mentioned by the user:")) {
    const lines = text.split("\n");
    const cleanLines = lines.filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith("#") && !trimmed.includes("codex-clipboard-") && !trimmed.includes("/T/codex-clipboard-");
    });
    const cleaned = cleanLines.join("\n").trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return text;
}

function codexTitleFromMessages(messages: Message[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user");
  return previewTitle(firstUserMessage?.text ?? "");
}

function previewTitle(text: string): string | undefined {
  const cleaned = cleanCodexPrompt(text);
  const title = previewText(cleaned, CODEX_TITLE_PREVIEW_LENGTH);
  return title || undefined;
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

function isSystemInstructionText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.includes("<permissions instructions>") ||
    trimmed.includes("<INSTRUCTIONS>") ||
    trimmed.includes("# AGENTS.md instructions") ||
    trimmed.includes("<collaboration_mode>") ||
    trimmed.includes("<apps_instructions>") ||
    trimmed.includes("<skills_instructions>") ||
    trimmed.includes("<plugins_instructions>")
  );
}
