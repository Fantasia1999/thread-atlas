import { artifactRecords } from "./artifacts.js";
import type { AntigravityData } from "./shared.js";
import { arrayOfRecords, asOptionalString, isRecord } from "./shared.js";

export const TOOL_STEP_TYPES = new Set([
  "CORTEX_STEP_TYPE_RUN_COMMAND",
  "CORTEX_STEP_TYPE_VIEW_FILE",
  "CORTEX_STEP_TYPE_LIST_DIRECTORY",
  "CORTEX_STEP_TYPE_GREP_SEARCH",
  "CORTEX_STEP_TYPE_CODE_ACTION",
  "CORTEX_STEP_TYPE_COMMAND_STATUS"
]);
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function decodeToolCall(toolCall: unknown): Record<string, unknown> | undefined {
  if (!isRecord(toolCall)) {
    return undefined;
  }

  const decoded: Record<string, unknown> = {
    id: toolCall.id,
    name: toolCall.name
  };
  if ("argumentsJson" in toolCall) {
    decoded.arguments = parseMaybeJson(toolCall.argumentsJson);
  }

  return decoded;
}

export function stepPayload(step: Record<string, unknown>): [string | undefined, unknown] {
  const payloadKeys = Object.keys(step).filter(
    (key) => !["type", "status", "metadata"].includes(key)
  );
  if (payloadKeys.length === 0) {
    return [undefined, undefined];
  }
  if (payloadKeys.length === 1) {
    const key = payloadKeys[0];
    return [key, step[key]];
  }
  return [
    "payload",
    Object.fromEntries(payloadKeys.map((key) => [key, step[key]]))
  ];
}
export function extractText(stepType: string, payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (stepType === "CORTEX_STEP_TYPE_USER_INPUT") {
    return asOptionalString(payload.userResponse);
  }
  if (stepType === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
    return (
      asOptionalString(payload.modifiedResponse) ??
      asOptionalString(payload.response) ??
      asOptionalString(payload.thinking) ??
      asOptionalString(payload.stopReason)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE") {
    return asOptionalString(payload.content);
  }
  if (stepType === "CORTEX_STEP_TYPE_ERROR_MESSAGE") {
    const error = isRecord(payload.error) ? payload.error : undefined;
    return (
      asOptionalString(error?.userErrorMessage) ??
      asOptionalString(error?.shortError) ??
      asOptionalString(error?.modelErrorMessage)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_RUN_COMMAND") {
    return asOptionalString(payload.combinedOutput) ?? asOptionalString(payload.commandLine);
  }
  if (stepType === "CORTEX_STEP_TYPE_VIEW_FILE") {
    return asOptionalString(payload.content);
  }
  if (stepType === "CORTEX_STEP_TYPE_NOTIFY_USER") {
    return asOptionalString(payload.notificationContent);
  }
  if (stepType === "CORTEX_STEP_TYPE_TASK_BOUNDARY") {
    return (
      asOptionalString(payload.taskSummary) ??
      asOptionalString(payload.taskStatus) ??
      asOptionalString(payload.taskName)
    );
  }
  if (stepType === "CORTEX_STEP_TYPE_COMMAND_STATUS") {
    return asOptionalString(payload.status);
  }
  if (stepType === "CORTEX_STEP_TYPE_CONVERSATION_HISTORY") {
    return asOptionalString(payload.content);
  }
  return undefined;
}

export function extractArtifactUris(stepType: string, payload: unknown): string[] {
  if (stepType !== "CORTEX_STEP_TYPE_NOTIFY_USER" || !isRecord(payload)) {
    return [];
  }

  return Array.isArray(payload.reviewAbsoluteUris)
    ? payload.reviewAbsoluteUris.filter((uri): uri is string => typeof uri === "string")
    : [];
}

export function inferRole(stepType: string): string {
  const mapping: Record<string, string> = {
    CORTEX_STEP_TYPE_USER_INPUT: "user",
    CORTEX_STEP_TYPE_PLANNER_RESPONSE: "assistant",
    CORTEX_STEP_TYPE_NOTIFY_USER: "assistant",
    CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE: "system",
    CORTEX_STEP_TYPE_ERROR_MESSAGE: "system",
    CORTEX_STEP_TYPE_RUN_COMMAND: "tool",
    CORTEX_STEP_TYPE_VIEW_FILE: "tool",
    CORTEX_STEP_TYPE_LIST_DIRECTORY: "tool",
    CORTEX_STEP_TYPE_GREP_SEARCH: "tool",
    CORTEX_STEP_TYPE_CODE_ACTION: "tool",
    CORTEX_STEP_TYPE_COMMAND_STATUS: "tool",
    CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS: "system",
    CORTEX_STEP_TYPE_CONVERSATION_HISTORY: "system",
    CORTEX_STEP_TYPE_CHECKPOINT: "system",
    CORTEX_STEP_TYPE_TASK_BOUNDARY: "system"
  };

  return mapping[stepType] ?? "system";
}

export function compactSummaryText(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.split(/\s+/).join(" ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function latestStepByType(
  steps: Record<string, unknown>[],
  stepType: string
): [number, Record<string, unknown>] | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type === stepType) {
      return [index, step];
    }
  }

  return undefined;
}

export function inferDirectSummaryText(
  cascadeId: string,
  trajectory: Record<string, unknown>
): string {
  const steps = arrayOfRecords(trajectory.steps);
  const latestTaskBoundary = latestStepByType(steps, "CORTEX_STEP_TYPE_TASK_BOUNDARY");
  if (latestTaskBoundary) {
    const taskBoundary = isRecord(latestTaskBoundary[1].taskBoundary)
      ? latestTaskBoundary[1].taskBoundary
      : undefined;
    const taskName = compactSummaryText(taskBoundary?.taskName, 80);
    if (taskName) {
      return taskName;
    }
  }

  for (const step of steps) {
    if (step.type !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }

    const userInput = isRecord(step.userInput) ? step.userInput : undefined;
    const summaryText = compactSummaryText(userInput?.userResponse, 80);
    if (summaryText) {
      return summaryText;
    }
  }

  return cascadeId;
}

export function stepTimes(step: Record<string, unknown>): string[] {
  const metadata = isRecord(step.metadata) ? step.metadata : undefined;
  if (!metadata) {
    return [];
  }

  const keys = [
    "createdAt",
    "viewableAt",
    "finishedGeneratingAt",
    "lastCompletedChunkAt",
    "completedAt"
  ];

  return keys
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === "string");
}

export function synthesizeDirectSummary(
  cascadeId: string,
  trajectory: Record<string, unknown>
): Record<string, unknown> {
  const steps = arrayOfRecords(trajectory.steps);
  const metadata = isRecord(trajectory.metadata) ? trajectory.metadata : undefined;
  const trajectoryMetadata = metadata ?? {};

  let createdTime = asOptionalString(trajectoryMetadata.createdAt);
  if (!createdTime) {
    const firstStepTimes = steps[0] ? stepTimes(steps[0]) : [];
    createdTime = firstStepTimes[0];
  }

  const allTimes: string[] = [];
  if (createdTime) {
    allTimes.push(createdTime);
  }
  for (const step of steps) {
    allTimes.push(...stepTimes(step));
  }

  let lastUserInputTime: string | undefined;
  let lastUserInputStepIndex: number | undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }

    const times = stepTimes(step);
    lastUserInputTime = times.length > 0 ? times.sort().at(-1) : undefined;
    lastUserInputStepIndex = index;
    break;
  }

  const latestNotifyUser = latestStepByType(steps, "CORTEX_STEP_TYPE_NOTIFY_USER");
  const latestTaskBoundary = latestStepByType(steps, "CORTEX_STEP_TYPE_TASK_BOUNDARY");

  const summary: Record<string, unknown> = {
    summary: inferDirectSummaryText(cascadeId, trajectory),
    stepCount: steps.length,
    lastModifiedTime: allTimes.length > 0 ? [...allTimes].sort().at(-1) : undefined,
    trajectoryId: trajectory.trajectoryId,
    createdTime,
    workspaces: trajectoryMetadata.workspaces,
    lastUserInputTime,
    lastUserInputStepIndex,
    trajectoryMetadata: Object.keys(trajectoryMetadata).length > 0 ? trajectoryMetadata : null
  };

  if (latestNotifyUser) {
    summary.latestNotifyUserStep = {
      step: latestNotifyUser[1],
      stepIndex: latestNotifyUser[0]
    };
  }
  if (latestTaskBoundary) {
    summary.latestTaskBoundaryStep = {
      step: latestTaskBoundary[1],
      stepIndex: latestTaskBoundary[0]
    };
  }

  return summary;
}

export async function buildChatRecords(options: {
  data: AntigravityData;
  sourceJson: string | null;
  brainDir?: string;
}): Promise<Record<string, unknown>[]> {
  const { data, sourceJson, brainDir } = options;
  const trajectory = isRecord(data.trajectory) ? data.trajectory : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  const steps = arrayOfRecords(trajectory.steps);
  const summaryText = asOptionalString(summary.summary);
  const records: Record<string, unknown>[] = [
    {
      record_type: "session_meta",
      profile: "chat",
      cascade_id: data.cascadeId,
      trajectory_id: trajectory.trajectoryId,
      summary: summaryText,
      created_time: summary.createdTime,
      last_modified_time: summary.lastModifiedTime,
      status: summary.status,
      step_count: summary.stepCount,
      source_json: sourceJson,
      workspaces: summary.workspaces,
      trajectory_metadata: summary.trajectoryMetadata
    }
  ];

  for (const [stepIndex, step] of steps.entries()) {
    const stepType = String(step.type ?? "");
    const metadata = isRecord(step.metadata) ? step.metadata : {};
    const [payloadKey, payload] = stepPayload(step);

    if (stepType === "CORTEX_STEP_TYPE_USER_INPUT" && isRecord(payload)) {
      const content = asOptionalString(payload.userResponse);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "user",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          items: payload.items
        });
      }
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" && isRecord(payload)) {
      const content =
        asOptionalString(payload.modifiedResponse) ?? asOptionalString(payload.response);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          message_id: payload.messageId,
          stop_reason: payload.stopReason
        });
      }

      if (Array.isArray(payload.toolCalls)) {
        for (const [toolCallIndex, toolCall] of payload.toolCalls.entries()) {
          const decodedToolCall = decodeToolCall(toolCall);
          records.push({
            record_type: "tool_call",
            profile: "chat",
            role: "assistant",
            cascade_id: data.cascadeId,
            trajectory_id: trajectory.trajectoryId,
            summary: summaryText,
            source_json: sourceJson,
            step_index: stepIndex,
            tool_call_index: toolCallIndex,
            created_at: metadata.createdAt,
            tool_name: decodedToolCall?.name,
            tool_call: decodedToolCall
          });
        }
      }
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_NOTIFY_USER" && isRecord(payload)) {
      const content = asOptionalString(payload.notificationContent);
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          artifact_uris: Array.isArray(payload.reviewAbsoluteUris) ? payload.reviewAbsoluteUris : [],
          blocking: payload.isBlocking
        });
      }
      continue;
    }

    if (TOOL_STEP_TYPES.has(stepType)) {
      records.push({
        record_type: "tool_result",
        profile: "chat",
        role: "tool",
        cascade_id: data.cascadeId,
        trajectory_id: trajectory.trajectoryId,
        summary: summaryText,
        source_json: sourceJson,
        step_index: stepIndex,
        created_at: metadata.createdAt,
        completed_at: metadata.completedAt,
        tool_name: toolNameForStep(step),
        tool_call: decodeToolCall(metadata.toolCall),
        payload_key: payloadKey,
        payload,
        content: extractText(stepType, payload)
      });
      continue;
    }

    if (stepType === "CORTEX_STEP_TYPE_ERROR_MESSAGE" && isRecord(payload)) {
      const content = extractText(stepType, payload);
      if (content) {
        const errorPayload = isRecord(payload.error) ? payload.error : {};
        records.push({
          record_type: "message",
          profile: "chat",
          role: "system",
          cascade_id: data.cascadeId,
          trajectory_id: trajectory.trajectoryId,
          summary: summaryText,
          source_json: sourceJson,
          step_index: stepIndex,
          created_at: metadata.createdAt,
          content,
          message_type: "error",
          short_error: errorPayload.shortError
        });
      }
    }
  }

  if (brainDir) {
    records.push(...(await artifactRecords(data.cascadeId, trajectory.trajectoryId, summaryText, brainDir)));
  }

  return records;
}

export function buildChatRecordsFromTranscriptRows(
  cascadeId: string,
  rows: Array<Record<string, unknown>>,
  sourceJson: string
): Record<string, unknown>[] {
  const timestamps = rows
    .map((row) => asOptionalString(row.created_at))
    .filter((value): value is string => Boolean(value));
  const records: Record<string, unknown>[] = [
    {
      record_type: "session_meta",
      profile: "chat",
      cascade_id: cascadeId,
      created_time: timestamps[0],
      last_modified_time: timestamps.at(-1),
      step_count: rows.length,
      source_json: sourceJson
    }
  ];
  const pendingToolCallIds = new Map<string, string[]>();

  for (const [index, row] of rows.entries()) {
    const stepType = String(row.type ?? "");
    const createdAt = row.created_at;
    const content = asOptionalString(row.content);

    if (stepType === "USER_INPUT") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "user",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content
        });
      }
      continue;
    }

    if (stepType === "PLANNER_RESPONSE") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "assistant",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content,
          thinking: row.thinking
        });
      }

      if (Array.isArray(row.tool_calls)) {
        for (const [toolCallIndex, toolCall] of row.tool_calls.entries()) {
          const toolCallRecord = isRecord(toolCall) ? toolCall : {};
          const toolName = asOptionalString(toolCallRecord.name) ?? "tool";
          const toolCallId = `${row.step_index ?? index}:${toolCallIndex}`;
          const pendingIds = pendingToolCallIds.get(toolName) ?? [];
          pendingIds.push(toolCallId);
          pendingToolCallIds.set(toolName, pendingIds);

          records.push({
            record_type: "tool_call",
            profile: "chat",
            role: "assistant",
            cascade_id: cascadeId,
            source_json: sourceJson,
            step_index: row.step_index ?? index,
            tool_call_index: toolCallIndex,
            created_at: createdAt,
            tool_name: toolName,
            tool_call: {
              id: toolCallId,
              name: toolName,
              arguments: toolCallRecord.args
            }
          });
        }
      }
      continue;
    }

    if (stepType === "CONVERSATION_HISTORY" && !content) {
      continue;
    }

    if (stepType === "SYSTEM_MESSAGE" || stepType === "CONVERSATION_HISTORY") {
      if (content) {
        records.push({
          record_type: "message",
          profile: "chat",
          role: "system",
          cascade_id: cascadeId,
          source_json: sourceJson,
          step_index: row.step_index ?? index,
          created_at: createdAt,
          content,
          message_type: stepType.toLowerCase()
        });
      }
      continue;
    }

    if (content || stepType) {
      let toolName = transcriptToolName(stepType);
      if (toolName === "code_action") {
        const candidates = ["replace_file_content", "write_to_file", "multi_replace_file_content", "write_file", "edit_file"];
        for (const candidate of candidates) {
          if (pendingToolCallIds.has(candidate)) {
            toolName = candidate;
            break;
          }
        }
      }

      const pendingIds = pendingToolCallIds.get(toolName) ?? [];
      const toolCallId = pendingIds.shift() ?? `${row.step_index ?? index}:result`;
      if (pendingIds.length > 0) {
        pendingToolCallIds.set(toolName, pendingIds);
      } else {
        pendingToolCallIds.delete(toolName);
      }

      records.push({
        record_type: "tool_result",
        profile: "chat",
        role: "tool",
        cascade_id: cascadeId,
        source_json: sourceJson,
        step_index: row.step_index ?? index,
        created_at: createdAt,
        completed_at: createdAt,
        tool_name: toolName,
        tool_call: {
          id: toolCallId,
          name: toolName
        },
        payload_key: stepType.toLowerCase(),
        payload: row,
        content: content ?? stringifyJsonValue(row)
      });
    }
  }

  return records;
}

export function transcriptToolName(stepType: string): string {
  const mapping: Record<string, string> = {
    LIST_DIRECTORY: "list_dir",
    VIEW_FILE: "view_file",
    RUN_COMMAND: "run_command",
    GREP_SEARCH: "grep_search",
    CODE_ACTION: "code_action",
    GENERIC: "generic"
  };
  return mapping[stepType] ?? stepType.toLowerCase();
}

export function toolNameForStep(step: Record<string, unknown>): string | undefined {
  const metadata = isRecord(step.metadata) ? step.metadata : undefined;
  const toolCall = isRecord(metadata?.toolCall) ? metadata.toolCall : undefined;
  const toolName = asOptionalString(toolCall?.name);
  if (toolName) {
    return toolName;
  }

  const mapping: Record<string, string> = {
    CORTEX_STEP_TYPE_RUN_COMMAND: "run_command",
    CORTEX_STEP_TYPE_VIEW_FILE: "view_file",
    CORTEX_STEP_TYPE_LIST_DIRECTORY: "list_directory",
    CORTEX_STEP_TYPE_GREP_SEARCH: "grep_search",
    CORTEX_STEP_TYPE_CODE_ACTION: "code_action",
    CORTEX_STEP_TYPE_COMMAND_STATUS: "command_status"
  };
  return mapping[String(step.type ?? "")];
}
function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const text = JSON.stringify(value, null, 2);
  return text || "";
}
