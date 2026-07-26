import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isClaudeHistoryDirName } from "../shared/pathUtils.js";
import type { ScanRootEntry } from "./platformRoots.js";

/**
 * Finds archived Claude history directories sitting next to the live
 * `~/.claude` — typically backups copied over from other machines, such as
 * `~/claude-backup-pc1`. A candidate only counts when its name looks like a
 * Claude home *and* it actually contains a `projects` directory, so unrelated
 * folders never turn into scan roots.
 *
 * Only direct children of the home directory are inspected. Archives kept
 * elsewhere (an external drive, a shared mount) are added through the UI or
 * `ATLAS_CLAUDE_ROOTS` instead.
 */
export async function discoverClaudeHistoryRoots(
  options: { home?: string } = {}
): Promise<ScanRootEntry[]> {
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
    candidates.map(async (entry): Promise<ScanRootEntry | null> => {
      const projectsPath = path.join(home, entry.name, "projects");
      try {
        const stats = await fs.stat(projectsPath);
        if (!stats.isDirectory()) {
          return null;
        }
      } catch {
        return null;
      }
      return { path: projectsPath, label: entry.name };
    })
  );

  return roots.filter((root): root is ScanRootEntry => root !== null);
}
