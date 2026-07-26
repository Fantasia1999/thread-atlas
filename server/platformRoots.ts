import os from "node:os";
import path from "node:path";

import { basenameFromAnyPath, normalizePathForMatch } from "../shared/pathUtils.js";

export interface ResolveRootsOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * One directory (or file, for OpenCode) that a source is scanned from. Every
 * source resolves to a list so users can browse several histories at once: the
 * live one plus archived copies restored from other machines.
 */
export interface ScanRootEntry {
  path: string;
  /**
   * Badge label for a non-default root, taken from its directory name (e.g.
   * `claude-backup-pc1`). Undefined for the platform default roots so ordinary
   * sessions stay unlabeled.
   */
  label?: string;
}

export interface LocalScanRoots {
  codexSessions: ScanRootEntry[];
  claudeProjects: ScanRootEntry[];
  geminiTmp: ScanRootEntry[];
  antigravityRoots: ScanRootEntry[];
  antigravityCliHistory: string;
  copilotSessionState: ScanRootEntry[];
  openCodeDb: ScanRootEntry[];
}

export const CLAUDE_ROOTS_ENV_VAR = "ATLAS_CLAUDE_ROOTS";

/** Root list fields of `LocalScanRoots`, in sidebar source order. */
export const SCAN_ROOT_FIELDS = [
  "codexSessions",
  "claudeProjects",
  "geminiTmp",
  "antigravityRoots",
  "copilotSessionState",
  "openCodeDb"
] as const;

export type ScanRootField = (typeof SCAN_ROOT_FIELDS)[number];

/**
 * Merges root lists, keeping the first entry for any duplicate path so a
 * platform default always wins over a discovered or configured duplicate of
 * itself.
 */
export function mergeScanRoots(
  ...groups: ReadonlyArray<readonly ScanRootEntry[]>
): ScanRootEntry[] {
  const merged = new Map<string, ScanRootEntry>();
  for (const group of groups) {
    for (const root of group) {
      const key = normalizePathForMatch(root.path).replace(/\/+$/, "");
      if (!merged.has(key)) {
        merged.set(key, root);
      }
    }
  }
  return [...merged.values()];
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
 * Reads extra Claude history roots from `ATLAS_CLAUDE_ROOTS`. Entries are
 * separated by the platform path delimiter (`:` on POSIX, `;` on Windows so
 * drive letters stay intact) and may point either at a history home or directly
 * at its `projects` directory.
 */
function resolveConfiguredClaudeRoots(
  p: path.PlatformPath,
  env: NodeJS.ProcessEnv
): ScanRootEntry[] {
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
        path: pointsAtProjects ? entry : p.join(entry, "projects"),
        label: basenameFromAnyPath(homePath) || homePath
      };
    });
}

/**
 * Centralizes per-OS local scan roots so scanning works on Linux, macOS, and
 * Windows. Dot-directories (.codex, .claude, .gemini, .copilot) live under the
 * user home on every platform; OpenCode follows XDG / platform data conventions.
 *
 * These are the built-in defaults only. Archived Claude copies found on disk and
 * roots the user configured in the UI are layered on by
 * `resolveEffectiveScanRoots`.
 */
export function resolveLocalScanRoots(options: ResolveRootsOptions = {}): LocalScanRoots {
  const { platform, home, env } = resolveContext(options);
  const p = platform === "win32" ? path.win32 : path.posix;

  return {
    codexSessions: [{ path: p.join(home, ".codex", "sessions") }],
    claudeProjects: mergeScanRoots(
      [{ path: p.join(home, ".claude", "projects") }],
      resolveConfiguredClaudeRoots(p, env)
    ),
    geminiTmp: [{ path: p.join(home, ".gemini", "tmp") }],
    antigravityRoots: [
      { path: p.join(home, ".gemini", "antigravity") },
      { path: p.join(home, ".gemini", "antigravity-cli") }
    ],
    antigravityCliHistory: p.join(home, ".gemini", "antigravity-cli", "history.jsonl"),
    copilotSessionState: [{ path: p.join(home, ".copilot", "session-state") }],
    openCodeDb: [{ path: p.join(resolveOpenCodeDataDir(platform, home, env), "opencode.db") }]
  };
}
