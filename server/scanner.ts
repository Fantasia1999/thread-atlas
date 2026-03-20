import Database from "better-sqlite3";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../src/parsers/types.js";

const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");
const MAX_FILES_PER_SOURCE = 120;

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
  const descriptors: SessionDescriptor[] = [];

  descriptors.push(
    ...(await scanFileTree(path.join(home, ".codex", "sessions"), "codex")),
    ...(await scanFileTree(path.join(home, ".claude", "projects"), "claude")),
    ...(await scanFileTree(path.join(home, ".gemini", "tmp"), "gemini")),
    ...(await scanOpenCodeDatabase(
      path.join(home, ".local", "share", "opencode", "opencode.db"),
      "local"
    )),
    ...(await scanFileTree(REMOTE_SYNC_ROOT, undefined, "remote")),
    ...(await scanOpenCodeDatabasesInRemoteMirror())
  );

  const deduped = new Map<string, SessionDescriptor>();
  for (const descriptor of descriptors) {
    deduped.set(descriptor.key, descriptor);
  }

  return [...deduped.values()].sort((left, right) => {
    const timeDelta = right.mtimeMs - left.mtimeMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.title.localeCompare(right.title);
  });
}

export async function loadLocalSessionBundle(key: string): Promise<SessionBundle> {
  if (key.startsWith("opencode-sqlite::")) {
    const [, dbPath, sessionId] = key.split("::");
    return await loadOpenCodeBundle(dbPath, sessionId);
  }

  if (!key.startsWith("file::")) {
    throw new Error("Unsupported session key.");
  }

  const absolutePath = key.slice("file::".length);
  const content = await fs.readFile(absolutePath, "utf8");
  const stats = await fs.stat(absolutePath);
  const source = inferSourceFromPath(absolutePath);
  const origin = absolutePath.startsWith(REMOTE_SYNC_ROOT) ? "remote" : "local";

  return {
    key,
    source,
    title: path.basename(absolutePath),
    primaryPath: absolutePath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 1,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    files: [
      {
        path: absolutePath,
        content
      }
    ],
    metadata: {}
  };
}

async function scanFileTree(
  root: string,
  source?: SessionSource,
  origin: "local" | "remote" = "local"
): Promise<SessionDescriptor[]> {
  if (!(await exists(root))) {
    return [];
  }

  const files = await collectFiles(root, 0);
  const descriptors: SessionDescriptor[] = [];

  for (const absolutePath of files.slice(0, MAX_FILES_PER_SOURCE)) {
    const inferredSource = source ?? inferSourceFromPath(absolutePath);
    if (inferredSource === "unknown") {
      continue;
    }

    if (shouldSkipScannedFile(absolutePath, inferredSource)) {
      continue;
    }

    if (
      inferredSource === "opencode" &&
      path.basename(absolutePath) === "opencode.db"
    ) {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    descriptors.push({
      key: `file::${absolutePath}`,
      source: inferredSource,
      title: path.basename(absolutePath),
      primaryPath: absolutePath,
      relatedPaths: [],
      transport: origin === "remote" ? "ssh-sync" : "local-scan",
      origin,
      fileCount: 1,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      metadata: {}
    });
  }

  return descriptors;
}

async function scanOpenCodeDatabasesInRemoteMirror(): Promise<SessionDescriptor[]> {
  if (!(await exists(REMOTE_SYNC_ROOT))) {
    return [];
  }

  const files = await collectFiles(REMOTE_SYNC_ROOT, 0);
  const databasePaths = files.filter((entry) => path.basename(entry) === "opencode.db");
  const descriptors = await Promise.all(
    databasePaths.map((dbPath) => scanOpenCodeDatabase(dbPath, "remote"))
  );

  return descriptors.flat();
}

async function scanOpenCodeDatabase(
  dbPath: string,
  origin: "local" | "remote"
): Promise<SessionDescriptor[]> {
  if (!(await exists(dbPath))) {
    return [];
  }

  try {
    const sessions = await querySqlite<OpenCodeSessionRow>(
      dbPath,
      "select id, title, directory, time_created, time_updated from session order by time_updated desc limit 80;"
    );

    return sessions.map((session) => ({
      key: `opencode-sqlite::${dbPath}::${session.id}`,
      source: "opencode",
      title: session.title || session.id,
      primaryPath: dbPath,
      relatedPaths: [],
      transport: origin === "remote" ? "ssh-sync" : "local-scan",
      origin,
      fileCount: 3,
      size: 0,
      mtimeMs: session.time_updated,
      metadata: {
        directory: session.directory,
        sessionId: session.id
      }
    }));
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
      `select id, title, directory, time_created, time_updated from session where id = ${escapeSqliteValue(
        sessionId
      )};`
    ),
    querySqlite<OpenCodeMessageRow>(
      dbPath,
      `select id, session_id, time_created, time_updated, data from message where session_id = ${escapeSqliteValue(
        sessionId
      )} order by time_created asc;`
    ),
    querySqlite<OpenCodePartRow>(
      dbPath,
      `select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${escapeSqliteValue(
        sessionId
      )} order by time_created asc;`
    )
  ]);

  const session = sessions[0];
  if (!session) {
    throw new Error("OpenCode session not found.");
  }

  const origin = dbPath.startsWith(REMOTE_SYNC_ROOT) ? "remote" : "local";
  const stats = await fs.stat(dbPath);

  return {
    key: `opencode-sqlite::${dbPath}::${sessionId}`,
    source: "opencode",
    title: session.title || session.id,
    primaryPath: dbPath,
    relatedPaths: [],
    transport: origin === "remote" ? "ssh-sync" : "local-scan",
    origin,
    fileCount: 3,
    size: stats.size,
    mtimeMs: session.time_updated,
    metadata: {
      directory: session.directory,
      sessionId: session.id
    },
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

      if (!entry.isFile()) {
        return [];
      }

      if (!isSessionLikeFile(absolutePath)) {
        return [];
      }

      return [absolutePath];
    })
  );

  return nested.flat();
}

function isSessionLikeFile(absolutePath: string): boolean {
  const name = path.basename(absolutePath).toLowerCase();

  if (name === "opencode.db") {
    return true;
  }

  if (name.endsWith(".jsonl") || name.endsWith(".json")) {
    return true;
  }

  return false;
}

function shouldSkipScannedFile(absolutePath: string, source: SessionSource): boolean {
  if (source !== "opencode") {
    return false;
  }

  return path.basename(absolutePath).toLowerCase() !== "opencode.db";
}

function inferSourceFromPath(absolutePath: string): SessionSource {
  const normalized = absolutePath.toLowerCase();
  if (normalized.includes("/.codex/") || normalized.includes("/rollout-")) {
    return "codex";
  }
  if (normalized.includes("/.claude/")) {
    return "claude";
  }
  if (normalized.includes("/opencode")) {
    return "opencode";
  }
  if (normalized.includes("/.gemini/")) {
    return "gemini";
  }
  return "unknown";
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function querySqlite<T>(dbPath: string, query: string): Promise<T[]> {
  const database = new Database(dbPath, {
    readonly: true,
    fileMustExist: true
  });

  try {
    return database.prepare(query).all() as T[];
  } finally {
    database.close();
  }
}

function escapeSqliteValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
