import os from "node:os";
import path from "node:path";

import { basenameFromAnyPath, normalizePathForMatch } from "../shared/pathUtils.js";

export interface ResolveRootsOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * One Claude history location. Users can keep several: the live `~/.claude`
 * plus archived copies restored from other machines.
 */
export interface ClaudeHistoryRoot {
  /** Absolute path to the `projects` directory holding session JSONL files. */
  projectsPath: string;
  /**
   * Display label for an archived root, taken from its home directory name
   * (e.g. `claude-backup-pc1`). Undefined for the live `~/.claude` root so
   * ordinary sessions stay unlabeled.
   */
  label?: string;
}

export interface LocalScanRoots {
  codexSessions: string;
  claudeProjects: ClaudeHistoryRoot[];
  geminiTmp: string;
  antigravityRoots: string[];
  antigravityCliHistory: string;
  copilotSessionState: string;
  openCodeDb: string;
}

export const CLAUDE_ROOTS_ENV_VAR = "ATLAS_CLAUDE_ROOTS";

/**
 * Merges Claude history roots, keeping the first entry for any duplicate
 * `projects` path so the unlabeled live root always wins over a discovered or
 * configured duplicate of itself.
 */
export function mergeClaudeHistoryRoots(
  ...groups: ReadonlyArray<readonly ClaudeHistoryRoot[]>
): ClaudeHistoryRoot[] {
  const merged = new Map<string, ClaudeHistoryRoot>();
  for (const group of groups) {
    for (const root of group) {
      const key = normalizePathForMatch(root.projectsPath).replace(/\/+$/, "");
      if (!merged.has(key)) {
        merged.set(key, root);
      }
    }
  }
  return [...merged.values()];
}

/**
 * Reads extra Claude history roots from `ATLAS_CLAUDE_ROOTS`. Entries are
 * separated by the platform path delimiter (`:` on POSIX, `;` on Windows so
 * drive letters stay intact) and may point either at a history home or directly
 * at its `projects` directory.
 */
function resolveConfiguredClaudeRoots(
  p: path.PlatformPath,
  env: NodeJS.ProcessEnv
): ClaudeHistoryRoot[] {
  const raw = env[CLAUDE_ROOTS_ENV_VAR]?.trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(p === path.win32 ? ";" : ":")
    .map((entry) => entry.trim().replace(/[\\/]+$/, ""))
    .filter(Boolean)
    .map((entry) => {
      const base = basenameFromAnyPath(entry);
      const pointsAtProjects = base.toLowerCase() === "projects";
      const homePath = pointsAtProjects ? p.dirname(entry) : entry;
      return {
        projectsPath: pointsAtProjects ? entry : p.join(entry, "projects"),
        label: basenameFromAnyPath(homePath) || homePath
      };
    });
}

function resolveContext(options: ResolveRootsOptions = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  return { platform, home, env };
}

function resolveOpenCodeDataDir(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv
): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) {
    return p.join(xdgDataHome, "opencode");
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) {
      return p.join(localAppData, "opencode");
    }
    const appData = env.APPDATA?.trim();
    if (appData) {
      return p.join(appData, "opencode");
    }
    return p.join(home, "AppData", "Local", "opencode");
  }

  return p.join(home, ".local", "share", "opencode");
}

/**
 * Centralizes per-OS local scan roots so scanning works on Linux, macOS, and
 * Windows. Dot-directories (.codex, .claude, .gemini, .copilot) live under the
 * user home on every platform; OpenCode follows XDG / platform data conventions.
 *
 * Claude resolves to a list: the live `~/.claude` plus any roots configured
 * through `ATLAS_CLAUDE_ROOTS`. Archived copies sitting next to `~/.claude` are
 * added separately by `discoverClaudeHistoryRoots`, which needs disk access.
 */
export function resolveLocalScanRoots(options: ResolveRootsOptions = {}): LocalScanRoots {
  const { platform, home, env } = resolveContext(options);
  const p = platform === "win32" ? path.win32 : path.posix;

  return {
    codexSessions: p.join(home, ".codex", "sessions"),
    claudeProjects: mergeClaudeHistoryRoots(
      [{ projectsPath: p.join(home, ".claude", "projects") }],
      resolveConfiguredClaudeRoots(p, env)
    ),
    geminiTmp: p.join(home, ".gemini", "tmp"),
    antigravityRoots: [
      p.join(home, ".gemini", "antigravity"),
      p.join(home, ".gemini", "antigravity-cli")
    ],
    antigravityCliHistory: p.join(home, ".gemini", "antigravity-cli", "history.jsonl"),
    copilotSessionState: p.join(home, ".copilot", "session-state"),
    openCodeDb: p.join(resolveOpenCodeDataDir(platform, home, env), "opencode.db")
  };
}
