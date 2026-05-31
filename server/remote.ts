import net from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import http from "node:http";
import type { Client } from "ssh2";

import { connect, execRemote, openSftp, type SshCredentials } from "./ssh.js";

const REMOTE_AGENT_DIR = ".thread-atlas/agent";
const REMOTE_AGENT_FILE = "atlas-agent.mjs";
const REMOTE_LOG_FILE = "agent.log";
const AGENT_BUNDLE_PATH = path.resolve(process.cwd(), "dist", "agent", REMOTE_AGENT_FILE);

export interface RemoteAgentSummary {
  id: string;
  label: string;
  host: string;
  username: string;
  platform?: string;
  remotePort: number;
}

interface RemoteAgentRuntime extends RemoteAgentSummary {
  client: Client;
  tunnel: net.Server;
  localPort: number;
  token: string;
  remotePid?: number;
}

const registry = new Map<string, RemoteAgentRuntime>();

export function listRemoteAgents(): RemoteAgentSummary[] {
  return [...registry.values()].map((runtime) => ({
    id: runtime.id,
    label: runtime.label,
    host: runtime.host,
    username: runtime.username,
    platform: runtime.platform,
    remotePort: runtime.remotePort
  }));
}

export async function connectRemoteAgent(
  credentials: SshCredentials
): Promise<RemoteAgentSummary> {
  const bundle = await readAgentBundle();
  const client = await connect(credentials);

  let tunnel: net.Server | undefined;
  let remotePid: number | undefined;
  const token = randomBytes(24).toString("hex");
  const remotePort = pickRemotePort();

  try {
    const nodePath = await resolveRemoteNode(client);
    await deployAgentBundle(client, bundle);
    remotePid = await startRemoteAgent(client, nodePath, remotePort, token);

    tunnel = await createTunnel(client, remotePort);
    const localPort = (tunnel.address() as net.AddressInfo).port;

    const info = await waitForRemoteAgent(client, localPort, token);

    const id = stableAgentId(credentials);
    const label = `${credentials.username}@${credentials.host}`;

    // Reconnecting the same host reuses the same stable id; tear down any
    // previous runtime under that id so its tunnel/client/process don't leak.
    const previous = registry.get(id);
    if (previous) {
      registry.delete(id);
      await teardownRuntime(previous);
    }

    const runtime: RemoteAgentRuntime = {
      id,
      label,
      host: credentials.host,
      username: credentials.username,
      platform: info.platform,
      remotePort,
      client,
      tunnel,
      localPort,
      token,
      remotePid
    };

    client.on("close", () => {
      if (registry.get(id) === runtime) {
        registry.delete(id);
      }
    });

    registry.set(id, runtime);
    return summaryOf(runtime);
  } catch (error) {
    tunnel?.close();
    if (remotePid !== undefined) {
      await killRemoteAgent(client, remotePid).catch(() => undefined);
    }
    client.end();
    throw error;
  }
}

/**
 * Derives a deterministic agent id from the SSH target so reconnecting the same
 * host reuses the same id. This keeps namespaced remote session keys (and the
 * favorites/pins built on them) stable across reconnects and page refreshes.
 */
function stableAgentId(credentials: SshCredentials): string {
  const port = credentials.port ?? 22;
  const target = `${credentials.username}@${credentials.host}:${port}`;
  return createHash("sha256").update(target).digest("hex").slice(0, 16);
}

async function teardownRuntime(runtime: RemoteAgentRuntime): Promise<void> {
  runtime.tunnel.close();
  if (runtime.remotePid !== undefined) {
    await killRemoteAgent(runtime.client, runtime.remotePid).catch(() => undefined);
  }
  runtime.client.end();
}

export async function disconnectRemoteAgent(id: string): Promise<void> {
  const runtime = registry.get(id);
  if (!runtime) {
    return;
  }
  registry.delete(id);
  await teardownRuntime(runtime);
}

export interface ProxyResponse {
  status: number;
  body: string;
}

export async function proxyToRemoteAgent(
  id: string,
  method: string,
  pathWithQuery: string
): Promise<ProxyResponse> {
  const runtime = registry.get(id);
  if (!runtime) {
    throw new Error("Unknown or disconnected remote agent.");
  }
  return await httpRequest(runtime.localPort, runtime.token, method, pathWithQuery);
}

function summaryOf(runtime: RemoteAgentRuntime): RemoteAgentSummary {
  return {
    id: runtime.id,
    label: runtime.label,
    host: runtime.host,
    username: runtime.username,
    platform: runtime.platform,
    remotePort: runtime.remotePort
  };
}

async function readAgentBundle(): Promise<Buffer> {
  try {
    return await fs.readFile(AGENT_BUNDLE_PATH);
  } catch {
    throw new Error(
      `Agent bundle not found at ${AGENT_BUNDLE_PATH}. Run "npm run build:agent" first.`
    );
  }
}

const MIN_REMOTE_NODE_MAJOR = 22;

/**
 * POSIX-sh script that prints, on stdout, the path of the first `node` whose
 * major version is >= MIN_REMOTE_NODE_MAJOR, scanning a broad set of candidates.
 *
 * This matters because a remote may have an old system `node` (e.g. /usr/bin/node
 * v20) that wins on PATH in non-login *and* login shells, while a newer Node is
 * only exposed via nvm/fnm initialised in interactive rc files. Taking the first
 * `node` on PATH would wrongly reject such hosts, so we enumerate candidates and
 * pick the first new-enough one. If none qualifies, it prints "NEWEST <version>"
 * (or nothing) so the caller can produce an actionable error.
 */
const REMOTE_NODE_PROBE = `
min=${MIN_REMOTE_NODE_MAJOR}
newest=""
{
  command -v node 2>/dev/null
  if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; command -v node 2>/dev/null; fi
  ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null
  ls -1 "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null
  for p in /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.local/bin/node"; do [ -x "$p" ] && printf '%s\\n' "$p"; done
} | while IFS= read -r p; do
  [ -x "$p" ] || continue
  v=$("$p" -v 2>/dev/null)
  maj=$(printf '%s' "$v" | sed -E 's/^v([0-9]+).*/\\1/')
  case "$maj" in ''|*[!0-9]*) continue ;; esac
  if [ "$maj" -ge "$min" ]; then printf 'NODE %s\\n' "$p"; exit 0; fi
  newest="$v"
done
[ -n "$newest" ] && printf 'NEWEST %s\\n' "$newest"
`.trim();

async function resolveRemoteNode(client: Client): Promise<string> {
  let output = "";
  try {
    output = (await execRemote(client, REMOTE_NODE_PROBE)).trim();
  } catch {
    output = "";
  }

  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const selected = lines.find((line) => line.startsWith("NODE "));
  if (selected) {
    return selected.slice("NODE ".length).trim();
  }

  const newest = lines.find((line) => line.startsWith("NEWEST "));
  if (newest) {
    const version = newest.slice("NEWEST ".length).trim();
    throw new Error(
      `Remote Node.js ${version} is too old; the agent requires Node.js ${MIN_REMOTE_NODE_MAJOR}+. ` +
        `A newer Node may exist via nvm/fnm but is only loaded in interactive shells — ` +
        `symlink it onto PATH for non-interactive SSH (e.g. 'sudo ln -sf "$(command -v node)" /usr/local/bin/node' ` +
        `from a shell where the right version is active), or upgrade the system Node.`
    );
  }

  throw new Error(
    "Remote host has no usable 'node'. Install Node.js " +
      `${MIN_REMOTE_NODE_MAJOR}+ on the remote Linux machine, or ensure it is reachable ` +
      "from a non-interactive SSH shell (e.g. symlink it into /usr/local/bin)."
  );
}

async function deployAgentBundle(client: Client, bundle: Buffer): Promise<void> {
  await execRemote(client, `mkdir -p "$HOME/${REMOTE_AGENT_DIR}"`);
  const sftp = await openSftp(client);
  const remotePath = await remoteAgentPath(client);
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on("close", () => resolve());
    stream.on("error", (error: Error) => reject(error));
    stream.end(bundle);
  });
}

async function startRemoteAgent(
  client: Client,
  nodePath: string,
  remotePort: number,
  token: string
): Promise<number> {
  const remotePath = await remoteAgentPath(client);
  const logPath = `"$HOME/${REMOTE_AGENT_DIR}/${REMOTE_LOG_FILE}"`;
  const command =
    `nohup "${nodePath}" "${remotePath}" --host 127.0.0.1 --port ${remotePort} --token ${token} ` +
    `> ${logPath} 2>&1 & echo $!`;
  const stdout = await execRemote(client, command);
  const pid = Number(stdout.trim().split(/\s+/).pop());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Failed to start the remote agent process.");
  }
  return pid;
}

async function killRemoteAgent(client: Client, pid: number): Promise<void> {
  await execRemote(client, `kill ${pid} 2>/dev/null || true`);
}

async function remoteAgentPath(client: Client): Promise<string> {
  const home = (await execRemote(client, "printf '%s' \"$HOME\"")).trim() || "$HOME";
  return `${home}/${REMOTE_AGENT_DIR}/${REMOTE_AGENT_FILE}`;
}

function createTunnel(client: Client, remotePort: number): Promise<net.Server> {
  const server = net.createServer((socket) => {
    const remoteAddress = socket.remoteAddress ?? "127.0.0.1";
    const remoteSrcPort = socket.remotePort ?? 0;
    client.forwardOut(remoteAddress, remoteSrcPort, "127.0.0.1", remotePort, (error, stream) => {
      if (error) {
        socket.destroy();
        return;
      }
      socket.pipe(stream).pipe(socket);
      stream.on("error", () => socket.destroy());
      socket.on("error", () => stream.end());
    });
  });

  return new Promise<net.Server>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

interface RemoteAgentInfo {
  platform?: string;
}

async function waitForRemoteAgent(
  client: Client,
  localPort: number,
  token: string
): Promise<RemoteAgentInfo> {
  let lastError = "agent did not respond";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await httpRequest(localPort, token, "GET", "/api/agent/info");
      if (response.status === 200) {
        const parsed = JSON.parse(response.body) as { info?: RemoteAgentInfo };
        return parsed.info ?? {};
      }
      lastError = `agent responded with status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }

  const log = await readRemoteAgentLog(client);
  const suffix = log ? ` Remote log:\n${log}` : "";
  throw new Error(`Remote agent failed to become ready: ${lastError}.${suffix}`);
}

async function readRemoteAgentLog(client: Client): Promise<string> {
  try {
    const out = await execRemote(
      client,
      `tail -n 20 "$HOME/${REMOTE_AGENT_DIR}/${REMOTE_LOG_FILE}" 2>/dev/null`
    );
    return out.trim();
  } catch {
    return "";
  }
}

function httpRequest(
  port: number,
  token: string,
  method: string,
  pathWithQuery: string
): Promise<ProxyResponse> {
  return new Promise<ProxyResponse>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: pathWithQuery,
        headers: { Authorization: `Bearer ${token}` }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 502,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function pickRemotePort(): number {
  return 39000 + Math.floor(Math.random() * 2000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
