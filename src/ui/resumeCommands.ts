import type { Session } from "../../shared/types.js";

export function buildCodexResumeCommand(session: Session): string | null {
  if (session.source !== "codex") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `codex resume ${sessionId}`;
}

export function buildAntigravityResumeCommand(session: Session): string | null {
  if (session.source !== "antigravity") {
    return null;
  }

  const cascadeId = session.metadata.cascadeId;
  if (typeof cascadeId !== "string" || !cascadeId.trim()) {
    return null;
  }

  return `agy --conversation=${cascadeId}`;
}

export function buildClaudeResumeCommand(session: Session): string | null {
  if (session.source !== "claude") {
    return null;
  }

  if (!session.primaryPath) {
    return null;
  }

  const baseName = session.primaryPath.split(/[\\/]/).pop();
  if (!baseName) {
    return null;
  }

  const projectId = baseName.replace(/\.jsonl$/i, "");
  if (!projectId.trim()) {
    return null;
  }

  return `claude --resume ${projectId}`;
}

export function buildCopilotResumeCommand(session: Session): string | null {
  if (session.source !== "copilot") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `copilot --session-id=${sessionId}`;
}
