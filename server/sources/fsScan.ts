import { promises as fs } from "node:fs";
import path from "node:path";

import {
  extractClaudeCwd,
  extractClaudeParentThreadId,
  extractClaudePreviewTitle,
  extractClaudeSessionId
} from "../../shared/extractors/claude.js";
import {
  extractCodexCwd,
  extractCodexParentThreadId,
  extractCodexPreviewTitle,
  extractCodexSessionId
} from "../../shared/extractors/codex.js";
import { parseJsonLines } from "../../shared/jsonl.js";
import { isWithinPathRoot } from "../../shared/pathUtils.js";
import type {
  MetadataValue,
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../../shared/types.js";
import { buildAntigravityDescriptor } from "../antigravity.js";
import { inferFileSource } from "./fileSources.js";

export const MAX_FILES_PER_SOURCE = 120;

export type DescriptorOrigin = "local" | "remote";

export interface ScanFileTreeOptions {
  root: string;
  source?: SessionSource;
  origin?: DescriptorOrigin;
  precollectedFiles?: readonly string[];
  /** Marks descriptors as coming from an archived history root. */
  archiveLabel?: string;
}

export async function scanDefaultFileTree(
  options: ScanFileTreeOptions
): Promise<SessionDescriptor[]> {
  const { root, source, precollectedFiles, archiveLabel } = options;
  const origin: DescriptorOrigin = options.origin ?? "local";

  if (!precollectedFiles && !(await exists(root))) {
    return [];
  }

  const files = precollectedFiles ?? await collectFiles(root, 0);
  const candidates = files
    .map((absolutePath) => ({
      absolutePath,
      inferredSource: source ?? inferFileSource(absolutePath)
    }))
    .filter(
      ({ inferredSource }) => inferredSource !== "unknown" && shouldIncludeScannedFile(inferredSource)
    );

  const candidatesWithStats = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const stats = await fs.stat(candidate.absolutePath);
        return { ...candidate, stats };
      } catch {
        return null;
      }
    })
  );

  const validCandidates = candidatesWithStats
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
    .slice(0, MAX_FILES_PER_SOURCE);

  const loadedDescriptors = await Promise.all(
    validCandidates.map(async ({ absolutePath, inferredSource, stats }) => {
      const content =
        inferredSource === "codex" || inferredSource === "claude"
          ? await readTextFileIfPossible(absolutePath)
          : undefined;
      return buildFileDescriptor(absolutePath, inferredSource, origin, stats, content, archiveLabel);
    })
  );

  // Recover parent sessions that fell outside the slice limit.
  let resolveDone = false;
  let iterations = 0;
  const slicedPaths = new Set(validCandidates.map((candidate) => candidate.absolutePath));

  while (!resolveDone && iterations < 3) {
    resolveDone = true;
    iterations++;

    const loadedSessionIds = new Set<string>();
    for (const descriptor of loadedDescriptors) {
      if (descriptor.metadata?.sessionId) {
        loadedSessionIds.add(String(descriptor.metadata.sessionId));
      }
    }

    const missingParentIds = new Set<string>();
    for (const descriptor of loadedDescriptors) {
      const parentId = descriptor.metadata?.parentThreadId;
      if (parentId && !loadedSessionIds.has(String(parentId))) {
        missingParentIds.add(String(parentId));
      }
    }

    if (missingParentIds.size > 0) {
      const unslicedCandidates = candidatesWithStats.filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null && !slicedPaths.has(candidate.absolutePath)
      );

      const extraCandidates: typeof unslicedCandidates = [];
      for (const parentId of missingParentIds) {
        const matched = unslicedCandidates.find(
          (candidate) =>
            candidate.absolutePath.includes(parentId) && !slicedPaths.has(candidate.absolutePath)
        );
        if (matched) {
          extraCandidates.push(matched);
          slicedPaths.add(matched.absolutePath);
        }
      }

      if (extraCandidates.length > 0) {
        resolveDone = false;
        const extraDescriptors = await Promise.all(
          extraCandidates.map(async ({ absolutePath, inferredSource, stats }) => {
            const content =
              inferredSource === "codex" || inferredSource === "claude"
                ? await readTextFileIfPossible(absolutePath)
                : undefined;
            return buildFileDescriptor(absolutePath, inferredSource, origin, stats, content, archiveLabel);
          })
        );
        loadedDescriptors.push(...extraDescriptors);
      }
    }
  }

  return loadedDescriptors;
}

export async function loadDefaultFileBundle(
  absolutePath: string,
  source: SessionSource,
  origin: DescriptorOrigin,
  archiveLabel?: string
): Promise<SessionBundle> {
  const [content, stats] = await Promise.all([
    fs.readFile(absolutePath, "utf8"),
    fs.stat(absolutePath)
  ]);

  return {
    ...buildFileDescriptor(absolutePath, source, origin, stats, content, archiveLabel),
    files: [
      {
        path: absolutePath,
        content
      }
    ]
  };
}

export async function collectFiles(root: string, depth: number): Promise<string[]> {
  if (depth > 10) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return await collectFiles(absolutePath, depth + 1);
      }

      if (!entry.isFile() || !isSessionLikeFile(absolutePath)) {
        return [];
      }

      return [absolutePath];
    })
  );

  return nested.flat();
}

function isSessionLikeFile(absolutePath: string): boolean {
  const name = path.basename(absolutePath).toLowerCase();
  if (name.endsWith(".meta.json")) {
    return false;
  }
  return (
    name === "opencode.db" ||
    name.endsWith(".jsonl") ||
    name.endsWith(".json") ||
    name.endsWith(".pb") ||
    (name.endsWith(".db") && absolutePath.includes("/conversations/"))
  );
}

function shouldIncludeScannedFile(source: SessionSource): boolean {
  return source !== "opencode" && source !== "copilot" && source !== "antigravity";
}

export function inferDescriptorOrigin(
  absolutePath: string,
  remoteRoot = path.resolve(process.cwd(), "data", "remote")
): DescriptorOrigin {
  return isWithinPathRoot(absolutePath, remoteRoot) ? "remote" : "local";
}

export function buildFileDescriptor(
  absolutePath: string,
  source: SessionSource,
  origin: DescriptorOrigin,
  stats: {
    size: number;
    mtimeMs: number;
  },
  content?: string,
  archiveLabel?: string
): SessionDescriptor {
  if (source === "antigravity") {
    return buildAntigravityDescriptor(absolutePath, origin, stats, content);
  }

  let parsedRows: unknown[] | undefined;
  if (content && (source === "codex" || source === "claude")) {
    try {
      parsedRows = parseJsonLines(content);
    } catch {
      // ignore
    }
  }

  const codexTitle =
    source === "codex" && parsedRows ? extractCodexPreviewTitle(parsedRows) : undefined;
  const claudeTitle =
    source === "claude" && parsedRows ? extractClaudePreviewTitle(parsedRows) : undefined;
  const claudeCwd =
    source === "claude" && parsedRows ? extractClaudeCwd(parsedRows) : undefined;
  const codexCwd =
    source === "codex" && parsedRows ? extractCodexCwd(parsedRows) : undefined;

  const metadata: Record<string, MetadataValue> = {};
  const cwd = claudeCwd ?? codexCwd;
  if (cwd) {
    metadata.cwd = cwd;
  }

  const codexParentThreadId =
    source === "codex" && parsedRows ? extractCodexParentThreadId(parsedRows) : undefined;
  const codexSessionId =
    source === "codex" && parsedRows
      ? extractCodexSessionId(parsedRows, absolutePath)
      : undefined;

  const claudeParentThreadId =
    source === "claude" && parsedRows
      ? extractClaudeParentThreadId(parsedRows, absolutePath)
      : undefined;
  const claudeSessionId =
    source === "claude" && parsedRows
      ? extractClaudeSessionId(parsedRows, absolutePath)
      : undefined;

  const parentThreadId = codexParentThreadId ?? claudeParentThreadId;
  const sessionId = codexSessionId ?? claudeSessionId;

  if (parentThreadId) {
    metadata.parentThreadId = parentThreadId;
  }
  if (sessionId) {
    metadata.sessionId = sessionId;
  }

  return {
    key: `file::${absolutePath}`,
    source,
    title: claudeTitle ?? codexTitle ?? path.basename(absolutePath),
    primaryPath: absolutePath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 1,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    metadata,
    archiveLabel
  };
}

const MAX_DESCRIPTOR_READ_BYTES = 5242880;

export async function readTextFileIfPossible(
  absolutePath: string
): Promise<string | undefined> {
  try {
    const handle = await fs.open(absolutePath, "r");
    try {
      const { size } = await handle.stat();
      const readLength = Math.min(size, MAX_DESCRIPTOR_READ_BYTES);
      if (readLength === 0) {
        return "";
      }
      // allocUnsafe is safe here: only the bytes actually read are decoded.
      const buffer = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(buffer, 0, readLength, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
