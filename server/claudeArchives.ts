import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isClaudeHistoryDirName } from "../shared/pathUtils.js";
import {
  mergeClaudeHistoryRoots,
  resolveLocalScanRoots,
  type ClaudeHistoryRoot,
  type LocalScanRoots,
  type ResolveRootsOptions
} from "./platformRoots.js";

/**
 * Finds archived Claude history directories sitting next to the live
 * `~/.claude` — typically backups copied over from other machines, such as
 * `~/claude-backup-pc1`. A candidate only counts when its name looks like a
 * Claude home *and* it actually contains a `projects` directory, so unrelated
 * folders never turn into scan roots.
 *
 * Only direct children of the home directory are inspected. Archives kept
 * elsewhere (an external drive, a shared mount) are configured explicitly
 * through `ATLAS_CLAUDE_ROOTS` instead.
 */
export async function discoverClaudeHistoryRoots(
  options: { home?: string } = {}
): Promise<ClaudeHistoryRoot[]> {
  const home = options.home ?? os.homedir();

  let entries;
  try {
    entries = await fs.readdir(home, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries.filter(
    (entry) =>
      (entry.isDirectory() || entry.isSymbolicLink()) && isClaudeHistoryDirName(entry.name)
  );

  const roots = await Promise.all(
    candidates.map(async (entry): Promise<ClaudeHistoryRoot | null> => {
      const projectsPath = path.join(home, entry.name, "projects");
      try {
        const stats = await fs.stat(projectsPath);
        if (!stats.isDirectory()) {
          return null;
        }
      } catch {
        return null;
      }
      return { projectsPath, label: entry.name };
    })
  );

  return roots.filter((root): root is ClaudeHistoryRoot => root !== null);
}

/**
 * Resolves the full scan-root set, including archived Claude history roots
 * discovered on disk. The live `~/.claude` stays first and unlabeled.
 */
export async function resolveScanRootsWithArchives(
  options: ResolveRootsOptions = {}
): Promise<LocalScanRoots> {
  const roots = resolveLocalScanRoots(options);
  const discovered = await discoverClaudeHistoryRoots({ home: options.home });

  return {
    ...roots,
    claudeProjects: mergeClaudeHistoryRoots(roots.claudeProjects, discovered)
  };
}
