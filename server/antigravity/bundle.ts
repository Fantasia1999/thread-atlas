import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MetadataValue, SessionBundle, SessionDescriptor } from "../../src/parsers/types.js";
import { resolveLocalScanRoots } from "../platformRoots.js";
import { extractAntigravityPreviewTitle } from "../../src/parsers/antigravity.js";
import { hasJsonLinesParseError, parseJsonLines } from "../fsUtils.js";
import { antigravitySessionIdFromPath, isAntigravityTranscriptPath, resolveBrainDirFromConversationPath, resolvePreferredAntigravitySessionPath } from "./paths.js";
import { decodeAntigravityTrajectory, getSharedDirectPbDecoder } from "./pbDecoder.js";
import { buildChatRecords, buildChatRecordsFromTranscriptRows, synthesizeDirectSummary } from "./records.js";
import type { AntigravityData } from "./shared.js";
import { asOptionalString, isRecord } from "./shared.js";

export function buildAntigravityDescriptor(
  absolutePath: string,
  origin: "local" | "remote",
  stats: {
    size: number;
    mtimeMs: number;
  },
  content?: string
): SessionDescriptor {
  const cascadeId = antigravitySessionIdFromPath(absolutePath) ?? path.basename(absolutePath);
  const loaderBackend = isAntigravityTranscriptPath(absolutePath) ? "transcript" : "direct";

  let title: string | undefined;
  let hasToleratedError = false;
  
  const isDb = absolutePath.toLowerCase().endsWith(".db");

  if (content && !isDb) {
    if (isAntigravityTranscriptPath(absolutePath)) {
      hasToleratedError = hasJsonLinesParseError(content);
    }
    title = extractAntigravityPreviewTitle(content);
  }

  let primaryWorkspace: string | undefined;
  if (isDb) {
    try {
      const db = new DatabaseSync(absolutePath, { readOnly: true });
      const query = db.prepare("SELECT idx, step_payload FROM steps ORDER BY idx LIMIT 10;");
      const rows = query.all() as any[];
      
      const decoder = getSharedDirectPbDecoder();
      for (const row of rows) {
        if (row.step_payload) {
          try {
            const step = decoder.decodeMessage(".gemini_coder.Step", Buffer.from(row.step_payload)) as any;
            if (step && typeof step === "object") {
              if (!title && step.type === "CORTEX_STEP_TYPE_USER_INPUT" && typeof step.userInput?.userResponse === "string") {
                title = step.userInput.userResponse;
                if (title && title.length > 80) {
                  title = title.slice(0, 80) + "...";
                }
              }
              if (!primaryWorkspace && step.metadata?.workspaces) {
                primaryWorkspace = extractPrimaryWorkspace(step.metadata.workspaces);
              }
            }
          } catch {
            // Ignore
          }
        }
        if (title && primaryWorkspace) {
          break;
        }
      }
    } catch {
      // Ignore
    }
  }

  const baseTitle = title ?? buildAntigravityTitle(cascadeId, primaryWorkspace);

  const displayTitle = hasToleratedError ? `⚠️ ${baseTitle}` : baseTitle;

  return {
    key: `file::${absolutePath}`,
    source: "antigravity",
    title: displayTitle,
    primaryPath: absolutePath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 1,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    metadata: {
      cascadeId,
      loaderBackend
    }
  };
}
async function findWorkspaceFromHistory(cascadeId: string): Promise<string | undefined> {
  try {
    const historyPath = resolveLocalScanRoots().antigravityCliHistory;
    const content = await fs.readFile(historyPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.conversationId === cascadeId && typeof entry.workspace === "string" && entry.workspace.trim()) {
          return entry.workspace;
        }
      } catch {
        // Ignore JSON parsing errors
      }
    }
  } catch {
    // Ignore file reading errors
  }
  return undefined;
}

export async function loadAntigravityBundle(
  absolutePath: string,
  origin: "local" | "remote"
): Promise<SessionBundle> {
  const preferredPath = await resolvePreferredAntigravitySessionPath(absolutePath);
  if (preferredPath && preferredPath !== absolutePath) {
    return await loadAntigravityBundle(preferredPath, origin);
  }

  if (isAntigravityTranscriptPath(absolutePath)) {
    return await loadAntigravityTranscriptBundle(absolutePath, origin);
  }

  const stats = await fs.stat(absolutePath);
  const { descriptorSource, trajectory } = await decodeAntigravityTrajectory(absolutePath);
  const cascadeId = String(trajectory.cascadeId ?? path.basename(absolutePath, ".pb"));
  const summary = synthesizeDirectSummary(cascadeId, trajectory);
  const brainDir = resolveBrainDirFromConversationPath(absolutePath, cascadeId);
  const data: AntigravityData = {
    cascadeId,
    summary,
    trajectory
  };
  const records = await buildChatRecords({
    data,
    sourceJson: null,
    brainDir
  });
  const historyWorkspace = await findWorkspaceFromHistory(cascadeId);
  const primaryWorkspace = historyWorkspace ?? extractPrimaryWorkspace(summary.workspaces);

  const recordsContent = records.map((record) => JSON.stringify(record)).join("\n");
  const firstUserTitle = extractAntigravityPreviewTitle(recordsContent);
  const title = firstUserTitle ?? buildAntigravityTitle(cascadeId, primaryWorkspace);

  const descriptor = buildAntigravityDescriptor(absolutePath, origin, stats, recordsContent);

  return {
    ...descriptor,
    title,
    metadata: {
      ...descriptor.metadata,
      trajectoryId: toMetadataValue(summary.trajectoryId),
      status: toMetadataValue(summary.status),
      stepCount: toMetadataValue(summary.stepCount),
      descriptorSource,
      primaryWorkspace: toMetadataValue(primaryWorkspace),
      workspaces: stringifyMetadata(summary.workspaces)
    },
    files: [
      {
        path: `${absolutePath}#chat.jsonl`,
        content: recordsContent
      }
    ]
  };
}

export async function loadAntigravityTranscriptBundle(
  absolutePath: string,
  origin: "local" | "remote"
): Promise<SessionBundle> {
  const [stats, content] = await Promise.all([
    fs.stat(absolutePath),
    fs.readFile(absolutePath, "utf8")
  ]);
  const descriptor = buildAntigravityDescriptor(absolutePath, origin, stats, content);
  const cascadeId = antigravitySessionIdFromPath(absolutePath) ?? path.basename(absolutePath);
  const rows = parseJsonLines(content);
  const records = buildChatRecordsFromTranscriptRows(cascadeId, rows, absolutePath);

  // Read sibling messages directory if it exists
  const messagesDir = path.resolve(path.dirname(absolutePath), "../messages");
  let messageFiles: string[] = [];
  try {
    const entries = await fs.readdir(messagesDir, { withFileTypes: true });
    messageFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "read.json")
      .map((entry) => path.join(messagesDir, entry.name));
  } catch {
    // Sibling messages directory might not exist
  }

  const messageDataList: any[] = [];
  if (messageFiles.length > 0) {
    await Promise.all(
      messageFiles.map(async (filePath) => {
        try {
          const fileContent = await fs.readFile(filePath, "utf8");
          messageDataList.push(JSON.parse(fileContent));
        } catch {
          // Ignore parse errors for individual message files
        }
      })
    );
  }

  // Sort messages by timestamp
  messageDataList.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeA - timeB;
  });

  const parsedStepIndices = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const stepIdx = typeof row.step_index === "number" ? row.step_index : index;
    parsedStepIndices.add(stepIdx);
  }

  for (const message of messageDataList) {
    const stepIndex = message.sourceMetadata?.tool?.stepIndex;
    if (typeof stepIndex === "number" && parsedStepIndices.has(stepIndex)) {
      continue;
    }

    const createdAt = message.timestamp;
    const msgContent = message.content;
    const toolCall = message.sourceMetadata?.tool?.toolCall;

    if (toolCall) {
      const toolName = toolCall.name;
      const toolCallId = toolCall.id;
      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(toolCall.argumentsJson);
      } catch {
        parsedArgs = toolCall.argumentsJson;
      }

      records.push({
        record_type: "tool_call",
        profile: "chat",
        role: "assistant",
        cascade_id: cascadeId,
        source_json: absolutePath,
        step_index: stepIndex,
        tool_call_index: 0,
        created_at: createdAt,
        tool_name: toolName,
        tool_call: {
          id: toolCallId,
          name: toolName,
          arguments: parsedArgs
        }
      });

      records.push({
        record_type: "tool_result",
        profile: "chat",
        role: "tool",
        cascade_id: cascadeId,
        source_json: absolutePath,
        step_index: stepIndex,
        created_at: createdAt,
        completed_at: createdAt,
        tool_name: toolName,
        tool_call: {
          id: toolCallId,
          name: toolName
        },
        payload_key: toolName,
        payload: message,
        content: msgContent
      });
    } else {
      records.push({
        record_type: "message",
        profile: "chat",
        role: "system",
        cascade_id: cascadeId,
        source_json: absolutePath,
        step_index: typeof stepIndex === "number" ? stepIndex : -1,
        created_at: createdAt,
        content: msgContent,
        message_type: "system"
      });
    }
  }

  // Sort all records (excluding session_meta) by step index or timestamp
  if (records.length > 1) {
    const metaRecord = records[0];
    const otherRecords = records.slice(1);
    otherRecords.sort((a: any, b: any) => {
      const idxA = typeof a.step_index === "number" ? a.step_index : -1;
      const idxB = typeof b.step_index === "number" ? b.step_index : -1;
      if (idxA !== idxB) {
        return idxA - idxB;
      }

      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (timeA !== timeB) {
        return timeA - timeB;
      }

      const typeOrder: Record<string, number> = {
        "message": 0,
        "tool_call": 1,
        "tool_result": 2,
        "artifact": 3
      };
      const orderA = typeOrder[a.record_type] ?? 99;
      const orderB = typeOrder[b.record_type] ?? 99;
      return orderA - orderB;
    });
    records.splice(1, records.length - 1, ...otherRecords);
  }

  const recordsContent = records.map((record) => JSON.stringify(record)).join("\n");
  const firstUserTitle = extractAntigravityPreviewTitle(recordsContent);
  let title = firstUserTitle ?? descriptor.title;

  const hasToleratedError = hasJsonLinesParseError(content);
  if (hasToleratedError && !title.startsWith("⚠️ ")) {
    title = `⚠️ ${title}`;
  }

  const historyWorkspace = await findWorkspaceFromHistory(cascadeId);

  return {
    ...descriptor,
    title,
    metadata: {
      ...descriptor.metadata,
      stepCount: rows.length,
      loaderBackend: "transcript",
      primaryWorkspace: historyWorkspace ? String(historyWorkspace) : null
    },
    files: [
      {
        path: `${absolutePath}#chat.jsonl`,
        content: recordsContent
      }
    ]
  };
}
export function buildAntigravityTitle(cascadeId: string, primaryWorkspace?: string): string {
  const workspaceName = primaryWorkspace
    ? primaryWorkspace.split(/[\\/]/).filter(Boolean).at(-1)
    : undefined;
  return workspaceName ? `${workspaceName} · Antigravity` : `${cascadeId} · Antigravity`;
}

export function extractPrimaryWorkspace(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return normalizeWorkspacePath(item);
      }
      if (isRecord(item)) {
        const candidate =
          asOptionalString(item.workspaceFolderAbsoluteUri) ??
          asOptionalString(item.gitRootAbsoluteUri) ??
          asOptionalString(item.workspace) ??
          asOptionalString(item.path) ??
          asOptionalString(item.root);
        if (candidate) {
          return normalizeWorkspacePath(candidate);
        }
      }
    }
  }

  const candidate = asOptionalString(value);
  return candidate ? normalizeWorkspacePath(candidate) : undefined;
}

export function toMetadataValue(value: unknown): MetadataValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return null;
}

export function stringifyMetadata(value: unknown): MetadataValue {
  if (value == null) {
    return null;
  }

  const text = JSON.stringify(value);
  return text || null;
}

function normalizeWorkspacePath(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }

  try {
    return fileURLToPath(value);
  } catch {
    return value;
  }
}
