import type { Session } from "../../shared/types.js";
import { parseCopilotSession } from "../parsers/copilot.js";
import type { ResumeCommandOptions, SourceAdapter } from "./types.js";

export function buildCopilotResumeCommand(
  session: Session,
  _options?: ResumeCommandOptions
): string | null {
  if (session.source !== "copilot") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `copilot --session-id=${sessionId}`;
}

export const copilotAdapter: SourceAdapter = {
  id: "copilot",
  label: "Copilot",
  detect(bundle, context) {
    return (
      context.combinedPath.includes(".copilot") ||
      context.combinedPath.includes("/session-state/") ||
      bundle.files.some((file) => file.path.endsWith("events.jsonl")) ||
      (context.firstContent.includes("\"type\":\"session.start\"") &&
        (context.firstContent.includes("\"producer\":\"copilot-agent\"") ||
          context.firstContent.includes("\"type\":\"assistant.turn_start\"") ||
          context.firstContent.includes("\"type\":\"tool.execution_start\"")))
    );
  },
  parse: parseCopilotSession,
  buildResumeCommand: buildCopilotResumeCommand
};
