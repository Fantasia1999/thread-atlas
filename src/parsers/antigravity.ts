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

export function parseAntigravitySession(bundle: SessionBundle): Session {
  const file = bundle.files[0];
  if (!file) {
    return buildFallbackSession(bundle, "antigravity", "Missing Antigravity JSONL file.");
  }

  const rows = parseJsonLines(file.content) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return buildFallbackSession(bundle, "antigravity", "No Antigravity JSONL records found.");
  }

  const messages: Message[] = [];
  const toolMessageIndex = new Map<string, number>();
  let sessionMeta: Record<string, unknown> | undefined;

  for (const [index, row] of rows.entries()) {
    const recordType = String(row.record_type ?? "");
    const createdAt = toIsoTimestamp(
      row.created_at ?? row.completed_at ?? row.created_time ?? row.last_modified_time
    );

    if (recordType === "session_meta") {
      sessionMeta = row;
      continue;
    }

    if (recordType === "message") {
      const content = collectText(row.content);
      if (!content.trim()) {
        continue;
      }

      messages.push({
        id: `${bundle.key}:${index}`,
        role: normalizeRole(row.role),
        text: content,
        createdAt,
        rawType: String(row.message_type ?? recordType)
      });
      continue;
    }

    if (recordType === "tool_call") {
      const toolCallRecord = asRecord(row.tool_call);
      const toolKey = buildToolKey(row, toolCallRecord, index);
      upsertToolMessage(messages, toolMessageIndex, toolKey, {
        id: String(toolCallRecord?.id ?? toolKey),
        toolName: String(row.tool_name ?? toolCallRecord?.name ?? "tool"),
        kind: "tool_call",
        status: "pending",
        args: stringifyValue(toolCallRecord?.arguments ?? row.tool_call ?? ""),
        startedAt: createdAt
      }, createdAt);
      continue;
    }

    if (recordType === "tool_result") {
      const toolCallRecord = asRecord(row.tool_call);
      const toolKey = buildToolKey(row, toolCallRecord, index);
      upsertToolMessage(messages, toolMessageIndex, toolKey, {
        id: String(toolCallRecord?.id ?? toolKey),
        toolName: String(row.tool_name ?? toolCallRecord?.name ?? "tool"),
        kind: "tool_result",
        status: "completed",
        output: stringifyValue(row.content ?? row.payload ?? ""),
        finishedAt: toIsoTimestamp(row.completed_at ?? row.created_at)
      }, createdAt);
      continue;
    }

    if (recordType === "artifact") {
      const artifactLabel =
        typeof row.artifact_rel_path === "string" && row.artifact_rel_path
          ? `Artifact: ${row.artifact_rel_path}`
          : "Artifact";
      const content = collectText(row.content);

      messages.push({
        id: `${bundle.key}:artifact:${index}`,
        role: "system",
        text: content ? `${artifactLabel}\n\n${content}` : artifactLabel,
        createdAt:
          createdAt ??
          toIsoTimestamp(sessionMeta?.last_modified_time) ??
          toIsoTimestamp(sessionMeta?.created_time),
        rawType: "artifact"
      });
    }
  }

  const cascadeId =
    typeof sessionMeta?.cascade_id === "string"
      ? sessionMeta.cascade_id
      : typeof bundle.metadata.cascadeId === "string"
        ? bundle.metadata.cascadeId
        : undefined;
  const primaryWorkspace = extractPrimaryWorkspace(
    sessionMeta?.workspaces ?? bundle.metadata.primaryWorkspace
  );
  const title = buildAntigravityTitle(cascadeId, primaryWorkspace, bundle.title);
  const firstUserMessage = messages.find((message) => message.role === "user");

  return buildSession(bundle, "antigravity", {
    id: cascadeId,
    title,
    summary: previewText(
      firstUserMessage?.text ??
        (typeof sessionMeta?.summary === "string" ? sessionMeta.summary : bundle.title)
    ),
    cwd: primaryWorkspace,
    startedAt: toIsoTimestamp(sessionMeta?.created_time),
    updatedAt:
      toIsoTimestamp(sessionMeta?.last_modified_time) ?? messages.at(-1)?.createdAt,
    messages,
    metadata: {
      cascadeId: cascadeId ?? null,
      trajectoryId:
        typeof sessionMeta?.trajectory_id === "string"
          ? sessionMeta.trajectory_id
          : typeof bundle.metadata.trajectoryId === "string"
            ? bundle.metadata.trajectoryId
            : null,
      status:
        typeof sessionMeta?.status === "string"
          ? sessionMeta.status
          : typeof bundle.metadata.status === "string"
            ? bundle.metadata.status
            : null,
      stepCount:
        typeof sessionMeta?.step_count === "number"
          ? sessionMeta.step_count
          : typeof bundle.metadata.stepCount === "number"
            ? bundle.metadata.stepCount
            : null,
      workspaces:
        sessionMeta?.workspaces != null
          ? stringifyMetadataValue(sessionMeta.workspaces)
          : typeof bundle.metadata.workspaces === "string"
            ? bundle.metadata.workspaces
            : null,
      descriptorSource:
        typeof bundle.metadata.descriptorSource === "string" ? bundle.metadata.descriptorSource : null,
      primaryWorkspace: primaryWorkspace ?? null,
      loaderBackend:
        typeof bundle.metadata.loaderBackend === "string" ? bundle.metadata.loaderBackend : null
    }
  });
}

function upsertToolMessage(
  messages: Message[],
  toolMessageIndex: Map<string, number>,
  toolKey: string,
  toolCall: ToolCall,
  createdAt?: string
): void {
  const existingIndex = toolMessageIndex.get(toolKey);
  if (existingIndex == null) {
    messages.push({
      id: `${toolKey}`,
      role: "tool",
      text: "",
      createdAt,
      rawType: toolCall.kind,
      toolCalls: [toolCall]
    });
    toolMessageIndex.set(toolKey, messages.length - 1);
    return;
  }

  const existingMessage = messages[existingIndex];
  existingMessage.toolCalls = addToolCall(existingMessage.toolCalls, toolCall);
}

function buildToolKey(
  row: Record<string, unknown>,
  toolCallRecord: Record<string, unknown> | undefined,
  index: number
): string {
  if (typeof toolCallRecord?.id === "string" && toolCallRecord.id) {
    return `tool:${toolCallRecord.id}`;
  }

  const toolName =
    typeof row.tool_name === "string" && row.tool_name ? row.tool_name : "tool";
  const stepIndex = typeof row.step_index === "number" ? row.step_index : index;
  return `tool:${stepIndex}:${toolName}`;
}

function extractPrimaryWorkspace(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return normalizeWorkspacePath(item);
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const candidate =
          (typeof record.workspaceFolderAbsoluteUri === "string"
            ? record.workspaceFolderAbsoluteUri
            : undefined) ??
          (typeof record.gitRootAbsoluteUri === "string" ? record.gitRootAbsoluteUri : undefined) ??
          (typeof record.workspace === "string" ? record.workspace : undefined) ??
          (typeof record.path === "string" ? record.path : undefined) ??
          (typeof record.root === "string" ? record.root : undefined);
        if (candidate) {
          return normalizeWorkspacePath(candidate);
        }
      }
    }
  }

  if (typeof value === "string" && value.trim()) {
    return normalizeWorkspacePath(value);
  }
  return undefined;
}

function buildAntigravityTitle(
  cascadeId: string | undefined,
  primaryWorkspace: string | undefined,
  fallbackTitle: string
): string {
  const workspaceName = primaryWorkspace?.split(/[\\/]/).filter(Boolean).at(-1);
  if (workspaceName) {
    return `${workspaceName} · Antigravity`;
  }
  if (cascadeId) {
    return `${cascadeId} · Antigravity`;
  }
  return fallbackTitle || "Antigravity session";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringifyMetadataValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  return JSON.stringify(value);
}

function normalizeWorkspacePath(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }

  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value;
  }
}
