import type { BackgroundTask, ToolCall } from "../types.js";
import { parseJsonLines } from "../jsonl.js";
import { collectText, formatCodeFence, normalizeRole, previewText, stringifyValue, toIsoTimestamp } from "../parserUtils.js";

export interface ClaudeParsedContent {
  textSegments: string[];
  toolUses: ToolCall[];
  toolResults: Array<{
    call: ToolCall;
    text: string;
  }>;
}

export function parseClaudeContent(
  content: unknown,
  options: {
    timestamp?: string;
    backgroundTaskId?: string;
  }
): ClaudeParsedContent {
  if (!Array.isArray(content)) {
    const text = collectText(content).trim();
    return {
      textSegments: text ? [text] : [],
      toolUses: [],
      toolResults: []
    };
  }

  const parsed: ClaudeParsedContent = {
    textSegments: [],
    toolUses: [],
    toolResults: []
  };

  for (const block of content) {
    if (!block || typeof block !== "object") {
      const text = collectText(block).trim();
      if (text) {
        parsed.textSegments.push(text);
      }
      continue;
    }

    const record = block as Record<string, unknown>;
    const type = String(record.type ?? "");

    if (type === "text" || type === "thinking") {
      const text = collectText(record.text ?? record.thinking ?? record.content).trim();
      if (text) {
        parsed.textSegments.push(text);
      }
      continue;
    }

    if (type === "tool_use") {
      parsed.toolUses.push({
        id: String(record.id ?? `tool-use:${parsed.toolUses.length}`),
        toolName: String(record.name ?? "tool"),
        kind: type,
        status: "pending",
        args: stringifyValue(record.input),
        startedAt: toIsoTimestamp(record.timestamp ?? options.timestamp)
      });
      continue;
    }

    if (type === "tool_result") {
      const output = stringifyValue(record.content);
      const backgroundTask = options.backgroundTaskId
        ? ({
            taskId: options.backgroundTaskId,
            toolUseId: String(record.tool_use_id ?? ""),
            status: "queued"
          } satisfies BackgroundTask)
        : undefined;
      parsed.toolResults.push({
        call: {
          id: String(record.tool_use_id ?? parsed.toolResults.length),
          toolName: String(record.name ?? "tool"),
          kind: type,
          status: backgroundTask ? "pending" : "completed",
          output,
          finishedAt: backgroundTask
            ? undefined
            : toIsoTimestamp(record.timestamp ?? options.timestamp),
          backgroundTask
        },
        text: backgroundTask ? output.trim() : formatCodeFence(record.content)
      });
      continue;
    }

    const text = collectText(record).trim();
    if (text) {
      parsed.textSegments.push(text);
    }
  }

  return parsed;
}

export function extractClaudePreviewTitle(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  for (const row of rows) {
    const messageRecord =
      row.message && typeof row.message === "object"
        ? (row.message as Record<string, unknown>)
        : undefined;
    const role = normalizeRole(row.role ?? row.sender ?? messageRecord?.role ?? row.type);
    if (role === "user") {
      const msgContent = messageRecord?.content ?? row.content ?? row.text ?? row.completion;
      const parsedContent = parseClaudeContent(msgContent, {});
      const text = parsedContent.textSegments.filter((segment) => segment.trim()).join("\n\n");
      if (text.trim()) {
        return previewText(text, 80);
      }
    }
  }
  return undefined;
}

export function extractClaudeCwd(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  for (const row of rows) {
    if (typeof row.cwd === "string" && row.cwd.trim()) {
      return row.cwd.trim();
    }
  }
  return undefined;
}

export function extractClaudeSessionId(content: string | unknown[], absolutePath: string): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (typeof row.agentId === "string" && row.agentId.trim()) {
        return row.agentId.trim();
      }
      if (typeof row.sessionId === "string" && row.sessionId.trim()) {
        return row.sessionId.trim();
      }
    }
  } catch {
    // ignore
  }

  // Fallback to path extraction
  const subagentMatch = absolutePath.match(/subagents\/agent-([a-fA-F0-9-]+)\.jsonl$/i);
  if (subagentMatch) {
    return subagentMatch[1];
  }
  const parentMatch = absolutePath.match(/\/([a-fA-F0-9-]+)\.jsonl$/i);
  if (parentMatch) {
    return parentMatch[1];
  }
  return undefined;
}

export function extractClaudeParentThreadId(content: string | unknown[], absolutePath: string): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (typeof row.agentId === "string" && typeof row.sessionId === "string" && row.sessionId.trim()) {
        return row.sessionId.trim();
      }
    }
  } catch {
    // ignore
  }

  const normalized = absolutePath.replace(/\\/g, "/");
  const subagentMatch = normalized.match(/\/([a-fA-F0-9-]+)\/subagents\/agent-[a-fA-F0-9-]+\.jsonl$/i);
  if (subagentMatch) {
    return subagentMatch[1];
  }
  return undefined;
}

