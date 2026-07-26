import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SessionSource } from "../shared/types.js";
import { inferRegisteredSource } from "./sources/registry.js";
import { collectFiles, exists } from "./sources/fsScan.js";
import { isClaudeProjectsPath } from "../shared/pathUtils.js";

const MAX_BROWSE_ENTRIES = 400;
const MAX_PROBE_FILES = 200;
const MAX_SNIFF_FILES = 5;
const SNIFF_BYTES = 4096;

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DirectoryListing {
  path: string;
  /** Parent directory, or undefined at the filesystem root. */
  parent?: string;
  entries: BrowseEntry[];
  /** True when the listing was capped, so the UI can say so. */
  truncated: boolean;
}

export interface ScanRootInspection {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  /** Source guessed from the path layout, when it looks like a known history. */
  detectedSource?: SessionSource;
  /** Session-like files found under the path (capped; see `countCapped`). */
  sessionFileCount: number;
  countCapped: boolean;
  /** Human-readable summary for the UI. */
  message: string;
}

/** Expands a leading `~` and resolves to an absolute path. */
export function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return os.homedir();
  }

  let expanded = trimmed;
  if (expanded === "~") {
    return os.homedir();
  }
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }

  return path.resolve(expanded);
}

/**
 * Lists the directories under `requestedPath` so the UI can offer a picker.
 * Only names and types are returned — never file contents. Unreadable entries
 * are skipped rather than failing the whole listing, so a home directory with a
 * few protected folders still browses fine.
 */
export async function browseDirectory(requestedPath: string): Promise<DirectoryListing> {
  const target = resolveUserPath(requestedPath);

  const stats = await fs.stat(target).catch(() => null);
  if (!stats) {
    throw new Error(`Directory not found: ${target}`);
  }
  const directory = stats.isDirectory() ? target : path.dirname(target);

  const dirEntries = await fs.readdir(directory, { withFileTypes: true });
  const visible = dirEntries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink() || entry.isFile())
    .sort((left, right) => {
      const leftDir = left.isFile() ? 1 : 0;
      const rightDir = right.isFile() ? 1 : 0;
      if (leftDir !== rightDir) {
        return leftDir - rightDir;
      }
      return left.name.localeCompare(right.name);
    });

  const truncated = visible.length > MAX_BROWSE_ENTRIES;
  const entries = await Promise.all(
    visible.slice(0, MAX_BROWSE_ENTRIES).map(async (entry): Promise<BrowseEntry> => {
      const entryPath = path.join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        isDirectory = await fs
          .stat(entryPath)
          .then((linked) => linked.isDirectory())
          .catch(() => false);
      }
      return { name: entry.name, path: entryPath, isDirectory };
    })
  );

  const parent = path.dirname(directory);
  return {
    path: directory,
    parent: parent === directory ? undefined : parent,
    entries,
    truncated
  };
}

/**
 * Checks a candidate scan root before the user saves it: does it exist, does it
 * look like a known agent history, and does it actually contain sessions. The
 * file probe is capped so pointing at a huge tree stays responsive.
 */
export async function inspectScanRootCandidate(
  requestedPath: string,
  source?: SessionSource
): Promise<ScanRootInspection> {
  const target = resolveUserPath(requestedPath);
  const stats = await fs.stat(target).catch(() => null);

  if (!stats) {
    return {
      path: target,
      exists: false,
      isDirectory: false,
      sessionFileCount: 0,
      countCapped: false,
      message: "Path not found."
    };
  }

  if (stats.isFile()) {
    const detectedSource = detectSourceFromPath(target);
    const isOpenCodeDb = path.basename(target).toLowerCase() === "opencode.db";
    return {
      path: target,
      exists: true,
      isDirectory: false,
      detectedSource: isOpenCodeDb ? "opencode" : detectedSource,
      sessionFileCount: isOpenCodeDb ? 1 : 0,
      countCapped: false,
      message: isOpenCodeDb
        ? "OpenCode database found."
        : "This is a file. Pick a directory, or an `opencode.db` file for OpenCode."
    };
  }

  if (!(await exists(target))) {
    return {
      path: target,
      exists: false,
      isDirectory: true,
      sessionFileCount: 0,
      countCapped: false,
      message: "Path not found."
    };
  }

  const files = await collectFiles(target, 0).catch(() => [] as string[]);
  const capped = files.length > MAX_PROBE_FILES;
  const probe = files.slice(0, MAX_PROBE_FILES);
  const detectedSource =
    detectSourceFromPath(target) ??
    detectSourceFromFiles(probe) ??
    (await sniffSourceFromFiles(probe));

  return {
    path: target,
    exists: true,
    isDirectory: true,
    detectedSource,
    sessionFileCount: probe.length,
    countCapped: capped,
    message: buildInspectionMessage(probe.length, capped, detectedSource, source)
  };
}

function detectSourceFromPath(target: string): SessionSource | undefined {
  if (isClaudeProjectsPath(`${target}/probe.jsonl`)) {
    return "claude";
  }
  const inferred = inferRegisteredSource(target);
  return inferred === "unknown" ? undefined : inferred;
}

function detectSourceFromFiles(files: readonly string[]): SessionSource | undefined {
  for (const file of files) {
    const inferred = inferRegisteredSource(file);
    if (inferred !== "unknown") {
      return inferred;
    }
  }
  return undefined;
}

/**
 * Last-resort detection by peeking at file content. An archive copied off
 * another machine can be named anything, so its path may carry no hint at all —
 * but the session files themselves still look like what they are. Only the head
 * of a few files is read, and only to classify them.
 */
async function sniffSourceFromFiles(
  files: readonly string[]
): Promise<SessionSource | undefined> {
  for (const file of files.slice(0, MAX_SNIFF_FILES)) {
    const base = path.basename(file).toLowerCase();
    if (base === "events.jsonl") {
      return "copilot";
    }
    if (base === "opencode.db") {
      return "opencode";
    }
    if (base.startsWith("rollout-")) {
      return "codex";
    }

    const head = await readFileHead(file);
    if (!head) {
      continue;
    }
    if (head.includes('"session_meta"') || head.includes('"response_item"')) {
      return "codex";
    }
    if (head.includes("CORTEX_STEP_TYPE") || head.includes('"cascadeId"')) {
      return "antigravity";
    }
    if (head.includes('"toolUseResult"') || head.includes('"tool_use"')) {
      return "claude";
    }
    if (head.includes('"parentUuid"') || (head.includes('"cwd"') && head.includes('"message"'))) {
      return "claude";
    }
    if (head.trimStart().startsWith("{") && head.includes('"messages"')) {
      return "gemini";
    }
  }
  return undefined;
}

async function readFileHead(absolutePath: string): Promise<string | undefined> {
  try {
    const handle = await fs.open(absolutePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function buildInspectionMessage(
  count: number,
  capped: boolean,
  detectedSource: SessionSource | undefined,
  requestedSource: SessionSource | undefined
): string {
  if (count === 0) {
    return "No session files found under this directory.";
  }

  const amount = capped ? `${count}+ session files` : `${count} session file${count === 1 ? "" : "s"}`;
  if (detectedSource && requestedSource && detectedSource !== requestedSource) {
    return `Found ${amount}, but this looks like a ${detectedSource} history rather than ${requestedSource}.`;
  }
  if (detectedSource) {
    return `Found ${amount} (looks like ${detectedSource}).`;
  }
  return `Found ${amount}.`;
}
