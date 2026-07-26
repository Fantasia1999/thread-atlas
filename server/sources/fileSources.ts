import { isClaudeProjectsPath, normalizePathForMatch } from "../../shared/pathUtils.js";
import {
  isAntigravityConversationPath,
  isAntigravityTranscriptPath
} from "../antigravity.js";
import type { SessionSource } from "../../shared/types.js";
import type { ServerSourceAdapter } from "./types.js";

export const antigravityFileSource: ServerSourceAdapter = {
  id: "antigravity",
  scanRoots: (roots) => roots.antigravityRoots.map((root) => ({ path: root })),
  matchPath: (absolutePath) =>
    isAntigravityConversationPath(absolutePath) || isAntigravityTranscriptPath(absolutePath)
};

export const codexFileSource: ServerSourceAdapter = {
  id: "codex",
  scanRoots: (roots) => [{ path: roots.codexSessions }],
  matchPath: (absolutePath) => {
    const normalized = normalizePathForMatch(absolutePath);
    return normalized.includes("/.codex/") || normalized.includes("/rollout-");
  }
};

export const claudeFileSource: ServerSourceAdapter = {
  id: "claude",
  scanRoots: (roots) =>
    roots.claudeProjects.map((root) => ({
      path: root.projectsPath,
      archiveLabel: root.label
    })),
  // Archived history copies such as `claude-backup-pc1/projects/...` carry no
  // `.claude` segment, so match those by their `<claude-home>/projects` shape.
  matchPath: (absolutePath) =>
    normalizePathForMatch(absolutePath).includes("/.claude/") ||
    isClaudeProjectsPath(absolutePath)
};

export const opencodeFileSource: ServerSourceAdapter = {
  id: "opencode",
  scanRoots: (roots) => [{ path: roots.openCodeDb }],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/opencode")
};

export const copilotFileSource: ServerSourceAdapter = {
  id: "copilot",
  scanRoots: (roots) => [{ path: roots.copilotSessionState }],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/.copilot/")
};

export const geminiFileSource: ServerSourceAdapter = {
  id: "gemini",
  scanRoots: (roots) => [{ path: roots.geminiTmp }],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/.gemini/")
};

export const FILE_SOURCE_ADAPTERS: readonly ServerSourceAdapter[] = [
  antigravityFileSource,
  codexFileSource,
  claudeFileSource,
  opencodeFileSource,
  copilotFileSource,
  geminiFileSource
];

export function inferFileSource(absolutePath: string): SessionSource {
  return FILE_SOURCE_ADAPTERS.find((adapter) => adapter.matchPath(absolutePath))?.id ?? "unknown";
}
