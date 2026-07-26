import type { BackgroundTask, Message, Session, SessionBundle, ToolCall, SubagentNotification } from "../../shared/types.js";
import {
  addToolCall,
  basenameTitle,
  buildFallbackSession,
  buildSession,
  normalizeRole,
  parseJsonLines,
  previewText,
  toIsoTimestamp
} from "./utils.js";
import { parseClaudeContent, extractClaudeParentThreadId, extractClaudeSessionId } from "../../shared/extractors/claude.js";

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
      let handledByStitching = false;
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
            handledByStitching = true;
          }
        }
      }

      const contentStr = typeof row.content === "string" ? row.content : "";
      const subagentNotification = parseClaudeTaskNotification(contentStr);

      if (subagentNotification) {
        messages.push({
          id: `${bundle.key}:${index}`,
          role: "system",
          text: contentStr,
          createdAt: timestamp,
          rawType: "queue-operation",
          subagentNotification
        });
      } else if (!handledByStitching) {
        const fallbackMessage = buildQueueOperationFallbackMessage(
          bundle.key,
          index,
          queueOperation,
          timestamp
        );
        if (fallbackMessage) {
          messages.push(fallbackMessage);
        }
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

        const toolUseResult = row.toolUseResult && typeof row.toolUseResult === "object"
          ? (row.toolUseResult as Record<string, unknown>)
          : undefined;
        if (toolUseResult && typeof toolUseResult.agentId === "string") {
          const agentId = toolUseResult.agentId.trim();
          const desc = typeof toolUseResult.description === "string" ? toolUseResult.description.trim() : "";
          existingMessage.subagentNotification = {
            agentPath: agentId,
            status: "launched",
            content: desc || "Async agent launched successfully."
          };
        }

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

    const toolUseResult = row.toolUseResult && typeof row.toolUseResult === "object"
      ? (row.toolUseResult as Record<string, unknown>)
      : undefined;

    let subagentNotification = parseClaudeTaskNotification(text);
    if (!subagentNotification && toolUseResult && typeof toolUseResult.agentId === "string") {
      const agentId = toolUseResult.agentId.trim();
      const desc = typeof toolUseResult.description === "string" ? toolUseResult.description.trim() : "";
      subagentNotification = {
        agentPath: agentId,
        status: "launched",
        content: desc || "Async agent launched successfully."
      };
    }

    messages.push({
      id: `${bundle.key}:${index}`,
      role,
      text,
      createdAt: timestamp,
      rawType: String(row.type ?? messageRecord?.type ?? "message"),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      subagentNotification
    });

    const messageIndex = messages.length - 1;
    for (const toolCall of toolCalls) {
      if (toolCall.id) {
        toolMessageIndex.set(toolCall.id, messageIndex);
      }
    }
  });

  const claudeSessionId = extractClaudeSessionId(rows, bundle.primaryPath);
  const claudeParentThreadId = extractClaudeParentThreadId(rows, bundle.primaryPath);

  const firstUserMessage = messages.find((message) => message.role === "user");
  const firstUserTitle = firstUserMessage ? previewText(firstUserMessage.text, 80) : undefined;

  return buildSession(bundle, "claude", {
    id: claudeSessionId,
    title: firstUserTitle ?? (cwd ? `${basenameTitle(cwd) || "project"} · Claude` : undefined) ?? bundle.title,
    cwd,
    messages,
    metadata: {
      cwd: cwd ?? null,
      sessionId: claudeSessionId ?? null,
      parentThreadId: claudeParentThreadId ?? null
    }
  });
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

function parseClaudeTaskNotification(text: string): SubagentNotification | undefined {
  const match = text.match(/<task-notification>([\s\S]*?)<\/task-notification>/i);
  if (!match) {
    return undefined;
  }
  const inner = match[1];
  const taskIdMatch = inner.match(/<task-id>([\s\S]*?)<\/task-id>/i);
  const statusMatch = inner.match(/<status>([\s\S]*?)<\/status>/i);
  const summaryMatch = inner.match(/<summary>([\s\S]*?)<\/summary>/i);
  const resultMatch = inner.match(/<result>([\s\S]*?)<\/result>/i);

  const taskId = taskIdMatch ? taskIdMatch[1].trim() : undefined;
  const status = statusMatch ? statusMatch[1].trim() : "unknown";
  const summary = summaryMatch ? summaryMatch[1].trim() : "";
  const result = resultMatch ? resultMatch[1].trim() : "";

  if (taskId && summary.toLowerCase().includes("agent")) {
    return {
      agentPath: taskId,
      status,
      content: result || summary || undefined
    };
  }
  return undefined;
}

