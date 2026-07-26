import { promises as fs } from "node:fs";
import path from "node:path";

import { normalizePathForMatch } from "../shared/pathUtils.js";
import type { SessionSource } from "../shared/types.js";
import type { ScanRootField } from "./platformRoots.js";

/** A scan root the user added through the UI. */
export interface CustomScanRoot {
  /** Stable id so the UI can edit and remove entries. */
  id: string;
  source: SessionSource;
  path: string;
  /** Badge label; defaults to the directory name when omitted. */
  label?: string;
  enabled: boolean;
}

export interface ScanRootsConfig {
  version: 1;
  customRoots: CustomScanRoot[];
  /** Normalized paths of built-in roots the user switched off. */
  disabledDefaults: string[];
}

export const SCAN_CONFIG_VERSION = 1;

/** Sources that can hold user-configured roots, mapped to their root field. */
export const CONFIGURABLE_SOURCES: ReadonlyArray<{
  source: SessionSource;
  field: ScanRootField;
  /** What the path should point at, shown in the UI. */
  hint: string;
  /** Directories are the norm; OpenCode stores everything in one SQLite file. */
  kind: "directory" | "file";
}> = [
  { source: "codex", field: "codexSessions", hint: "a Codex `sessions` directory", kind: "directory" },
  { source: "claude", field: "claudeProjects", hint: "a Claude `projects` directory", kind: "directory" },
  { source: "gemini", field: "geminiTmp", hint: "a Gemini `tmp` directory", kind: "directory" },
  {
    source: "antigravity",
    field: "antigravityRoots",
    hint: "an Antigravity root holding `conversations` or `brain`",
    kind: "directory"
  },
  {
    source: "copilot",
    field: "copilotSessionState",
    hint: "a Copilot `session-state` directory",
    kind: "directory"
  },
  { source: "opencode", field: "openCodeDb", hint: "an `opencode.db` file", kind: "file" }
];

export function scanRootFieldForSource(source: SessionSource): ScanRootField | undefined {
  return CONFIGURABLE_SOURCES.find((entry) => entry.source === source)?.field;
}

export function isConfigurableSource(value: unknown): value is SessionSource {
  return CONFIGURABLE_SOURCES.some((entry) => entry.source === value);
}

export function normalizeRootKey(rootPath: string): string {
  return normalizePathForMatch(rootPath).replace(/\/+$/, "");
}

export function emptyScanRootsConfig(): ScanRootsConfig {
  return { version: SCAN_CONFIG_VERSION, customRoots: [], disabledDefaults: [] };
}

export function resolveScanConfigPath(baseDir = path.resolve(process.cwd(), "data")): string {
  return path.join(baseDir, "scan-roots.json");
}

/**
 * Coerces arbitrary parsed JSON into a valid config. Unknown sources, blank
 * paths and malformed entries are dropped rather than failing the read, so a
 * hand-edited file can never break scanning.
 */
export function sanitizeScanRootsConfig(value: unknown): ScanRootsConfig {
  const config = emptyScanRootsConfig();
  if (!value || typeof value !== "object") {
    return config;
  }

  const record = value as Record<string, unknown>;
  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();

  if (Array.isArray(record.customRoots)) {
    for (const entry of record.customRoots) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const rootPath = String(candidate.path ?? "").trim();
      if (!rootPath || !isConfigurableSource(candidate.source)) {
        continue;
      }

      // One entry per (source, path) pair; later duplicates are dropped.
      const dedupeKey = `${candidate.source}::${normalizeRootKey(rootPath)}`;
      if (seenRoots.has(dedupeKey)) {
        continue;
      }
      seenRoots.add(dedupeKey);

      let id = String(candidate.id ?? "").trim();
      if (!id || seenIds.has(id)) {
        id = `root-${seenIds.size + 1}-${normalizeRootKey(rootPath).slice(-24)}`;
      }
      seenIds.add(id);

      const label = String(candidate.label ?? "").trim();
      config.customRoots.push({
        id,
        source: candidate.source,
        path: rootPath,
        label: label || undefined,
        enabled: candidate.enabled !== false
      });
    }
  }

  if (Array.isArray(record.disabledDefaults)) {
    const disabled = new Set<string>();
    for (const entry of record.disabledDefaults) {
      const normalized = normalizeRootKey(String(entry ?? "").trim());
      if (normalized) {
        disabled.add(normalized);
      }
    }
    config.disabledDefaults = [...disabled];
  }

  return config;
}

export async function readScanRootsConfig(
  configPath = resolveScanConfigPath()
): Promise<ScanRootsConfig> {
  try {
    const content = await fs.readFile(configPath, "utf8");
    return sanitizeScanRootsConfig(JSON.parse(content));
  } catch {
    // Missing or unreadable config simply means "no customization yet".
    return emptyScanRootsConfig();
  }
}

export async function writeScanRootsConfig(
  config: ScanRootsConfig,
  configPath = resolveScanConfigPath()
): Promise<ScanRootsConfig> {
  const sanitized = sanitizeScanRootsConfig(config);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  // Write through a temp file so a crash mid-write cannot truncate the config.
  const tempPath = `${configPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, configPath);
  return sanitized;
}
