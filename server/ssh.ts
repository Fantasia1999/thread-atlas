import { promises as fs } from "node:fs";
import path from "node:path";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";

import type { SessionSource } from "../src/parsers/types.js";

const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");
const MAX_REMOTE_RESULTS = 80;

export interface SshCredentials {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface RemoteSessionEntry {
  path: string;
  source: SessionSource;
  size?: number;
  mtimeMs?: number;
}

export interface SyncResult {
  downloaded: Array<{
    remotePath: string;
    localPath: string;
    source: SessionSource;
  }>;
}

export async function testSshConnection(credentials: SshCredentials): Promise<void> {
  const client = await connect(credentials);
  client.end();
}

export async function scanRemoteSessions(
  credentials: SshCredentials
): Promise<RemoteSessionEntry[]> {
  const client = await connect(credentials);

  try {
    const paths = await collectRemotePaths(client);
    if (paths.length === 0) {
      return [];
    }

    const sftp = await openSftp(client);
    const entries = await Promise.all(
      paths.map(async ({ remotePath, source }) => {
        try {
          const stat = await statRemoteFile(sftp, remotePath);
          return {
            path: remotePath,
            source,
            size: stat.size,
            mtimeMs: stat.mtime * 1000
          } satisfies RemoteSessionEntry;
        } catch {
          return {
            path: remotePath,
            source
          } satisfies RemoteSessionEntry;
        }
      })
    );

    return entries.sort((left, right) => {
      const timeDelta = (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return left.path.localeCompare(right.path);
    });
  } finally {
    client.end();
  }
}

export async function syncRemoteFiles(
  credentials: SshCredentials,
  entries: RemoteSessionEntry[]
): Promise<SyncResult> {
  const client = await connect(credentials);

  try {
    const sftp = await openSftp(client);
    const destinationRoot = path.join(
      REMOTE_SYNC_ROOT,
      sanitizeSegment(`${credentials.username}@${credentials.host}`)
    );

    await fs.mkdir(destinationRoot, { recursive: true });

    const downloaded: SyncResult["downloaded"] = [];

    for (const entry of entries) {
      const localPath = buildLocalPath(destinationRoot, entry.path);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fastGet(sftp, entry.path, localPath);
      downloaded.push({
        remotePath: entry.path,
        localPath,
        source: entry.source
      });
    }

    return { downloaded };
  } finally {
    client.end();
  }
}

async function connect(credentials: SshCredentials): Promise<Client> {
  const config: ConnectConfig = {
    host: credentials.host,
    port: credentials.port ?? 22,
    username: credentials.username,
    readyTimeout: 10_000
  };

  if (credentials.privateKey?.trim()) {
    config.privateKey = credentials.privateKey;
    if (credentials.passphrase?.trim()) {
      config.passphrase = credentials.passphrase;
    }
  } else if (credentials.password?.trim()) {
    config.password = credentials.password;
  }

  return await new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", (error) => reject(error))
      .connect(config);
  });
}

async function collectRemotePaths(
  client: Client
): Promise<Array<{ remotePath: string; source: SessionSource }>> {
  const scripts: Array<{ source: SessionSource; script: string }> = [
    {
      source: "codex",
      script:
        `find "$HOME/.codex/sessions" -type f -name 'rollout-*.jsonl' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "claude",
      script:
        `find "$HOME/.claude/projects" -type f -name '*.jsonl' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "opencode",
      script:
        `if [ -f "$HOME/.local/share/opencode/opencode.db" ]; then printf '%s\n' "$HOME/.local/share/opencode/opencode.db"; fi`
    },
    {
      source: "gemini",
      script:
        `find "$HOME/.gemini/tmp" -type f -name '*.json' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    }
  ];

  const records: Array<{ remotePath: string; source: SessionSource }> = [];

  for (const item of scripts) {
    const stdout = await execRemote(client, item.script);
    for (const line of stdout.split("\n")) {
      const remotePath = line.trim();
      if (!remotePath) {
        continue;
      }
      records.push({ remotePath, source: item.source });
    }
  }

  const deduped = new Map<string, { remotePath: string; source: SessionSource }>();
  for (const record of records) {
    deduped.set(record.remotePath, record);
  }

  return [...deduped.values()];
}

async function execRemote(client: Client, command: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("close", (code) => {
        if (code && code !== 0 && stderr.trim()) {
          reject(new Error(stderr.trim()));
          return;
        }
        resolve(stdout);
      });
      stream.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    });
  });
}

async function openSftp(client: Client): Promise<SFTPWrapper> {
  return await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sftp);
    });
  });
}

async function statRemoteFile(sftp: SFTPWrapper, remotePath: string) {
  return await new Promise<import("ssh2").Stats>((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stats);
    });
  });
}

async function fastGet(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string
): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildLocalPath(root: string, remotePath: string): string {
  const segments = remotePath
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment);

  return path.join(root, ...segments);
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._@-]+/g, "_");
}
