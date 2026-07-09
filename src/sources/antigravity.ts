import type { Session } from "../../shared/types.js";
import { parseAntigravitySession } from "../parsers/antigravity.js";
import type { ResumeCommandOptions, SourceAdapter } from "./types.js";

export function buildAntigravityResumeCommand(
  session: Session,
  options?: ResumeCommandOptions
): string | null {
  if (session.source !== "antigravity") {
    return null;
  }

  const cascadeId = session.metadata.cascadeId;
  if (typeof cascadeId !== "string" || !cascadeId.trim()) {
    return null;
  }

  return `agy --conversation=${cascadeId}${options?.unsafe ? " --dangerously-skip-permissions" : ""}`;
}

export const antigravityAdapter: SourceAdapter = {
  id: "antigravity",
  label: "Antigravity",
  detect(bundle, context) {
    return (
      bundle.files.some((file) => file.path.endsWith("#chat.jsonl")) ||
      context.combinedPath.includes("/antigravity/") ||
      context.combinedPath.includes("/antigravity-cli/") ||
      (context.firstContent.includes("\"record_type\":\"session_meta\"") &&
        context.firstContent.includes("\"cascade_id\""))
    );
  },
  parse: parseAntigravitySession,
  buildResumeCommand: buildAntigravityResumeCommand
};
