import { promises as fs } from "node:fs";
import path from "node:path";

import { basenameFromAnyPath } from "../../shared/pathUtils.js";
import type { SessionBundle, SessionDescriptor } from "../../shared/types.js";
import { COPILOT_BUNDLE_FILES, COPILOT_EVENTS_FILE } from "../copilot.js";
import { copilotFileSource, inferFileSource } from "./fileSources.js";
import {
  collectFiles,
  exists,
  inferDescriptorOrigin,
  MAX_FILES_PER_SOURCE,
  type DescriptorOrigin
} from "./fsScan.js";
import type { ServerSourceAdapter } from "./types.js";

const COPILOT_DIR_KEY_PREFIX = "copilot-dir::";
const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");

async function scanCopilotSessionDirectoriesInRemoteMirror(
  remoteFiles?: readonly string[]
): Promise<SessionDescriptor[]> {
  const files = remoteFiles ?? (
    await exists(REMOTE_SYNC_ROOT) ? await collectFiles(REMOTE_SYNC_ROOT, 0) : []
  );
  const sessionDirs = [
    ...new Set(
      files
        .filter(
          (absolutePath) =>
            path.basename(absolutePath) === COPILOT_EVENTS_FILE &&
            inferFileSource(absolutePath) === "copilot"
        )
        .map((absolutePath) => path.dirname(absolutePath))
    )
  ];

  const descriptors = await Promise.all(
    sessionDirs.map((sessionDir) => buildCopilotDescriptor(sessionDir, "remote"))
  );

  return descriptors.filter(
    (descriptor): descriptor is SessionDescriptor => descriptor !== null
  );
}

async function scanCopilotSessionDirectories(
  root: string,
  origin: DescriptorOrigin
): Promise<SessionDescriptor[]> {
  if (!(await exists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const directoriesWithStats = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const absolutePath = path.join(root, entry.name);
        try {
          const stats = await fs.stat(absolutePath);
          return { absolutePath, stats };
        } catch {
          return null;
        }
      })
  );

  const sortedDirs = directoriesWithStats
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
    .slice(0, MAX_FILES_PER_SOURCE)
    .map((entry) => entry.absolutePath);

  const descriptors = await Promise.all(
    sortedDirs.map((sessionDir) => buildCopilotDescriptor(sessionDir, origin))
  );

  return descriptors.filter(
    (descriptor): descriptor is SessionDescriptor => descriptor !== null
  );
}

async function loadCopilotBundle(sessionDir: string): Promise<SessionBundle> {
  const descriptor = await buildCopilotDescriptor(sessionDir, inferDescriptorOrigin(sessionDir));
  if (!descriptor) {
    throw new Error("Copilot session not found.");
  }

  const files = await Promise.all(
    COPILOT_BUNDLE_FILES.map(async (relativePath) => {
      const absolutePath = path.join(sessionDir, relativePath);
      if (!(await exists(absolutePath))) {
        return null;
      }

      return {
        path: absolutePath,
        content: await fs.readFile(absolutePath, "utf8")
      };
    })
  );

  return {
    ...descriptor,
    files: files.filter((file): file is NonNullable<typeof file> => file !== null)
  };
}

async function buildCopilotDescriptor(
  sessionDir: string,
  origin: DescriptorOrigin
): Promise<SessionDescriptor | null> {
  const eventsPath = path.join(sessionDir, COPILOT_EVENTS_FILE);
  if (!(await exists(eventsPath))) {
    return null;
  }

  const relevantPaths = COPILOT_BUNDLE_FILES.map((entry) => path.join(sessionDir, entry));
  const existingPaths = await Promise.all(
    relevantPaths.map(async (absolutePath) => {
      if (!(await exists(absolutePath))) {
        return null;
      }

      const stats = await fs.stat(absolutePath);
      return { absolutePath, stats };
    })
  );

  const availableFiles = existingPaths.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null
  );
  const workspace = await readCopilotWorkspaceFile(path.join(sessionDir, "workspace.yaml"));
  const title = inferCopilotTitle(workspace, sessionDir);
  const mtimeMs = inferCopilotMtimeMs(workspace.updated_at, availableFiles);
  const size = availableFiles.reduce((total, file) => total + file.stats.size, 0);
  const sessionId = workspace.id || path.basename(sessionDir);

  return {
    key: `${COPILOT_DIR_KEY_PREFIX}${sessionDir}`,
    source: "copilot",
    title,
    primaryPath: sessionDir,
    relatedPaths: availableFiles.map((file) => file.absolutePath),
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: availableFiles.length,
    size,
    mtimeMs,
    metadata: {
      cwd: workspace.cwd ?? null,
      sessionId,
      summary: workspace.summary ?? null
    }
  };
}

function parseSimpleYamlRecord(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function readCopilotWorkspaceFile(sessionPath: string): Promise<Record<string, string>> {
  try {
    if (!(await exists(sessionPath))) {
      return {};
    }
    return parseSimpleYamlRecord(await fs.readFile(sessionPath, "utf8"));
  } catch {
    return {};
  }
}

function inferCopilotTitle(workspace: Record<string, string>, sessionDir: string): string {
  if (workspace.summary?.trim()) {
    return workspace.summary.trim();
  }

  if (workspace.cwd?.trim()) {
    return `${basenameFromAnyPath(workspace.cwd) || "workspace"} · Copilot`;
  }

  return path.basename(sessionDir);
}

function inferCopilotMtimeMs(
  updatedAt: string | undefined,
  files: Array<{ absolutePath: string; stats: { size: number; mtimeMs: number } }>
): number {
  const parsedUpdatedAt = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isNaN(parsedUpdatedAt)) {
    return parsedUpdatedAt;
  }

  return Math.max(...files.map((file) => file.stats.mtimeMs));
}

export const copilotSource: ServerSourceAdapter = {
  ...copilotFileSource,
  scan: async (context) => {
    const [localDescriptors, remoteDescriptors] = await Promise.all([
      scanCopilotSessionDirectories(context.roots.copilotSessionState, "local"),
      scanCopilotSessionDirectoriesInRemoteMirror(context.remoteFiles)
    ]);
    return [...localDescriptors, ...remoteDescriptors];
  },
  loadBundle: async (key) => {
    if (!key.startsWith(COPILOT_DIR_KEY_PREFIX)) {
      return undefined;
    }
    return await loadCopilotBundle(key.slice(COPILOT_DIR_KEY_PREFIX.length));
  }
};
