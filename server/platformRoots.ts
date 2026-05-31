import os from "node:os";
import path from "node:path";

export interface ResolveRootsOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LocalScanRoots {
  codexSessions: string;
  claudeProjects: string;
  geminiTmp: string;
  antigravityRoots: string[];
  antigravityCliHistory: string;
  copilotSessionState: string;
  openCodeDb: string;
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
 */
export function resolveLocalScanRoots(options: ResolveRootsOptions = {}): LocalScanRoots {
  const { platform, home, env } = resolveContext(options);
  const p = platform === "win32" ? path.win32 : path.posix;

  return {
    codexSessions: p.join(home, ".codex", "sessions"),
    claudeProjects: p.join(home, ".claude", "projects"),
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
