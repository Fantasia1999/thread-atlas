import type { Message, Session, SessionBundle, ToolCall } from "../../shared/types.js";
import {
  addToolCall,
  basenameTitle,
  buildFallbackSession,
  buildSession,
  collectText,
  parseJsonLines,
  safeJsonParse,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

interface CopilotEvent {
  type?: unknown;
  data?: unknown;
  id?: unknown;
  timestamp?: unknown;
}

interface CopilotToolRequest {
  toolCallId?: unknown;
  name?: unknown;
  arguments?: unknown;
  type?: unknown;
}

export function parseCopilotSession(bundle: SessionBundle): Session {
  const eventsFile = findCopilotEventsFile(bundle);
  if (!eventsFile) {
    return buildFallbackSession(bundle, "copilot", "Missing Copilot events.jsonl file.");
  }

  const events = parseJsonLines(eventsFile.content) as CopilotEvent[];
  if (events.length === 0) {
    return buildFallbackSession(bundle, "copilot", "No Copilot event records found.");
  }

  const workspace = parseCopilotWorkspace(bundle);
  const vscodeMetadata = parseCopilotMetadata(bundle);
  const messages: Message[] = [];
  const toolMessageIndex = new Map<string, number>();
  let sessionStart: Record<string, unknown> | undefined;
  let latestModel: string | undefined;
  let latestReasoningEffort: string | undefined;

  events.forEach((event, index) => {
    const eventType = String(event.type ?? "");
    const data = asRecord(event.data);
    const timestamp = toIsoTimestamp(event.timestamp ?? data.timestamp);

    if (eventType === "session.start") {
      sessionStart = data;
      return;
    }

    if (eventType === "session.model_change") {
      if (typeof data.newModel === "string") {
        latestModel = data.newModel;
      }
      if (typeof data.reasoningEffort === "string") {
        latestReasoningEffort = data.reasoningEffort;
      }
      return;
    }

    if (eventType === "user.message") {
      const text = extractUserText(data);
      if (!text.trim()) {
        return;
      }

      messages.push({
        id: String(event.id ?? data.interactionId ?? `${bundle.key}:${index}`),
        role: "user",
        text,
        createdAt: timestamp,
        rawType: eventType
      });
      return;
    }

    if (eventType === "assistant.message") {
      const toolCalls = extractAssistantToolRequests(data, timestamp);
      const text = extractAssistantText(data);
      if (!text.trim() && toolCalls.length === 0) {
        return;
      }

      messages.push({
        id: String(data.messageId ?? event.id ?? `${bundle.key}:${index}`),
        role: "assistant",
        text,
        createdAt: timestamp,
        rawType: eventType,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      });

      if (toolCalls.length > 0) {
        const messageIndex = messages.length - 1;
        for (const toolCall of toolCalls) {
          toolMessageIndex.set(toolCall.id, messageIndex);
        }
      }
      return;
    }

    if (eventType === "tool.execution_start") {
      const toolCallId = String(data.toolCallId ?? "");
      if (!toolCallId) {
        return;
      }

      upsertToolCall(messages, toolMessageIndex, bundle.key, toolCallId, timestamp, {
        id: toolCallId,
        toolName: String(data.toolName ?? "tool"),
        kind: "execution_start",
        status: "pending",
        args: stringifyValue(data.arguments),
        startedAt: timestamp
      });
      return;
    }

    if (eventType === "tool.execution_complete") {
      const toolCallId = String(data.toolCallId ?? "");
      if (!toolCallId) {
        return;
      }

      upsertToolCall(messages, toolMessageIndex, bundle.key, toolCallId, timestamp, {
        id: toolCallId,
        toolName: String(data.toolName ?? "tool"),
        kind: "execution_complete",
        status: data.success === false ? "error" : "completed",
        output: stringifyToolResult(data.result),
        finishedAt: timestamp
      });
      return;
    }

    const systemText = buildSystemEventText(eventType, data);
    if (!systemText) {
      return;
    }

    messages.push({
      id: String(event.id ?? `${bundle.key}:${index}`),
      role: "system",
      text: systemText,
      createdAt: timestamp,
      rawType: eventType
    });
  });

  const context = asRecord(sessionStart?.context);
  const sessionId =
    workspace.id ||
    (typeof sessionStart?.sessionId === "string" ? sessionStart.sessionId : undefined);
  const cwd =
    workspace.cwd ||
    (typeof context.cwd === "string" ? context.cwd : undefined) ||
    (typeof context.gitRoot === "string" ? context.gitRoot : undefined);
  const title =
    workspace.summary?.trim() ||
    (cwd ? `${basenameTitle(cwd) || "workspace"} · Copilot` : bundle.title || "Copilot session");

  return buildSession(bundle, "copilot", {
    id: sessionId,
    title,
    cwd,
    startedAt:
      toIsoTimestamp(workspace.created_at) ||
      toIsoTimestamp(sessionStart?.startTime) ||
      messages[0]?.createdAt,
    updatedAt: toIsoTimestamp(workspace.updated_at) || messages.at(-1)?.createdAt,
    messages,
    metadata: {
      cwd: cwd ?? null,
      sessionId: sessionId ?? null,
      summary: workspace.summary ?? null,
      producer:
        typeof sessionStart?.producer === "string"
          ? sessionStart.producer
          : stringValue(vscodeMetadata.producer),
      copilotVersion:
        typeof sessionStart?.copilotVersion === "string"
          ? sessionStart.copilotVersion
          : stringValue(vscodeMetadata.copilotVersion),
      model: latestModel ?? stringValue(vscodeMetadata.model),
      reasoningEffort: latestReasoningEffort ?? null,
      branch: stringValue(context.branch),
      gitRoot: stringValue(context.gitRoot),
      headCommit: stringValue(context.headCommit),
      baseCommit: stringValue(context.baseCommit)
    }
  });
}

function findCopilotEventsFile(bundle: SessionBundle) {
  return (
    bundle.files.find((file) => file.path.endsWith("/events.jsonl") || file.path.endsWith("\\events.jsonl")) ||
    bundle.files.find((file) => file.path === "events.jsonl") ||
    bundle.files[0]
  );
}

function parseCopilotWorkspace(bundle: SessionBundle): Record<string, string> {
  const file = bundle.files.find(
    (entry) =>
      entry.path.endsWith("/workspace.yaml") ||
      entry.path.endsWith("\\workspace.yaml") ||
      entry.path === "workspace.yaml"
  );
  if (!file) {
    return {};
  }

  return parseSimpleYamlRecord(file.content);
}

function parseCopilotMetadata(bundle: SessionBundle): Record<string, unknown> {
  const file = bundle.files.find(
    (entry) =>
      entry.path.endsWith("/vscode.metadata.json") ||
      entry.path.endsWith("\\vscode.metadata.json") ||
      entry.path === "vscode.metadata.json"
  );
  if (!file) {
    return {};
  }

  return safeJsonParse<Record<string, unknown>>(file.content) ?? {};
}

function extractUserText(data: Record<string, unknown>): string {
  return (collectText(data.content) || collectText(data.transformedContent)).trim();
}

function extractAssistantText(data: Record<string, unknown>): string {
  return collectText(data.content).trim();
}

function extractAssistantToolRequests(
  data: Record<string, unknown>,
  timestamp: string | undefined
): ToolCall[] {
  const requests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
  const toolCalls: ToolCall[] = [];

  requests.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const request = entry as CopilotToolRequest;
    toolCalls.push({
      id: String(request.toolCallId ?? index),
      toolName: String(request.name ?? "tool"),
      kind: String(request.type ?? "tool_request"),
      status: "pending",
      args: stringifyValue(request.arguments),
      startedAt: timestamp
    });
  });

  return toolCalls;
}

function buildSystemEventText(eventType: string, data: Record<string, unknown>): string {
  if (eventType === "session.info") {
    return collectText(data.message);
  }

  if (eventType === "session.mode_changed") {
    const previousMode = stringValue(data.previousMode) ?? "unknown";
    const newMode = stringValue(data.newMode) ?? "unknown";
    return `Mode changed: ${previousMode} -> ${newMode}`;
  }

  if (eventType === "session.plan_changed") {
    const operation = stringValue(data.operation) ?? "updated";
    return `Plan changed: ${operation}`;
  }

  return "";
}

function upsertToolCall(
  messages: Message[],
  toolMessageIndex: Map<string, number>,
  keyPrefix: string,
  toolCallId: string,
  timestamp: string | undefined,
  toolCall: ToolCall
): void {
  const existingIndex = toolMessageIndex.get(toolCallId);
  if (existingIndex != null) {
    const existingMessage = messages[existingIndex];
    existingMessage.toolCalls = addToolCall(existingMessage.toolCalls, toolCall);
    return;
  }

  messages.push({
    id: `${keyPrefix}:tool:${toolCallId}`,
    role: "tool",
    text: "",
    createdAt: timestamp,
    rawType: toolCall.kind,
    toolCalls: [toolCall]
  });
  toolMessageIndex.set(toolCallId, messages.length - 1);
}

function stringifyToolResult(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const detailed =
      collectText(record.detailedContent) ||
      collectText(record.content) ||
      collectText(record.error) ||
      collectText(record.message);
    if (detailed) {
      return detailed;
    }
  }

  const text = collectText(value);
  return text || stringifyValue(value);
}

function parseSimpleYamlRecord(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
