import type { Message, Session, SessionBundle, ToolCall } from "../../shared/types.js";
import {
  buildFallbackSession,
  buildSession,
  collectText,
  normalizeRole,
  safeJsonParse,
  stringifyValue,
  toIsoTimestamp
} from "./utils.js";

interface OpenCodeSessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface OpenCodeMessageRow {
  id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpenCodePartRow {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

export function parseOpenCodeSession(bundle: SessionBundle): Session {
  const sessionFile = bundle.files.find((file) => file.path.endsWith("#session.json"));
  const messagesFile = bundle.files.find((file) => file.path.endsWith("#messages.json"));
  const partsFile = bundle.files.find((file) => file.path.endsWith("#parts.json"));

  if (sessionFile && messagesFile && partsFile) {
    const session = safeJsonParse<OpenCodeSessionRow>(sessionFile.content);
    const messages = safeJsonParse<OpenCodeMessageRow[]>(messagesFile.content) ?? [];
    const parts = safeJsonParse<OpenCodePartRow[]>(partsFile.content) ?? [];

    if (!session) {
      return buildFallbackSession(bundle, "opencode", "OpenCode session metadata is invalid.");
    }

    const partsByMessage = new Map<string, OpenCodePartRow[]>();
    for (const part of parts) {
      const collection = partsByMessage.get(part.message_id) ?? [];
      collection.push(part);
      partsByMessage.set(part.message_id, collection);
    }

    const normalizedMessages: Message[] = messages.map((row, index) => {
      const rowData = safeJsonParse<Record<string, unknown>>(row.data) ?? {};
      const timeRecord =
        rowData.time && typeof rowData.time === "object"
          ? (rowData.time as Record<string, unknown>)
          : undefined;
      const partRows = (partsByMessage.get(row.id) ?? []).sort(
        (left, right) => left.time_created - right.time_created
      );
      const textSegments: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const partRow of partRows) {
        const part = safeJsonParse<Record<string, unknown>>(partRow.data) ?? {};
        const type = String(part.type ?? "");
        if (type === "text") {
          const text = collectText(part.text);
          if (text) {
            textSegments.push(text);
          }
        } else if (type === "reasoning") {
          const reasoning = collectText(part.text);
          if (reasoning) {
            textSegments.push(`[Reasoning]\n${reasoning}`);
          }
        } else if (type === "tool") {
          toolCalls.push({
            id: String(part.callID ?? part.id ?? `${row.id}:${toolCalls.length}`),
            toolName: String(part.tool ?? "tool"),
            kind: type,
            status: inferOpenCodeToolStatus(part),
            args: stringifyValue((part.state as Record<string, unknown> | undefined)?.input),
            output: stringifyValue((part.state as Record<string, unknown> | undefined)?.output),
            startedAt: toIsoTimestamp(partRow.time_created)
          });
        }
      }

      const role = normalizeRole(rowData.role);
      const fallbackText = collectText(rowData.text ?? rowData.summary ?? rowData.message);

      return {
        id: `${bundle.key}:${index}`,
        role,
        text: textSegments.join("\n\n") || fallbackText,
        createdAt: toIsoTimestamp(timeRecord?.created ?? row.time_created),
        rawType: String(rowData.mode ?? "message"),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
    });

    return buildSession(bundle, "opencode", {
      id: session.id,
      title: session.title || bundle.title,
      cwd: session.directory,
      startedAt: toIsoTimestamp(session.time_created),
      updatedAt: toIsoTimestamp(session.time_updated),
      messages: normalizedMessages,
      metadata: {
        directory: session.directory,
        sessionId: session.id
      }
    });
  }

  const raw = safeJsonParse<unknown>(bundle.files[0]?.content ?? "");
  if (Array.isArray(raw)) {
    const messages = raw
      .map((entry, index) => {
        const record = entry as Record<string, unknown>;
        const text = collectText(record);
        if (!text) {
          return null;
        }
        const message: Message = {
          id: `${bundle.key}:${index}`,
          role: normalizeRole(record.role ?? record.type),
          text,
          createdAt: toIsoTimestamp(record.timestamp ?? record.time_created)
        };
        return message;
      })
      .filter((entry): entry is Message => entry !== null);

    if (messages.length > 0) {
      return buildSession(bundle, "opencode", {
        messages
      });
    }
  }

  return buildFallbackSession(bundle, "opencode", "Unsupported OpenCode bundle shape.");
}

function inferOpenCodeToolStatus(part: Record<string, unknown>): ToolCall["status"] {
  const state = (part.state as Record<string, unknown> | undefined)?.status;
  const finish = part.finish;
  const value = String(state ?? finish ?? "").toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (value.includes("complete") || value.includes("stop")) {
    return "completed";
  }
  if (value.includes("error") || value.includes("fail")) {
    return "error";
  }
  if (value.includes("pending") || value.includes("running")) {
    return "pending";
  }
  return "unknown";
}
