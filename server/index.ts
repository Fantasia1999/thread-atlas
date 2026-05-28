import express, { type Request, type Response } from "express";
import path from "node:path";

import { loadLocalSessionBundle, scanLocalSessions } from "./scanner.js";
import {
  scanRemoteSessions,
  syncRemoteFiles,
  testSshConnection,
  type RemoteSessionEntry,
  type SshCredentials
} from "./ssh.js";

const app = express();
const port = 3030;

app.use(express.json({ limit: "5mb" }));

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

const clientRoot = path.resolve(process.cwd(), "dist");
app.use(express.static(clientRoot));

app.listen(port, () => {
  console.log(`ThreadAtlas backend listening on http://localhost:${port}`);
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
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
