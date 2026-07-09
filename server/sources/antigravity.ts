import { promises as fs } from "node:fs";

import type { SessionDescriptor } from "../../shared/types.js";
import {
  antigravitySessionIdFromPath,
  isAntigravityConversationPath,
  isAntigravityTranscriptPath,
  isScannableAntigravitySessionPath,
  loadAntigravityBundle,
  resolvePreferredAntigravitySessionPath
} from "../antigravity.js";
import { resolveLocalScanRoots } from "../platformRoots.js";
import { antigravityFileSource } from "./fileSources.js";
import {
  buildFileDescriptor,
  collectFiles,
  exists,
  inferDescriptorOrigin,
  MAX_FILES_PER_SOURCE,
  readTextFileIfPossible,
  type DescriptorOrigin
} from "./fsScan.js";
import type { ServerSourceAdapter } from "./types.js";

const FILE_KEY_PREFIX = "file::";

async function loadAntigravityHistoryMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const historyPath = resolveLocalScanRoots().antigravityCliHistory;
    const content = await fs.readFile(historyPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.conversationId && typeof entry.workspace === "string" && entry.workspace.trim()) {
          map.set(entry.conversationId, entry.workspace.trim());
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return map;
}

async function scanAntigravitySessions(
  roots: readonly string[],
  origin: DescriptorOrigin,
  precollectedFiles?: readonly string[]
): Promise<SessionDescriptor[]> {
  const files = precollectedFiles ?? (await Promise.all(
    roots.map(async (root) => {
      if (!(await exists(root))) {
        return [];
      }
      return await collectFiles(root, 0);
    })
  )).flat();

  const candidates = files.filter(
    (absolutePath) =>
      isAntigravityTranscriptPath(absolutePath) || isAntigravityConversationPath(absolutePath)
  );
  const preferredBySession = new Map<string, string>();

  const resolvedCandidates = await Promise.all(
    candidates.map(async (absolutePath) => {
      const preferredPath = await resolvePreferredAntigravitySessionPath(absolutePath);
      if (!preferredPath) {
        return null;
      }
      if (!(await isScannableAntigravitySessionPath(preferredPath))) {
        return null;
      }
      return { absolutePath, preferredPath };
    })
  );

  for (const item of resolvedCandidates) {
    if (!item) {
      continue;
    }
    const { absolutePath, preferredPath } = item;
    const sessionId =
      antigravitySessionIdFromPath(preferredPath) ?? antigravitySessionIdFromPath(absolutePath);
    const dedupeKey = sessionId ? `${origin}:${sessionId}` : `${origin}:${preferredPath}`;
    const existingPath = preferredBySession.get(dedupeKey);
    if (!existingPath || preferAntigravityPath(preferredPath, existingPath)) {
      preferredBySession.set(dedupeKey, preferredPath);
    }
  }

  const preferredPaths = [...new Set(preferredBySession.values())];
  const preferredPathsWithStats = await Promise.all(
    preferredPaths.map(async (absolutePath) => {
      try {
        const stats = await fs.stat(absolutePath);
        return { absolutePath, stats };
      } catch {
        return null;
      }
    })
  );

  const validPaths = preferredPathsWithStats
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
    .slice(0, MAX_FILES_PER_SOURCE);

  const historyMap = await loadAntigravityHistoryMap();

  return await Promise.all(
    validPaths.map(async ({ absolutePath, stats }) => {
      const content = isAntigravityTranscriptPath(absolutePath)
        ? await readTextFileIfPossible(absolutePath)
        : undefined;
      const descriptor = buildFileDescriptor(
        absolutePath,
        "antigravity",
        origin,
        stats,
        content
      );

      const sessionId = antigravitySessionIdFromPath(absolutePath);
      const workspace = sessionId ? historyMap.get(sessionId) : undefined;
      if (workspace) {
        descriptor.metadata = {
          ...descriptor.metadata,
          primaryWorkspace: workspace
        };
      }
      return descriptor;
    })
  );
}

function preferAntigravityPath(candidate: string, current: string): boolean {
  if (isAntigravityTranscriptPath(candidate) && !isAntigravityTranscriptPath(current)) {
    return true;
  }
  if (!isAntigravityTranscriptPath(candidate) && isAntigravityTranscriptPath(current)) {
    return false;
  }
  return candidate.localeCompare(current) < 0;
}

export const antigravitySource: ServerSourceAdapter = {
  ...antigravityFileSource,
  scan: async (context) => {
    const [localDescriptors, remoteDescriptors] = await Promise.all([
      scanAntigravitySessions(context.roots.antigravityRoots, "local"),
      scanAntigravitySessions([context.remoteRoot], "remote", context.remoteFiles)
    ]);
    return [...localDescriptors, ...remoteDescriptors];
  },
  loadBundle: async (key) => {
    if (!key.startsWith(FILE_KEY_PREFIX)) {
      return undefined;
    }

    const absolutePath = key.slice(FILE_KEY_PREFIX.length);
    if (!antigravityFileSource.matchPath(absolutePath)) {
      return undefined;
    }

    return await loadAntigravityBundle(absolutePath, inferDescriptorOrigin(absolutePath));
  }
};
