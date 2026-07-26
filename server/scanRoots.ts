import { promises as fs } from "node:fs";
import path from "node:path";

import { basenameFromAnyPath } from "../shared/pathUtils.js";
import type { SessionSource } from "../shared/types.js";
import { discoverClaudeHistoryRoots } from "./claudeArchives.js";
import {
  mergeScanRoots,
  resolveLocalScanRoots,
  SCAN_ROOT_FIELDS,
  type LocalScanRoots,
  type ResolveRootsOptions,
  type ScanRootEntry,
  type ScanRootField
} from "./platformRoots.js";
import {
  CONFIGURABLE_SOURCES,
  normalizeRootKey,
  readScanRootsConfig,
  scanRootFieldForSource,
  type ScanRootsConfig
} from "./scanConfig.js";

/** Where a resolved root came from, so the UI can show and gate the right actions. */
export type ScanRootKind = "default" | "discovered" | "custom";

export interface DescribedScanRoot {
  source: SessionSource;
  path: string;
  label?: string;
  kind: ScanRootKind;
  enabled: boolean;
  /** Present for custom roots so the UI can edit or remove them. */
  id?: string;
  exists: boolean;
}

/**
 * Container directory names that every history shares. They say nothing about
 * which machine a root came from, so a root ending in one of these is named
 * after its parent instead (`/backup/pc2-codex/sessions` → `pc2-codex`).
 */
const GENERIC_ROOT_NAMES = new Set([
  "projects",
  "sessions",
  "session-state",
  "tmp",
  "conversations",
  "brain",
  "history"
]);

function labelForCustomRoot(rootPath: string, label?: string): string | undefined {
  const explicit = label?.trim();
  if (explicit) {
    return explicit;
  }

  const base = basenameFromAnyPath(rootPath);
  const isFile = /\.[a-z0-9]+$/i.test(base);
  if (isFile || GENERIC_ROOT_NAMES.has(base.toLowerCase())) {
    return basenameFromAnyPath(path.dirname(rootPath)) || base || undefined;
  }
  return base || undefined;
}

function customRootsForField(
  config: ScanRootsConfig,
  field: ScanRootField
): ScanRootEntry[] {
  return config.customRoots
    .filter((root) => root.enabled && scanRootFieldForSource(root.source) === field)
    .map((root) => ({
      path: root.path,
      label: labelForCustomRoot(root.path, root.label)
    }));
}

function applyDisabledDefaults(
  roots: readonly ScanRootEntry[],
  config: ScanRootsConfig
): ScanRootEntry[] {
  if (config.disabledDefaults.length === 0) {
    return [...roots];
  }
  const disabled = new Set(config.disabledDefaults);
  return roots.filter((root) => !disabled.has(normalizeRootKey(root.path)));
}

/**
 * Builds the scan roots actually used by a scan: platform defaults, plus
 * archived Claude copies found on disk, plus roots the user configured in the
 * UI, minus any built-in roots they switched off.
 */
export async function resolveEffectiveScanRoots(
  options: ResolveRootsOptions & { config?: ScanRootsConfig } = {}
): Promise<LocalScanRoots> {
  const defaults = resolveLocalScanRoots(options);
  const config = options.config ?? (await readScanRootsConfig());
  const discovered = await discoverClaudeHistoryRoots({ home: options.home });

  const resolved = { ...defaults };
  for (const field of SCAN_ROOT_FIELDS) {
    const base = field === "claudeProjects"
      ? mergeScanRoots(defaults.claudeProjects, discovered)
      : defaults[field];

    resolved[field] = mergeScanRoots(
      applyDisabledDefaults(base, config),
      customRootsForField(config, field)
    );
  }

  return resolved;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Describes every root the UI should show: built-in defaults (including ones the
 * user disabled, so they can be switched back on), archived Claude copies found
 * on disk, and the user's own entries.
 */
export async function describeScanRoots(
  options: ResolveRootsOptions & { config?: ScanRootsConfig } = {}
): Promise<DescribedScanRoot[]> {
  const defaults = resolveLocalScanRoots(options);
  const config = options.config ?? (await readScanRootsConfig());
  const discovered = await discoverClaudeHistoryRoots({ home: options.home });
  const disabled = new Set(config.disabledDefaults);

  const described: DescribedScanRoot[] = [];

  for (const { source, field } of CONFIGURABLE_SOURCES) {
    const builtIn = field === "claudeProjects"
      ? mergeScanRoots(defaults.claudeProjects, discovered)
      : defaults[field];
    const discoveredKeys = new Set(discovered.map((root) => normalizeRootKey(root.path)));

    for (const root of builtIn) {
      const key = normalizeRootKey(root.path);
      described.push({
        source,
        path: root.path,
        label: root.label,
        kind: discoveredKeys.has(key) ? "discovered" : "default",
        enabled: !disabled.has(key),
        exists: false
      });
    }

    for (const root of config.customRoots.filter((entry) => entry.source === source)) {
      described.push({
        source,
        path: root.path,
        label: labelForCustomRoot(root.path, root.label),
        kind: "custom",
        enabled: root.enabled,
        id: root.id,
        exists: false
      });
    }
  }

  const existence = await Promise.all(described.map((root) => pathExists(root.path)));
  return described.map((root, index) => ({ ...root, exists: existence[index] }));
}
