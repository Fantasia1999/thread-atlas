import type { Session } from "../../shared/types.js";
import { parseCodexSession } from "../parsers/codex.js";
import type { ResumeCommandOptions, SourceAdapter } from "./types.js";

export function buildCodexResumeCommand(
  session: Session,
  options?: ResumeCommandOptions
): string | null {
  if (session.source !== "codex") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `codex resume ${sessionId}${options?.unsafe ? " --yolo" : ""}`;
}

export const codexAdapter: SourceAdapter = {
  id: "codex",
  label: "Codex",
  detect(_bundle, context) {
    return (
      context.combinedPath.includes(".codex") ||
      context.combinedPath.includes("rollout-") ||
      context.firstContent.includes("\"type\":\"session_meta\"")
    );
  },
  parse: parseCodexSession,
  buildResumeCommand: buildCodexResumeCommand
};
