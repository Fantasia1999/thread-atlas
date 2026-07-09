import type { SessionSource } from "../../shared/types.js";
import { antigravityAdapter } from "./antigravity.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { copilotAdapter } from "./copilot.js";
import { geminiAdapter } from "./gemini.js";
import { opencodeAdapter } from "./opencode.js";
import type { SourceAdapter } from "./types.js";

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  codexAdapter,
  copilotAdapter,
  claudeAdapter,
  opencodeAdapter,
  antigravityAdapter,
  geminiAdapter
];

export function getAdapter(id: SessionSource): SourceAdapter | undefined {
  return SOURCE_ADAPTERS.find((adapter) => adapter.id === id);
}

export function getSourceLabel(id: SessionSource): string {
  return getAdapter(id)?.label ?? id;
}
