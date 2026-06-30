import type { BackgroundTask, Message, Session, SessionBundle, ToolCall } from "./types.js";
import {
  addToolCall,
  basenameTitle,
  buildFallbackSession,
  buildSession,
  collectText,
  formatCodeFence,
  normalizeRole,
  parseJsonLines,
  previewText,
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

interface ClaudeQueueOperation {
  operation: string;
  taskId?: string;
  toolUseId?: string;
  status?: string;
  summary?: string;
  outputFile?: string;
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
    if (typeof row.cwd === "string") {
      cwd = row.cwd;
    }

    const rowType = String(row.type ?? "");
    const messageRecord =
      row.message && typeof row.message === "object"
        ? (row.message as Record<string, unknown>)
        : undefined;
    const timestamp = toIsoTimestamp(
      row.timestamp ?? row.created_at ?? row.time ?? messageRecord?.created_at
    );

    if (rowType === "queue-operation") {
      const queueOperation = parseClaudeQueueOperation(row);
      if (queueOperation?.toolUseId) {
        const existingIndex = toolMessageIndex.get(queueOperation.toolUseId);
        if (existingIndex != null) {
          const existingMessage = messages[existingIndex];
          const existingCall = existingMessage.toolCalls?.find(
            (toolCall) => toolCall.id === queueOperation.toolUseId
          );
          if (existingCall) {
            existingMessage.toolCalls = addToolCall(existingMessage.toolCalls, {
              ...existingCall,
              status: deriveToolCallStatusFromBackgroundTask(queueOperation.status),
              finishedAt: timestamp ?? existingCall.finishedAt,
              backgroundTask: mergeBackgroundTask(existingCall.backgroundTask, queueOperation)
            });
            return;
          }
        }
      }

      const fallbackMessage = buildQueueOperationFallbackMessage(
        bundle.key,
        index,
        queueOperation,
        timestamp
      );
      if (fallbackMessage) {
        messages.push(fallbackMessage);
      }
      return;
    }

    const role = normalizeRole(row.role ?? row.sender ?? messageRecord?.role ?? row.type);
    const content = messageRecord?.content ?? row.content ?? row.text ?? row.completion;
    const parsedContent = parseClaudeContent(content, {
      timestamp,
      backgroundTaskId: extractBackgroundTaskId(row)
    });
    let toolCalls = [...parsedContent.toolUses];
    const textSegments = [...parsedContent.textSegments];

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
      if (toolCall.id) {
        toolMessageIndex.set(toolCall.id, messageIndex);
      }
    }
  });

  const firstUserMessage = messages.find((message) => message.role === "user");
  const firstUserTitle = firstUserMessage ? previewText(firstUserMessage.text, 80) : undefined;

  return buildSession(bundle, "claude", {
    title: firstUserTitle ?? (cwd ? `${basenameTitle(cwd) || "project"} · Claude` : undefined) ?? bundle.title,
    cwd,
    messages,
    metadata: {
      cwd: cwd ?? null
    }
  });
}

function parseClaudeContent(
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

function extractBackgroundTaskId(row: Record<string, unknown>): string | undefined {
  const toolUseResult =
    row.toolUseResult && typeof row.toolUseResult === "object"
      ? (row.toolUseResult as Record<string, unknown>)
      : undefined;
  return typeof toolUseResult?.backgroundTaskId === "string"
    ? toolUseResult.backgroundTaskId
    : undefined;
}

function parseClaudeQueueOperation(row: Record<string, unknown>): ClaudeQueueOperation | null {
  const operation = typeof row.operation === "string" ? row.operation : "unknown";
  const content = typeof row.content === "string" ? row.content : "";
  const taggedContent = parseTaggedContent(content);

  if (!content.trim() && operation !== "enqueue") {
    return {
      operation
    };
  }

  return {
    operation,
    taskId: taggedContent["task-id"],
    toolUseId: taggedContent["tool-use-id"],
    status: taggedContent.status,
    summary: taggedContent.summary,
    outputFile: taggedContent["output-file"]
  };
}

function parseTaggedContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const match = line.trim().match(/^<([a-z0-9-]+)>([\s\S]*?)<\/\1>$/i);
    if (!match) {
      continue;
    }

    result[match[1]] = match[2].trim();
  }

  return result;
}

function mergeBackgroundTask(
  existing: BackgroundTask | undefined,
  queueOperation: ClaudeQueueOperation
): BackgroundTask {
  return {
    taskId: queueOperation.taskId ?? existing?.taskId,
    toolUseId: queueOperation.toolUseId ?? existing?.toolUseId,
    status: normalizeBackgroundTaskStatus(queueOperation.status ?? existing?.status),
    summary: queueOperation.summary ?? existing?.summary,
    outputFile: queueOperation.outputFile ?? existing?.outputFile
  };
}

function normalizeBackgroundTaskStatus(status: string | undefined): string {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) {
    return "unknown";
  }
  return value;
}

function deriveToolCallStatusFromBackgroundTask(
  status: string | undefined
): ToolCall["status"] {
  const value = normalizeBackgroundTaskStatus(status);
  if (value === "completed" || value === "success") {
    return "completed";
  }
  if (value === "killed" || value === "failed" || value === "error") {
    return "error";
  }
  if (value === "queued" || value === "running" || value === "started") {
    return "pending";
  }
  return "unknown";
}

function buildQueueOperationFallbackMessage(
  prefix: string,
  index: number,
  queueOperation: ClaudeQueueOperation | null,
  timestamp?: string
): Message | null {
  if (!queueOperation) {
    return null;
  }

  const detailLines: string[] = [];
  if (queueOperation.taskId) {
    detailLines.push(`task: \`${queueOperation.taskId}\``);
  }
  if (queueOperation.outputFile) {
    detailLines.push(`output file: \`${queueOperation.outputFile}\``);
  }

  if (!queueOperation.summary && detailLines.length === 0) {
    return null;
  }

  const header = queueOperation.status
    ? `Background task · ${queueOperation.status}`
    : `Background task · ${queueOperation.operation}`;
  const parts = [header];

  if (queueOperation.summary) {
    parts.push("", queueOperation.summary);
  }

  if (detailLines.length > 0) {
    parts.push("", ...detailLines);
  }

  return {
    id: `${prefix}:${index}`,
    role: "system",
    text: parts.join("\n"),
    createdAt: timestamp,
    rawType: "queue-operation"
  };
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
