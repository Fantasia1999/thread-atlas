import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SessionBundle, SessionDescriptor } from "../../shared/types.js";
import { opencodeFileSource } from "./fileSources.js";
import {
  collectFiles,
  exists,
  inferDescriptorOrigin,
  type DescriptorOrigin
} from "./fsScan.js";
import type { ServerSourceAdapter } from "./types.js";

const MAX_OPENCODE_SESSIONS = 80;
const OPENCODE_KEY_PREFIX = "opencode-sqlite::";
const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");

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

type SqliteParameter = string | number | bigint | Uint8Array | null;

async function scanOpenCodeDatabasesInRemoteMirror(
  remoteFiles?: readonly string[]
): Promise<SessionDescriptor[]> {
  const files = remoteFiles ?? (
    await exists(REMOTE_SYNC_ROOT) ? await collectFiles(REMOTE_SYNC_ROOT, 0) : []
  );
  const databasePaths = files.filter((entry) => path.basename(entry) === "opencode.db");
  const descriptorGroups = await Promise.all(
    databasePaths.map((dbPath) => scanOpenCodeDatabase(dbPath, "remote"))
  );

  return descriptorGroups.flat();
}

async function scanOpenCodeDatabase(
  dbPath: string,
  origin: DescriptorOrigin,
  archiveLabel?: string
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

    return sessions.map((session) =>
      buildOpenCodeDescriptor(session, dbPath, origin, 0, archiveLabel)
    );
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
  const descriptor = buildOpenCodeDescriptor(
    session,
    dbPath,
    inferDescriptorOrigin(dbPath),
    stats.size
  );

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

function buildOpenCodeDescriptor(
  session: OpenCodeSessionRow,
  dbPath: string,
  origin: DescriptorOrigin,
  size = 0,
  archiveLabel?: string
): SessionDescriptor {
  return {
    archiveLabel,
    key: `${OPENCODE_KEY_PREFIX}${dbPath}::${session.id}`,
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

export const opencodeSource: ServerSourceAdapter = {
  ...opencodeFileSource,
  scan: async (context) => {
    const groups = await Promise.all([
      ...context.roots.openCodeDb.map((root) =>
        scanOpenCodeDatabase(root.path, "local", root.label)
      ),
      scanOpenCodeDatabasesInRemoteMirror(context.remoteFiles)
    ]);
    return groups.flat();
  },
  loadBundle: async (key) => {
    if (!key.startsWith(OPENCODE_KEY_PREFIX)) {
      return undefined;
    }

    const payload = key.slice(OPENCODE_KEY_PREFIX.length);
    const separatorIndex = payload.lastIndexOf("::");
    if (separatorIndex <= 0) {
      return undefined;
    }

    const dbPath = payload.slice(0, separatorIndex);
    const sessionId = payload.slice(separatorIndex + 2);
    if (!dbPath || !sessionId) {
      return undefined;
    }

    return await loadOpenCodeBundle(dbPath, sessionId);
  }
};
