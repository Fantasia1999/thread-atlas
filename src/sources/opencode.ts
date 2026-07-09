import { parseOpenCodeSession } from "../parsers/opencode.js";
import type { SourceAdapter } from "./types.js";

export const opencodeAdapter: SourceAdapter = {
  id: "opencode",
  label: "OpenCode",
  detect(bundle, context) {
    return (
      context.combinedPath.includes("opencode") ||
      bundle.files.some((file) => file.path.endsWith("#session.json")) ||
      context.firstContent.includes("\"modelID\"") ||
      context.firstContent.includes("\"providerID\"")
    );
  },
  parse: parseOpenCodeSession
};
