import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  buildAntigravityDescriptor,
  isAntigravityConversationPath,
  loadAntigravityBundle
} from "./antigravity.js";
import {
  COPILOT_BUNDLE_FILES,
  COPILOT_EVENTS_FILE
} from "./copilot.js";
import { extractCodexThreadName } from "../src/parsers/codex.js";
import type {
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../src/parsers/types.js";

const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");
const MAX_FILES_PER_SOURCE = 120;
const MAX_OPENCODE_SESSIONS = 80;
const COPILOT_DIR_KEY_PREFIX = "copilot-dir::";

const LOCAL_FILE_SCAN_TARGETS = [
  {
    segments: [".codex", "sessions"],
    source: "codex"
  },
  {
    segments: [".claude", "projects"],
    source: "claude"
  },
  {
    segments: [".gemini", "tmp"],
    source: "gemini"
  },
  {
    segments: [".gemini", "antigravity", "conversations"],
    source: "antigravity"
  },
  {
    segments: [".gemini", "antigravity-cli"],
    source: "antigravity"
  }
] as const satisfies ReadonlyArray<{
  segments: readonly string[];
  source: Exclude<SessionSource, "opencode" | "unknown">;
}>;

type DescriptorOrigin = "local" | "remote";

interface OpenCodeSessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpenCodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export async function scanLocalSessions(): Promise<SessionDescriptor[]> {
  const home = os.homedir();
  const localOpenCodePath = path.join(home, ".local", "share", "opencode", "opencode.db");
  const localCopilotRoot = path.join(home, ".copilot", "session-state");

  const [
    localFileGroups,
    localOpenCodeDescriptors,
    localCopilotDescriptors,
    remoteFileDescriptors,
    remoteCopilotDescriptors,
    remoteOpenCodeDescriptors
  ] =
    await Promise.all([
      Promise.all(
        LOCAL_FILE_SCAN_TARGETS.map((target) =>
          scanFileTree(path.join(home, ...target.segments), target.source)
        )
      ),
      scanOpenCodeDatabase(localOpenCodePath, "local"),
      scanCopilotSessionDirectories(localCopilotRoot, "local"),
      scanFileTree(REMOTE_SYNC_ROOT, undefined, "remote"),
      scanCopilotSessionDirectoriesInRemoteMirror(),
      scanOpenCodeDatabasesInRemoteMirror()
    ]);

  return dedupeAndSortDescriptors([
    ...localFileGroups.flat(),
    ...localOpenCodeDescriptors,
    ...localCopilotDescriptors,
    ...remoteFileDescriptors,
    ...remoteCopilotDescriptors,
    ...remoteOpenCodeDescriptors
  ]);
}

export async function loadLocalSessionBundle(key: string): Promise<SessionBundle> {
  if (key.startsWith(COPILOT_DIR_KEY_PREFIX)) {
    const sessionDir = key.slice(COPILOT_DIR_KEY_PREFIX.length);
    return await loadCopilotBundle(sessionDir);
  }

  if (key.startsWith("opencode-sqlite::")) {
    const [, dbPath, sessionId] = key.split("::");
    return await loadOpenCodeBundle(dbPath, sessionId);
  }

  if (!key.startsWith("file::")) {
    throw new Error("Unsupported session key.");
  }

  const absolutePath = key.slice("file::".length);
  const source = inferSourceFromPath(absolutePath);
  const origin = inferOrigin(absolutePath);
  if (source === "antigravity") {
    return await loadAntigravityBundle(absolutePath, origin);
  }
  const [content, stats] = await Promise.all([
    fs.readFile(absolutePath, "utf8"),
    fs.stat(absolutePath)
  ]);

  return {
    ...buildFileDescriptor(absolutePath, source, origin, stats, content),
    files: [
      {
        path: absolutePath,
        content
      }
    ]
  };
}

async function scanFileTree(
  root: string,
  source?: SessionSource,
  origin: DescriptorOrigin = "local"
): Promise<SessionDescriptor[]> {
  if (!(await exists(root))) {
    return [];
  }

  const files = await collectFiles(root, 0);
  const candidates = files
    .map((absolutePath) => ({
      absolutePath,
      inferredSource: source ?? inferSourceFromPath(absolutePath)
    }))
    .filter(
      ({ inferredSource }) => inferredSource !== "unknown" && shouldIncludeScannedFile(inferredSource)
    )
    .slice(0, MAX_FILES_PER_SOURCE);

  return await Promise.all(
    candidates.map(async ({ absolutePath, inferredSource }) => {
      const stats = await fs.stat(absolutePath);
      const content =
        inferredSource === "codex" ? await readTextFileIfPossible(absolutePath) : undefined;
      return buildFileDescriptor(absolutePath, inferredSource, origin, stats, content);
    })
  );
}

type SqliteParameter = string | number | bigint | Uint8Array | null;

async function scanOpenCodeDatabasesInRemoteMirror(): Promise<SessionDescriptor[]> {
  if (!(await exists(REMOTE_SYNC_ROOT))) {
    return [];
  }

  const files = await collectFiles(REMOTE_SYNC_ROOT, 0);
  const databasePaths = files.filter((entry) => path.basename(entry) === "opencode.db");
  const descriptorGroups = await Promise.all(
    databasePaths.map((dbPath) => scanOpenCodeDatabase(dbPath, "remote"))
  );

  return descriptorGroups.flat();
}

async function scanCopilotSessionDirectoriesInRemoteMirror(): Promise<SessionDescriptor[]> {
  if (!(await exists(REMOTE_SYNC_ROOT))) {
    return [];
  }

  const files = await collectFiles(REMOTE_SYNC_ROOT, 0);
  const sessionDirs = [
    ...new Set(
      files
        .filter(
          (absolutePath) =>
            path.basename(absolutePath) === COPILOT_EVENTS_FILE &&
            inferSourceFromPath(absolutePath) === "copilot"
        )
        .map((absolutePath) => path.dirname(absolutePath))
    )
  ];

  const descriptors = await Promise.all(
    sessionDirs.map((sessionDir) => buildCopilotDescriptor(sessionDir, "remote"))
  );

  return descriptors.filter((descriptor): descriptor is SessionDescriptor => descriptor !== null);
}

async function scanCopilotSessionDirectories(
  root: string,
  origin: DescriptorOrigin
): Promise<SessionDescriptor[]> {
  if (!(await exists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const sessionDirs = entries
    .filter((entry) => entry.isDirectory())
    .slice(0, MAX_FILES_PER_SOURCE)
    .map((entry) => path.join(root, entry.name));

  const descriptors = await Promise.all(
    sessionDirs.map((sessionDir) => buildCopilotDescriptor(sessionDir, origin))
  );

  return descriptors.filter((descriptor): descriptor is SessionDescriptor => descriptor !== null);
}

async function scanOpenCodeDatabase(
  dbPath: string,
  origin: DescriptorOrigin
): Promise<SessionDescriptor[]> {
  if (!(await exists(dbPath))) {
    return [];
  }

  try {
    const sessions = await querySqlite<OpenCodeSessionRow>(
      dbPath,
      `select id, title, directory, time_created, time_updated
       from session
       order by time_updated desc
       limit ${MAX_OPENCODE_SESSIONS};`
    );

    return sessions.map((session) => buildOpenCodeDescriptor(session, dbPath, origin));
  } catch {
    return [];
  }
}

async function loadOpenCodeBundle(
  dbPath: string,
  sessionId: string
): Promise<SessionBundle> {
  const [sessions, messages, parts] = await Promise.all([
    querySqlite<OpenCodeSessionRow>(
      dbPath,
      "select id, title, directory, time_created, time_updated from session where id = ?;",
      [sessionId]
    ),
    querySqlite<OpenCodeMessageRow>(
      dbPath,
      "select id, session_id, time_created, time_updated, data from message where session_id = ? order by time_created asc;",
      [sessionId]
    ),
    querySqlite<OpenCodePartRow>(
      dbPath,
      "select id, message_id, session_id, time_created, time_updated, data from part where session_id = ? order by time_created asc;",
      [sessionId]
    )
  ]);

  const session = sessions[0];
  if (!session) {
    throw new Error("OpenCode session not found.");
  }

  const stats = await fs.stat(dbPath);
  const descriptor = buildOpenCodeDescriptor(session, dbPath, inferOrigin(dbPath), stats.size);

  return {
    ...descriptor,
    files: [
      {
        path: `${dbPath}#session.json`,
        content: JSON.stringify(session, null, 2)
      },
      {
        path: `${dbPath}#messages.json`,
        content: JSON.stringify(messages, null, 2)
      },
      {
        path: `${dbPath}#parts.json`,
        content: JSON.stringify(parts, null, 2)
      }
    ]
  };
}

async function loadCopilotBundle(sessionDir: string): Promise<SessionBundle> {
  const descriptor = await buildCopilotDescriptor(sessionDir, inferOrigin(sessionDir));
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
    files: files.filter((file): file is NonNullable<(typeof files)[number]> => file !== null)
  };
}

async function collectFiles(root: string, depth: number): Promise<string[]> {
  if (depth > 8) {
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
  return (
    name === "opencode.db" ||
    name.endsWith(".jsonl") ||
    name.endsWith(".json") ||
    name.endsWith(".pb")
  );
}

function shouldIncludeScannedFile(source: SessionSource): boolean {
  return source !== "opencode" && source !== "copilot";
}

export function inferSourceFromPath(absolutePath: string): SessionSource {
  const normalized = normalizePathForMatch(absolutePath);
  if (isAntigravityConversationPath(absolutePath)) {
    return "antigravity";
  }
  if (normalized.includes("/.codex/") || normalized.includes("/rollout-")) {
    return "codex";
  }
  if (normalized.includes("/.claude/")) {
    return "claude";
  }
  if (normalized.includes("/opencode")) {
    return "opencode";
  }
  if (normalized.includes("/.copilot/")) {
    return "copilot";
  }
  if (normalized.includes("/.gemini/")) {
    return "gemini";
  }
  return "unknown";
}

function inferOrigin(absolutePath: string): DescriptorOrigin {
  return isWithinPathRoot(absolutePath, REMOTE_SYNC_ROOT) ? "remote" : "local";
}

export function isWithinPathRoot(absolutePath: string, rootPath: string): boolean {
  const normalizedPath = normalizePathForMatch(absolutePath);
  const normalizedRoot = normalizePathForMatch(rootPath);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function normalizePathForMatch(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function buildFileDescriptor(
  absolutePath: string,
  source: SessionSource,
  origin: DescriptorOrigin,
  stats: {
    size: number;
    mtimeMs: number;
  },
  content?: string
): SessionDescriptor {
  if (source === "antigravity") {
    return buildAntigravityDescriptor(absolutePath, origin, stats);
  }
  const codexThreadName =
    source === "codex" && content ? extractCodexThreadName(content) : undefined;

  return {
    key: `file::${absolutePath}`,
    source,
    title: codexThreadName ?? path.basename(absolutePath),
    primaryPath: absolutePath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 1,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    metadata: {}
  };
}

async function readTextFileIfPossible(absolutePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
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
    (entry): entry is NonNullable<(typeof existingPaths)[number]> => entry !== null
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

function buildOpenCodeDescriptor(
  session: OpenCodeSessionRow,
  dbPath: string,
  origin: DescriptorOrigin,
  size = 0
): SessionDescriptor {
  return {
    key: `opencode-sqlite::${dbPath}::${session.id}`,
    source: "opencode",
    title: session.title || session.id,
    primaryPath: dbPath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 3,
    size,
    mtimeMs: session.time_updated,
    metadata: {
      directory: session.directory,
      sessionId: session.id
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
  if (!(await exists(sessionPath))) {
    return {};
  }

  return parseSimpleYamlRecord(await fs.readFile(sessionPath, "utf8"));
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

function basenameFromAnyPath(input: string): string {
  const segments = input.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? input;
}

function dedupeAndSortDescriptors(descriptors: SessionDescriptor[]): SessionDescriptor[] {
  const deduped = new Map<string, SessionDescriptor>();
  for (const descriptor of descriptors) {
    deduped.set(descriptor.key, descriptor);
  }

  return [...deduped.values()].sort(compareDescriptors);
}

function compareDescriptors(left: SessionDescriptor, right: SessionDescriptor): number {
  const timeDelta = right.mtimeMs - left.mtimeMs;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.title.localeCompare(right.title);
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function querySqlite<T>(
  dbPath: string,
  query: string,
  parameters: readonly SqliteParameter[] = []
): Promise<T[]> {
  const database = new DatabaseSync(dbPath, {
    readOnly: true
  });

  try {
    return database.prepare(query).all(...parameters) as T[];
  } finally {
    database.close();
  }
}
