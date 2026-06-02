import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAgentConfig } from "./agentConfig.js";
import { resolveLocalScanRoots } from "./platformRoots.js";
import { loadLocalSessionBundle, scanLocalSessions } from "./scanner.js";
import {
  connectRemoteAgent,
  disconnectRemoteAgent,
  listRemoteAgents,
  proxyToRemoteAgent
} from "./remote.js";
import {
  scanRemoteSessions,
  syncRemoteFiles,
  testSshConnection,
  type RemoteSessionEntry,
  type SshCredentials
} from "./ssh.js";

const AGENT_NAME = "thread-atlas-agent";
const AGENT_VERSION = "0.1.0";

const config = resolveAgentConfig();
const app = express();

app.use(express.json({ limit: "5mb" }));

app.use("/api", createTokenGuard(config.token));

app.get(
  "/api/agent/info",
  handleJsonRoute(500, async () => {
    const roots = resolveLocalScanRoots();
    return {
      ok: true,
      info: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        tokenRequired: config.tokenRequired,
        capabilities: ["local-scan", "session-bundle", "ssh-sync", "ssh-scan"],
        roots
      }
    };
  })
);


app.post(
  "/api/ssh/test",
  handleJsonRoute(400, async (request) => {
    const credentials = readCredentials(request.body);
    await testSshConnection(credentials);
    return { ok: true };
  })
);

app.post(
  "/api/ssh/scan",
  handleJsonRoute(400, async (request) => {
    const credentials = readCredentials(request.body);
    const files = await scanRemoteSessions(credentials);
    return { ok: true, files };
  })
);

app.post(
  "/api/ssh/sync",
  handleJsonRoute(400, async (request) => {
    const credentials = readCredentials(request.body);
    const entries = readRemoteEntries(request.body.files);
    const result = await syncRemoteFiles(credentials, entries);
    return {
      ok: true,
      downloaded: result.downloaded
    };
  })
);

app.get(
  "/api/local/scan",
  handleJsonRoute(500, async () => {
    const files = await scanLocalSessions();
    return { ok: true, files };
  })
);

app.get(
  "/api/local/session",
  handleJsonRoute(404, async (request) => {
    const key = readRequiredQueryString(request, "key");
    const bundle = await loadLocalSessionBundle(key);
    return { ok: true, bundle };
  })
);

app.get("/api/local/file", async (req, res): Promise<void> => {
  try {
    const filePathQuery = req.query.path;
    const sessionKeyQuery = req.query.sessionKey;
    if (typeof filePathQuery !== "string") {
      res.status(400).json({ ok: false, error: "Missing path query parameter." });
      return;
    }

    const normalizedPath = path.resolve(filePathQuery);
    const isAllowed = await isPathAllowed(
      normalizedPath,
      typeof sessionKeyQuery === "string" ? sessionKeyQuery : undefined
    );
    if (!isAllowed) {
      res.status(403).json({
        ok: false,
        error: `Access denied. Path is not inside allowed session roots: ${normalizedPath}`
      });
      return;
    }

    try {
      const stats = await fs.promises.stat(normalizedPath);
      if (!stats.isFile()) {
        res.status(400).json({ ok: false, error: "Target path is not a file." });
        return;
      }
    } catch {
      res.status(404).json({ ok: false, error: "File not found." });
      return;
    }

    res.sendFile(normalizedPath, { dotfiles: "allow" });
  } catch (error) {
    res.status(500).json({ ok: false, error: toErrorMessage(error) });
  }
});

async function isPathAllowed(filePath: string, sessionKey?: string): Promise<boolean> {
  try {
    const resolvedPath = fs.realpathSync(path.resolve(filePath));
    const home = os.homedir();
    const allowedBases = [
      path.join(home, ".codex"),
      path.join(home, ".claude"),
      path.join(home, ".gemini"),
      path.join(home, ".copilot"),
      process.cwd()
    ];

    if (sessionKey) {
      try {
        const bundle = await loadLocalSessionBundle(sessionKey);
        if (bundle && bundle.metadata && typeof bundle.metadata.cwd === "string" && bundle.metadata.cwd.trim()) {
          allowedBases.push(bundle.metadata.cwd.trim());
        }
      } catch {
        // ignore
      }
    }

    try {
      const roots = resolveLocalScanRoots();
      if (roots.openCodeDb) {
        allowedBases.push(path.dirname(roots.openCodeDb));
      }
    } catch {
      // ignore
    }

    const resolvedBases = allowedBases.map((base) => {
      try {
        return fs.realpathSync(base);
      } catch {
        return path.resolve(base);
      }
    });

    return resolvedBases.some((base) => {
      const relative = path.relative(base, resolvedPath);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  } catch {
    return false;
  }
}

app.post(
  "/api/remote/connect",
  handleJsonRoute(500, async (request) => {
    const credentials = readCredentials(request.body);
    const agent = await connectRemoteAgent(credentials);
    return { ok: true, agent };
  })
);

app.get(
  "/api/remote/list",
  handleJsonRoute(500, async () => {
    return { ok: true, agents: listRemoteAgents() };
  })
);

app.delete(
  "/api/remote/:id",
  handleJsonRoute(500, async (request) => {
    const id = String(request.params.id);
    disconnectRemoteAgent(id);
    return { ok: true };
  })
);

app.get("/api/remote/:id/scan", relayRemoteRoute("/api/local/scan"));
app.get("/api/remote/:id/session", relayRemoteRoute("/api/local/session"));
app.get("/api/remote/:id/file", relayRemoteRoute("/api/local/file"));

const clientRoot = path.resolve(process.cwd(), "dist");
app.use(express.static(clientRoot));

app.listen(config.port, config.host, () => {
  console.log(`ThreadAtlas agent (${AGENT_NAME} v${AGENT_VERSION}) listening on:`);
  console.log(`  - Bind:    http://${config.host}:${config.port}`);
  console.log(`  - Local:   http://localhost:${config.port}`);
  if (config.tokenRequired) {
    console.log(`  - Token:   ${config.token}`);
  } else {
    console.log("  - Token:   (none; API is unauthenticated)");
  }
  if (config.host === "0.0.0.0" || config.host === "::") {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
          if (iface.family === "IPv4" && !iface.internal) {
            console.log(`  - Network: http://${iface.address}:${config.port}`);
          }
        }
      }
    } catch {
      // Gracefully ignore network interface query errors
    }
  }
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function createTokenGuard(token: string | undefined) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!token) {
      next();
      return;
    }

    const header = request.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const provided = match?.[1] ?? (request.query.token as string | undefined);

    if (provided !== token) {
      response.status(401).json({ ok: false, error: "Unauthorized." });
      return;
    }

    next();
  };
}

function handleJsonRoute(
  errorStatus: number,
  handler: (request: Request) => Promise<Record<string, unknown>>
) {
  return async (request: Request, response: Response): Promise<void> => {
    try {
      response.json(await handler(request));
    } catch (error) {
      response.status(error instanceof HttpError ? error.status : errorStatus).json({
        ok: false,
        error: toErrorMessage(error)
      });
    }
  };
}

function relayRemoteRoute(upstreamPath: string) {
  return async (request: Request, response: Response): Promise<void> => {
    try {
      const queryIndex = request.originalUrl.indexOf("?");
      const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : "";
      const relayed = await proxyToRemoteAgent(
        String(request.params.id),
        request.method,
        `${upstreamPath}${query}`
      );
      if (relayed.contentType) {
        response.type(relayed.contentType);
      } else {
        response.type("application/json");
      }
      response.status(relayed.status).send(relayed.body);
    } catch (error) {
      response.status(502).json({ ok: false, error: toErrorMessage(error) });
    }
  };
}

function readRequiredQueryString(request: Request, key: string): string {
  const value = String(request.query[key] ?? "").trim();
  if (!value) {
    throw new HttpError(400, `Missing ${key} query parameter.`);
  }

  return value;
}

function readCredentials(value: unknown): SshCredentials {
  const candidate = asRecord(value, "Missing SSH credentials.");
  const host = readRequiredString(candidate, "host", "Host and username are required.");
  const username = readRequiredString(candidate, "username", "Host and username are required.");

  if (!host || !username) {
    throw new Error("Host and username are required.");
  }

  return {
    host,
    port: readPort(candidate.port),
    username,
    password: readOptionalString(candidate.password),
    privateKey: String(candidate.privateKey ?? ""),
    passphrase: readOptionalString(candidate.passphrase)
  };
}

function readRemoteEntries(value: unknown): RemoteSessionEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Select at least one remote session item to sync.");
  }

  return value.map((item) => {
    const record = asRecord(item, "Invalid remote session selection.");
    return {
      path: readRequiredString(record, "path", "Invalid remote session selection."),
      source: String(record.source ?? "unknown") as RemoteSessionEntry["source"],
      kind: record.kind === "directory" ? "directory" : "file"
    };
  });
}

function asRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(errorMessage);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  errorMessage: string
): string {
  const value = String(record[key] ?? "").trim();
  if (!value) {
    throw new Error(errorMessage);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function readPort(value: unknown): number {
  if (value == null || value === "") {
    return 22;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Port must be a positive integer.");
  }

  return port;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error.";
}
