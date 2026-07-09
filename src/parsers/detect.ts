import type { Session, SessionBundle, SessionSource } from "../../shared/types.js";
import { getAdapter, SOURCE_ADAPTERS } from "../sources/registry.js";
import type { DetectContext } from "../sources/types.js";
import { buildFallbackSession } from "./utils.js";
import { normalizePathForMatch } from "../../shared/pathUtils.js";

export function detectSessionSource(bundle: SessionBundle): SessionSource {
  if (bundle.source && bundle.source !== "unknown") {
    return bundle.source;
  }

  const firstContent = bundle.files[0]?.content ?? "";
  const context: DetectContext = {
    combinedPath: normalizePathForMatch(
      `${bundle.primaryPath} ${bundle.files.map((file) => file.path).join(" ")}`
    ),
    firstContent,
    trimmed: firstContent.trim()
  };

  for (const adapter of SOURCE_ADAPTERS) {
    if (adapter.detect(bundle, context)) {
      return adapter.id;
    }
  }

  if (context.trimmed.startsWith("{") && firstContent.includes("\"messages\"")) {
    return "gemini";
  }

  if (context.trimmed.startsWith("{") || context.trimmed.startsWith("[")) {
    return "opencode";
  }

  return "claude";
}

export function parseSessionBundle(bundle: SessionBundle): Session {
  const source = detectSessionSource(bundle);

  try {
    const adapter = getAdapter(source);
    if (adapter) {
      return adapter.parse(bundle);
    }
    return buildFallbackSession(bundle, "unknown", "Unsupported session source.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse failure.";
    return buildFallbackSession(bundle, source, message);
  }
}
