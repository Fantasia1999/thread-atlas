import type { Message, Session, SessionBundle, ToolCall } from "./types.js";
import {
  addToolCall,
  basenameTitle,
  buildFallbackSession,
  buildSession,
  collectText,
  formatCodeFence,
  normalizeRole,
  parseJsonLines,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

interface ClaudeParsedContent {
  textSegments: string[];
  toolUses: ToolCall[];
  toolResults: Array<{
    call: ToolCall;
    text: string;
  }>;
}

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
  const toolMessageIndex = new Map<string, number>();
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
    const parsedContent = parseClaudeContent(content, timestamp);
    let toolCalls = [...parsedContent.toolUses];
    const textSegments = [...parsedContent.textSegments];

    if (typeof row.cwd === "string") {
      cwd = row.cwd;
    }

    for (const result of parsedContent.toolResults) {
      const currentIndex = toolCalls.findIndex((toolCall) => toolCall.id === result.call.id);
      if (currentIndex >= 0) {
        const currentCall = toolCalls[currentIndex];
        toolCalls = addToolCall(toolCalls, {
          ...result.call,
          toolName:
            result.call.toolName === "tool" ? currentCall.toolName : result.call.toolName
        });
        continue;
      }

      const existingIndex = toolMessageIndex.get(result.call.id);
      if (existingIndex != null) {
        const existingMessage = messages[existingIndex];
        const existingCall = existingMessage.toolCalls?.find(
          (toolCall) => toolCall.id === result.call.id
        );
        existingMessage.toolCalls = addToolCall(existingMessage.toolCalls, {
          ...result.call,
          toolName:
            result.call.toolName === "tool"
              ? existingCall?.toolName ?? result.call.toolName
              : result.call.toolName
        });
        continue;
      }

      toolCalls = addToolCall(toolCalls, result.call);
      if (result.text.trim()) {
        textSegments.push(result.text);
      }
    }

    const text = textSegments.filter((segment) => segment.trim()).join("\n\n");
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

    const messageIndex = messages.length - 1;
    for (const toolCall of toolCalls) {
      if (toolCall.status === "pending" && toolCall.id) {
        toolMessageIndex.set(toolCall.id, messageIndex);
      }
    }
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

function parseClaudeContent(content: unknown, rowTimestamp?: string): ClaudeParsedContent {
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
        startedAt: toIsoTimestamp(record.timestamp ?? rowTimestamp)
      });
      continue;
    }

    if (type === "tool_result") {
      const output = stringifyValue(record.content);
      parsed.toolResults.push({
        call: {
          id: String(record.tool_use_id ?? parsed.toolResults.length),
          toolName: String(record.name ?? "tool"),
          kind: type,
          status: "completed",
          output,
          finishedAt: toIsoTimestamp(record.timestamp ?? rowTimestamp)
        },
        text: formatCodeFence(record.content)
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
