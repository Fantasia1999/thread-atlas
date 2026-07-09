import { parseGeminiSession } from "../parsers/gemini.js";
import type { SourceAdapter } from "./types.js";

export const geminiAdapter: SourceAdapter = {
  id: "gemini",
  label: "Gemini",
  detect(_bundle, context) {
    return (
      context.combinedPath.includes(".gemini") ||
      context.firstContent.includes("\"functionCall\"") ||
      context.firstContent.includes("\"functionResponse\"")
    );
  },
  parse: parseGeminiSession
};
