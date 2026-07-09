import type { Session } from "../../shared/types.js";
import { parseClaudeSession } from "../parsers/claude.js";
import type { ResumeCommandOptions, SourceAdapter } from "./types.js";

export function buildClaudeResumeCommand(
  session: Session,
  options?: ResumeCommandOptions
): string | null {
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

  return `claude --resume ${projectId}${options?.unsafe ? " --dangerously-skip-permissions" : ""}`;
}

export const claudeAdapter: SourceAdapter = {
  id: "claude",
  label: "Claude",
  detect(_bundle, context) {
    return (
      context.combinedPath.includes(".claude") ||
      context.firstContent.includes("\"tool_use\"")
    );
  },
  parse: parseClaudeSession,
  buildResumeCommand: buildClaudeResumeCommand
};
