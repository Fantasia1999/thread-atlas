import type { Session, SessionBundle, SessionSource } from "./types.js";
import { parseAntigravitySession } from "./antigravity.js";
import { parseClaudeSession } from "./claude.js";
import { parseCopilotSession } from "./copilot.js";
import { parseCodexSession } from "./codex.js";
import { parseGeminiSession } from "./gemini.js";
import { parseOpenCodeSession } from "./opencode.js";
import { buildFallbackSession } from "./utils.js";

export function detectSessionSource(bundle: SessionBundle): SessionSource {
  if (bundle.source && bundle.source !== "unknown") {
    return bundle.source;
  }

  const combinedPath = normalizePathForMatch(
    `${bundle.primaryPath} ${bundle.files.map((file) => file.path).join(" ")}`
  );
  const firstContent = bundle.files[0]?.content ?? "";
  const trimmed = firstContent.trim();

  if (
    combinedPath.includes(".codex") ||
    combinedPath.includes("rollout-") ||
    firstContent.includes("\"type\":\"session_meta\"")
  ) {
    return "codex";
  }

  if (
    combinedPath.includes(".copilot") ||
    combinedPath.includes("/session-state/") ||
    bundle.files.some((file) => file.path.endsWith("events.jsonl")) ||
    (firstContent.includes("\"type\":\"session.start\"") &&
      (firstContent.includes("\"producer\":\"copilot-agent\"") ||
        firstContent.includes("\"type\":\"assistant.turn_start\"") ||
        firstContent.includes("\"type\":\"tool.execution_start\"")))
  ) {
    return "copilot";
  }

  if (combinedPath.includes(".claude") || firstContent.includes("\"tool_use\"")) {
    return "claude";
  }

  if (
    combinedPath.includes("opencode") ||
    bundle.files.some((file) => file.path.endsWith("#session.json")) ||
    firstContent.includes("\"modelID\"") ||
    firstContent.includes("\"providerID\"")
  ) {
    return "opencode";
  }

  if (
    bundle.files.some((file) => file.path.endsWith("#chat.jsonl")) ||
    combinedPath.includes("/antigravity/") ||
    (firstContent.includes("\"record_type\":\"session_meta\"") &&
      firstContent.includes("\"cascade_id\""))
  ) {
    return "antigravity";
  }

  if (
    combinedPath.includes(".gemini") ||
    firstContent.includes("\"functionCall\"") ||
    firstContent.includes("\"functionResponse\"")
  ) {
    return "gemini";
  }

  if (trimmed.startsWith("{") && firstContent.includes("\"messages\"")) {
    return "gemini";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "opencode";
  }

  return "claude";
}

export function parseSessionBundle(bundle: SessionBundle): Session {
  const source = detectSessionSource(bundle);

  try {
    switch (source) {
      case "codex":
        return parseCodexSession(bundle);
      case "copilot":
        return parseCopilotSession(bundle);
      case "claude":
        return parseClaudeSession(bundle);
      case "opencode":
        return parseOpenCodeSession(bundle);
      case "gemini":
        return parseGeminiSession(bundle);
      case "antigravity":
        return parseAntigravitySession(bundle);
      default:
        return buildFallbackSession(bundle, "unknown", "Unsupported session source.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse failure.";
    return buildFallbackSession(bundle, source, message);
  }
}

function normalizePathForMatch(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}
