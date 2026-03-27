import type { Message, Session, SessionBundle, ToolCall } from "./types.js";
import {
  basenameTitle,
  buildFallbackSession,
  buildSession,
  collectText,
  normalizeRole,
  parseJsonLines,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

export function parseClaudeSession(bundle: SessionBundle): Session {
  const file = bundle.files[0];
  if (!file) {
    return buildFallbackSession(bundle, "claude", "Missing Claude file.");
  }

  const rows = parseJsonLines(file.content) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return buildFallbackSession(bundle, "claude", "No JSONL records found.");
  }

  const messages: Message[] = [];
  let cwd: string | undefined;

  rows.forEach((row, index) => {
    const messageRecord =
      row.message && typeof row.message === "object"
        ? (row.message as Record<string, unknown>)
        : undefined;
    const timestamp = toIsoTimestamp(
      row.timestamp ?? row.created_at ?? row.time ?? messageRecord?.created_at
    );
    const role = normalizeRole(row.role ?? row.sender ?? messageRecord?.role ?? row.type);
    const content = messageRecord?.content ?? row.content ?? row.text ?? row.completion;
    const toolCalls = extractClaudeToolCalls(content);
    const text = extractClaudeText(content);

    if (typeof row.cwd === "string") {
      cwd = row.cwd;
    }

    if (!text.trim() && toolCalls.length === 0) {
      return;
    }

    messages.push({
      id: `${bundle.key}:${index}`,
      role,
      text,
      createdAt: timestamp,
      rawType: String(row.type ?? messageRecord?.type ?? "message"),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    });
  });

  return buildSession(bundle, "claude", {
    title: cwd ? `${basenameTitle(cwd) || "project"} · Claude` : bundle.title,
    cwd,
    messages,
    metadata: {
      cwd: cwd ?? null
    }
  });
}

function extractClaudeText(content: unknown): string {
  if (!Array.isArray(content)) {
    return collectText(content);
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return collectText(block);
      }

      const record = block as Record<string, unknown>;
      const type = String(record.type ?? "");
      if (type === "text" || type === "thinking") {
        return collectText(record.text ?? record.thinking ?? record.content);
      }
      if (type === "tool_result") {
        return collectText(record.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractClaudeToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    const type = String(record.type ?? "");

    if (type === "tool_use") {
      toolCalls.push({
        id: String(record.id ?? toolCalls.length),
        toolName: String(record.name ?? "tool"),
        kind: type,
        status: "pending",
        args: stringifyValue(record.input),
        startedAt: toIsoTimestamp(record.timestamp)
      });
    }

    if (type === "tool_result") {
      toolCalls.push({
        id: String(record.tool_use_id ?? toolCalls.length),
        toolName: String(record.name ?? "tool"),
        kind: type,
        status: "completed",
        output: stringifyValue(record.content),
        finishedAt: toIsoTimestamp(record.timestamp)
      });
    }
  }

  return toolCalls;
}
