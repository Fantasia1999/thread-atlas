import http from "node:http";
import { URL } from "node:url";

import { resolveAgentConfig } from "./agentConfig.js";
import { resolveLocalScanRoots } from "./platformRoots.js";
import { loadLocalSessionBundle, scanLocalSessions } from "./scanner.js";

const AGENT_NAME = "thread-atlas-agent";
const AGENT_VERSION = "0.1.0";

const config = resolveAgentConfig();

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function isAuthorized(request: http.IncomingMessage, url: URL): boolean {
  if (!config.token) {
    return true;
  }
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = match?.[1] ?? url.searchParams.get("token") ?? undefined;
  return provided === config.token;
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error."
    });
  });
});

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (!url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: "Not found." });
    return;
  }

  if (!isAuthorized(request, url)) {
    sendJson(response, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  if (url.pathname === "/api/agent/info") {
    sendJson(response, 200, {
      ok: true,
      info: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        tokenRequired: config.tokenRequired,
        capabilities: ["local-scan", "session-bundle"],
        roots: resolveLocalScanRoots()
      }
    });
    return;
  }

  if (url.pathname === "/api/local/scan") {
    const files = await scanLocalSessions();
    sendJson(response, 200, { ok: true, files });
    return;
  }

  if (url.pathname === "/api/local/session") {
    const key = url.searchParams.get("key")?.trim();
    if (!key) {
      sendJson(response, 400, { ok: false, error: "Missing key query parameter." });
      return;
    }
    try {
      const bundle = await loadLocalSessionBundle(key);
      sendJson(response, 200, { ok: true, bundle });
    } catch (error) {
      sendJson(response, 404, {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load bundle."
      });
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found." });
}

server.listen(config.port, config.host, () => {
  console.log(`${AGENT_NAME} v${AGENT_VERSION} listening on http://${config.host}:${config.port}`);
  console.log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);
  if (config.tokenRequired) {
    console.log(`token=${config.token}`);
  }
});
