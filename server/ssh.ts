import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Duplex } from "node:stream";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";

import type { SessionSource } from "../shared/types.js";
import { COPILOT_BUNDLE_FILES, COPILOT_EVENTS_FILE } from "./copilot.js";

const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");
const MAX_REMOTE_RESULTS = 80;

export type RemoteSessionEntryKind = "file" | "directory";

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
  kind: RemoteSessionEntryKind;
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
      paths.map(async ({ remotePath, source, kind }) => {
        try {
          const stat = await statRemotePath(sftp, remotePath);
          return {
            path: remotePath,
            source,
            kind,
            size: stat.size,
            mtimeMs: stat.mtime * 1000
          } satisfies RemoteSessionEntry;
        } catch {
          return {
            path: remotePath,
            source,
            kind
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
      if (entry.kind === "directory") {
        if (entry.source !== "copilot") {
          throw new Error(`Unsupported remote directory source: ${entry.source}`);
        }

        const syncedFiles = await syncCopilotDirectory(sftp, destinationRoot, entry.path);
        downloaded.push(
          ...syncedFiles.map(({ remotePath, localPath }) => ({
            remotePath,
            localPath,
            source: entry.source
          }))
        );
        continue;
      }

      const localPath = await syncRemoteFile(sftp, destinationRoot, entry.path);
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

/**
 * Network errors that are frequently transient on machines with VPNs, TUN-mode
 * proxies, or multiple interfaces, where a route can momentarily be missing
 * even though the host is actually reachable. The interactive `ssh` client
 * tolerates these via retries; we mirror that for a comparable experience.
 */
const TRANSIENT_SSH_ERROR_CODES = new Set([
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED"
]);

const SSH_CONNECT_ATTEMPTS = 3;
const SSH_RETRY_DELAY_MS = 600;

/**
 * Route errors that, on machines running a TUN-mode proxy with process-based
 * routing (Clash/Surge/Mihomo, etc.), happen because the proxy captures this
 * Node process and refuses a direct route to a LAN host — even though the
 * system `ssh`/`nc` binaries are allowed through. When we see these, we fall
 * back to tunnelling the SSH transport over an external connector (`nc`).
 */
const ROUTE_SSH_ERROR_CODES = new Set(["EHOSTUNREACH", "ENETUNREACH"]);

function attemptConnect(config: ConnectConfig): Promise<Client> {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", (error) => reject(error))
      .connect(config);
  });
}

/**
 * Builds the argv for an external connector that bridges stdin/stdout to the
 * target host:port (OpenSSH "ProxyCommand" style). Operators can override the
 * command via ATLAS_SSH_PROXY_COMMAND using %h / %p placeholders; otherwise we
 * default to netcat. Arguments are passed to spawn() without a shell, so the
 * untrusted host/port are never interpreted by a shell.
 */
function buildProxyArgv(host: string, port: number): { command: string; args: string[] } {
  const template = process.env.ATLAS_SSH_PROXY_COMMAND?.trim();
  if (template) {
    const parts = template
      .replace(/%h/g, host)
      .replace(/%p/g, String(port))
      .split(/\s+/)
      .filter(Boolean);
    return { command: parts[0] ?? "nc", args: parts.slice(1) };
  }
  return { command: "nc", args: [host, String(port)] };
}

function connectViaProxyCommand(config: ConnectConfig): Promise<Client> {
  const host = config.host ?? "";
  const port = config.port ?? 22;
  const { command, args } = buildProxyArgv(host, port);

  return new Promise<Client>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    const sock = Duplex.from({ readable: child.stdout!, writable: child.stdin! });

    let settled = false;
    const cleanupChild = (): void => {
      if (!child.killed) {
        child.kill();
      }
    };

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    const client = new Client();
    client
      .on("ready", () => {
        settled = true;
        client.once("close", cleanupChild);
        resolve(client);
      })
      .on("error", (error) => {
        if (!settled) {
          settled = true;
          cleanupChild();
          reject(error);
        }
      })
      .connect({ ...config, host: undefined, port: undefined, sock });
  });
}

export async function connect(credentials: SshCredentials): Promise<Client> {
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

  // Explicit operator override: always tunnel through the configured connector.
  if (process.env.ATLAS_SSH_PROXY_COMMAND?.trim()) {
    try {
      return await connectViaProxyCommand(config);
    } catch (error) {
      throw describeSshError(error, config.host ?? "", config.port ?? 22);
    }
  }

  let lastError: unknown;
  let sawRouteError = false;
  for (let attempt = 1; attempt <= SSH_CONNECT_ATTEMPTS; attempt++) {
    try {
      return await attemptConnect(config);
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== undefined && ROUTE_SSH_ERROR_CODES.has(code)) {
        sawRouteError = true;
        break;
      }
      const transient = code !== undefined && TRANSIENT_SSH_ERROR_CODES.has(code);
      if (!transient || attempt === SSH_CONNECT_ATTEMPTS) {
        break;
      }
      await delay(SSH_RETRY_DELAY_MS);
    }
  }

  // A direct route is unavailable (commonly a TUN proxy capturing this process).
  // Fall back to an external connector that the proxy lets reach the host.
  if (sawRouteError) {
    try {
      return await connectViaProxyCommand(config);
    } catch (proxyError) {
      const proxyCode = (proxyError as NodeJS.ErrnoException | undefined)?.code;
      if (proxyCode !== "ENOENT") {
        lastError = proxyError;
      }
    }
  }

  throw describeSshError(lastError, config.host ?? "", config.port ?? 22);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translates low-level socket / ssh2 errors into actionable messages so the UI
 * can tell users whether the problem is the network, the SSH service, or auth.
 */
export function describeSshError(error: unknown, host: string, port: number): Error {
  const target = `${host}:${port}`;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const level = (error as { level?: string } | undefined)?.level;
  const message = error instanceof Error ? error.message : String(error);

  const friendly = ((): string | undefined => {
    switch (code) {
      case "EHOSTUNREACH":
        return `Host ${target} is unreachable (no route to host). A TUN-mode proxy/VPN (Clash/Surge/Mihomo/OrbStack) is likely capturing this app and blocking the LAN route. We automatically retry through the system 'nc'; if it still fails, install netcat ('nc'), set ATLAS_SSH_PROXY_COMMAND="nc %h %p" (or your own connector), or temporarily disable the proxy. Also verify the IP is correct and you are on the same network.`;
      case "ENETUNREACH":
        return `Network unreachable when contacting ${target}. Check your network connection, subnet, or VPN.`;
      case "ECONNREFUSED":
        return `Connection refused by ${target}. The host is reachable but nothing is listening on that port — verify the SSH service is running and the port is correct.`;
      case "ETIMEDOUT":
        return `Connection to ${target} timed out. A firewall may be blocking the port, or the host is offline.`;
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return `Could not resolve host "${host}". Check the hostname or DNS settings.`;
      case "ECONNRESET":
        return `Connection to ${target} was reset. The remote SSH service may have dropped the connection.`;
      default:
        break;
    }

    if (level === "client-authentication" || /authentication methods failed/i.test(message)) {
      return "SSH authentication failed. Check the username, password, private key, or passphrase.";
    }
    if (level === "client-timeout" || /timed out while waiting for handshake/i.test(message)) {
      return `Timed out during the SSH handshake with ${target}. The host may not be an SSH server or is overloaded.`;
    }
    return undefined;
  })();

  return new Error(friendly ?? `Failed to connect to ${target}: ${message}`);
}

async function collectRemotePaths(
  client: Client
): Promise<Array<{ remotePath: string; source: SessionSource; kind: RemoteSessionEntryKind }>> {
  const scripts: Array<{ source: SessionSource; kind: RemoteSessionEntryKind; script: string }> = [
    {
      source: "codex",
      kind: "file",
      script:
        `find "$HOME/.codex/sessions" -type f -name 'rollout-*.jsonl' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "claude",
      kind: "file",
      script:
        `find "$HOME/.claude/projects" -type f -name '*.jsonl' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "opencode",
      kind: "file",
      script:
        `if [ -f "$HOME/.local/share/opencode/opencode.db" ]; then printf '%s\n' "$HOME/.local/share/opencode/opencode.db"; fi`
    },
    {
      source: "gemini",
      kind: "file",
      script:
        `find "$HOME/.gemini/tmp" -type f -name '*.json' 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "antigravity",
      kind: "file",
      script:
        `{ find "$HOME/.gemini/antigravity/brain" -type f -path '*/.system_generated/logs/transcript_full.jsonl' 2>/dev/null; find "$HOME/.gemini/antigravity/conversations" -type f \\( -name '*.pb' -o -name '*.db' \\) 2>/dev/null; } | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "antigravity",
      kind: "file",
      script:
        `{ find "$HOME/.gemini/antigravity-cli/brain" -type f -path '*/.system_generated/logs/transcript_full.jsonl' 2>/dev/null; find "$HOME/.gemini/antigravity-cli/conversations" -type f \\( -name '*.pb' -o -name '*.db' \\) 2>/dev/null; find "$HOME/.gemini/antigravity-cli/implicit" -type f \\( -name '*.pb' -o -name '*.db' \\) 2>/dev/null; } | head -n ${MAX_REMOTE_RESULTS}`
    },
    {
      source: "copilot",
      kind: "directory",
      script:
        `find "$HOME/.copilot/session-state" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n ${MAX_REMOTE_RESULTS}`
    }
  ];

  const records: Array<{
    remotePath: string;
    source: SessionSource;
    kind: RemoteSessionEntryKind;
  }> = [];

  for (const item of scripts) {
    const stdout = await execRemote(client, item.script);
    for (const line of stdout.split("\n")) {
      const remotePath = line.trim();
      if (!remotePath) {
        continue;
      }
      records.push({ remotePath, source: item.source, kind: item.kind });
    }
  }

  const deduped = new Map<
    string,
    { remotePath: string; source: SessionSource; kind: RemoteSessionEntryKind }
  >();
  for (const record of records) {
    deduped.set(record.remotePath, record);
  }

  return dedupeAntigravityRemoteEntries([...deduped.values()]);
}

function dedupeAntigravityRemoteEntries(
  entries: Array<{ remotePath: string; source: SessionSource; kind: RemoteSessionEntryKind }>
): Array<{ remotePath: string; source: SessionSource; kind: RemoteSessionEntryKind }> {
  const selected = new Map<
    string,
    { remotePath: string; source: SessionSource; kind: RemoteSessionEntryKind }
  >();
  const passthrough: Array<{
    remotePath: string;
    source: SessionSource;
    kind: RemoteSessionEntryKind;
  }> = [];

  for (const entry of entries) {
    if (entry.source !== "antigravity") {
      passthrough.push(entry);
      continue;
    }

    const sessionId = antigravityRemoteSessionId(entry.remotePath);
    const key = sessionId ?? entry.remotePath;
    const current = selected.get(key);
    if (!current || preferAntigravityRemotePath(entry.remotePath, current.remotePath)) {
      selected.set(key, entry);
    }
  }

  return [...passthrough, ...selected.values()];
}

function antigravityRemoteSessionId(remotePath: string): string | undefined {
  const normalized = remotePath.replaceAll("\\", "/");
  const transcriptMatch = normalized.match(
    /\/brain\/([^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/i
  );
  if (transcriptMatch?.[1]) {
    return transcriptMatch[1];
  }

  if (normalized.endsWith(".pb")) {
    return path.posix.basename(normalized, ".pb");
  }
  if (normalized.endsWith(".db")) {
    return path.posix.basename(normalized, ".db");
  }
  return undefined;
}

function preferAntigravityRemotePath(candidate: string, current: string): boolean {
  const candidateIsTranscript = candidate
    .replaceAll("\\", "/")
    .toLowerCase()
    .endsWith("/.system_generated/logs/transcript_full.jsonl");
  const currentIsTranscript = current
    .replaceAll("\\", "/")
    .toLowerCase()
    .endsWith("/.system_generated/logs/transcript_full.jsonl");

  if (candidateIsTranscript !== currentIsTranscript) {
    return candidateIsTranscript;
  }

  return candidate.localeCompare(current) < 0;
}

export async function execRemote(client: Client, command: string): Promise<string> {
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

export async function openSftp(client: Client): Promise<SFTPWrapper> {
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

async function statRemotePath(sftp: SFTPWrapper, remotePath: string) {
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

async function syncCopilotDirectory(
  sftp: SFTPWrapper,
  destinationRoot: string,
  remoteDirectoryPath: string
): Promise<Array<{ remotePath: string; localPath: string }>> {
  const downloaded: Array<{ remotePath: string; localPath: string }> = [];

  for (const relativePath of COPILOT_BUNDLE_FILES) {
    const remotePath = path.posix.join(remoteDirectoryPath, relativePath);
    try {
      const localPath = await syncRemoteFile(sftp, destinationRoot, remotePath);
      downloaded.push({ remotePath, localPath });
    } catch (error) {
      if (relativePath === COPILOT_EVENTS_FILE) {
        throw new Error(`Remote Copilot session is missing required file: ${remotePath}`);
      }

      if (!isSftpMissingError(error)) {
        throw error;
      }
    }
  }

  return downloaded;
}

async function syncRemoteFile(
  sftp: SFTPWrapper,
  destinationRoot: string,
  remotePath: string
): Promise<string> {
  const localPath = buildLocalPath(destinationRoot, remotePath);
  const remoteStats = await statRemotePath(sftp, remotePath);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fastGet(sftp, remotePath, localPath);
  await fs.utimes(
    localPath,
    new Date((remoteStats.atime || remoteStats.mtime) * 1000),
    new Date(remoteStats.mtime * 1000)
  );
  return localPath;
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

function isSftpMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("no such file") ||
    message.includes("not found") ||
    message.includes("failure")
  );
}
