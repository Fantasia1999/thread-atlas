import { normalizePathForMatch } from "../../shared/pathUtils.js";
import {
  isAntigravityConversationPath,
  isAntigravityTranscriptPath
} from "../antigravity.js";
import type { ServerSourceAdapter } from "./types.js";

export const antigravityFileSource: ServerSourceAdapter = {
  id: "antigravity",
  scanRoots: (roots) => [...roots.antigravityRoots],
  matchPath: (absolutePath) =>
    isAntigravityConversationPath(absolutePath) || isAntigravityTranscriptPath(absolutePath)
};

export const codexFileSource: ServerSourceAdapter = {
  id: "codex",
  scanRoots: (roots) => [roots.codexSessions],
  matchPath: (absolutePath) => {
    const normalized = normalizePathForMatch(absolutePath);
    return normalized.includes("/.codex/") || normalized.includes("/rollout-");
  }
};

export const claudeFileSource: ServerSourceAdapter = {
  id: "claude",
  scanRoots: (roots) => [roots.claudeProjects],
  matchPath: (absolutePath) =>
    normalizePathForMatch(absolutePath).includes("/.claude/")
};

export const opencodeFileSource: ServerSourceAdapter = {
  id: "opencode",
  scanRoots: (roots) => [roots.openCodeDb],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/opencode")
};

export const copilotFileSource: ServerSourceAdapter = {
  id: "copilot",
  scanRoots: (roots) => [roots.copilotSessionState],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/.copilot/")
};

export const geminiFileSource: ServerSourceAdapter = {
  id: "gemini",
  scanRoots: (roots) => [roots.geminiTmp],
  matchPath: (absolutePath) => normalizePathForMatch(absolutePath).includes("/.gemini/")
};
