import { parseJsonLines } from "../jsonl.js";
import { basenameTitle, collectText, normalizeRole, previewText } from "../parserUtils.js";

const CODEX_TITLE_PREVIEW_LENGTH = 80;

export function extractCodexCwd(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  for (const row of rows) {
    if (row.type === "session_meta") {
      const payload = row.payload as Record<string, unknown> | undefined;
      if (typeof payload?.cwd === "string") {
        return payload.cwd;
      }
    }
  }
  return undefined;
}

export function extractCodexSessionId(content: string | unknown[], absolutePath: string): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (row.type === "session_meta") {
        const payload = row.payload as Record<string, unknown> | undefined;
        if (typeof payload?.id === "string") {
          return payload.id;
        }
        if (typeof payload?.session_id === "string") {
          return payload.session_id;
        }
      }
    }
  } catch {
    // ignore
  }

  const base = basenameTitle(absolutePath);
  const match = base.match(/rollout-.*-([a-fA-F0-9-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return undefined;
}

export function extractCodexParentThreadId(content: string | unknown[]): string | undefined {
  try {
    const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
    for (const row of rows) {
      if (row.type === "session_meta") {
        const payload = row.payload as Record<string, unknown> | undefined;
        const parentThreadId =
          typeof payload?.parent_thread_id === "string"
            ? payload.parent_thread_id
            : typeof (payload?.source as any)?.subagent?.thread_spawn?.parent_thread_id === "string"
              ? (payload?.source as any).subagent.thread_spawn.parent_thread_id
              : undefined;
        if (parentThreadId) {
          return parentThreadId;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}


export function extractCodexPreviewTitle(content: string | unknown[]): string | undefined {
  const rows = (Array.isArray(content) ? content : parseJsonLines(content)) as Array<Record<string, any>>;
  let threadName: string | undefined;
  let firstUserTitle: string | undefined;

  for (const row of rows) {
    const rowType = String(row.type ?? "");
    const payload = (row.payload as Record<string, unknown> | undefined) ?? {};

    if (rowType === "event_msg") {
      const eventType = String(payload.type ?? "");
      if (eventType === "thread_name_updated") {
        const nextThreadName = normalizeThreadName(payload.thread_name);
        if (nextThreadName) {
          threadName = nextThreadName;
        }
        continue;
      }
      if (eventType === "user_message" && firstUserTitle == null) {
        const text = collectText(payload.message);
        if (text.trim() && !isSystemInstructionText(text)) {
          firstUserTitle = previewTitle(text);
        }
      }
    } else if (rowType === "response_item") {
      const responseType = String(payload.type ?? "");
      if (responseType === "message") {
        const role = normalizeRole(payload.role);
        if (role === "user" && firstUserTitle == null) {
          const text = collectText(payload.content);
          if (text.trim() && !isSystemInstructionText(text)) {
            firstUserTitle = previewTitle(text);
          }
        }
      }
    }
  }

  return threadName ?? firstUserTitle;
}

export function normalizeThreadName(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const value = input.trim();
  return value || undefined;
}

export function cleanCodexPrompt(text: string): string {
  const match = text.match(/(?:##?\s*My request for Codex:)\s*([\s\S]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (text.includes("# Files mentioned by the user:")) {
    const lines = text.split("\n");
    const cleanLines = lines.filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith("#") && !trimmed.includes("codex-clipboard-") && !trimmed.includes("/T/codex-clipboard-");
    });
    const cleaned = cleanLines.join("\n").trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return text;
}

function previewTitle(text: string): string | undefined {
  const cleaned = cleanCodexPrompt(text);
  const title = previewText(cleaned, CODEX_TITLE_PREVIEW_LENGTH);
  return title || undefined;
}

export function isSystemInstructionText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.includes("<permissions instructions>") ||
    trimmed.includes("<INSTRUCTIONS>") ||
    trimmed.includes("# AGENTS.md instructions") ||
    trimmed.includes("<collaboration_mode>") ||
    trimmed.includes("<apps_instructions>") ||
    trimmed.includes("<skills_instructions>") ||
    trimmed.includes("<plugins_instructions>")
  );
}
