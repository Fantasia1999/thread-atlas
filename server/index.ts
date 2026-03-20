import express from "express";
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

app.post("/api/ssh/test", async (request, response) => {
  try {
    const credentials = readCredentials(request.body);
    await testSshConnection(credentials);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: toErrorMessage(error)
    });
  }
});

app.post("/api/ssh/scan", async (request, response) => {
  try {
    const credentials = readCredentials(request.body);
    const files = await scanRemoteSessions(credentials);
    response.json({ ok: true, files });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: toErrorMessage(error)
    });
  }
});

app.post("/api/ssh/sync", async (request, response) => {
  try {
    const credentials = readCredentials(request.body);
    const entries = readRemoteEntries(request.body.files);
    const result = await syncRemoteFiles(credentials, entries);
    response.json({
      ok: true,
      downloaded: result.downloaded
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: toErrorMessage(error)
    });
  }
});

app.get("/api/local/scan", async (_request, response) => {
  try {
    const files = await scanLocalSessions();
    response.json({ ok: true, files });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: toErrorMessage(error)
    });
  }
});

app.get("/api/local/session", async (request, response) => {
  try {
    const key = String(request.query.key ?? "");
    if (!key) {
      response.status(400).json({ ok: false, error: "Missing key query parameter." });
      return;
    }

    const bundle = await loadLocalSessionBundle(key);
    response.json({ ok: true, bundle });
  } catch (error) {
    response.status(404).json({
      ok: false,
      error: toErrorMessage(error)
    });
  }
});

const clientRoot = path.resolve(process.cwd(), "dist");
app.use(express.static(clientRoot));

app.listen(port, () => {
  console.log(`ThreadAtlas backend listening on http://127.0.0.1:${port}`);
});

function readCredentials(value: unknown): SshCredentials {
  if (!value || typeof value !== "object") {
    throw new Error("Missing SSH credentials.");
  }

  const candidate = value as Record<string, unknown>;
  const host = String(candidate.host ?? "").trim();
  const username = String(candidate.username ?? "").trim();

  if (!host || !username) {
    throw new Error("Host and username are required.");
  }

  return {
    host,
    port: candidate.port ? Number(candidate.port) : 22,
    username,
    password: String(candidate.password ?? "").trim() || undefined,
    privateKey: String(candidate.privateKey ?? ""),
    passphrase: String(candidate.passphrase ?? "").trim() || undefined
  };
}

function readRemoteEntries(value: unknown): RemoteSessionEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Select at least one remote file to sync.");
  }

  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      path: String(record.path ?? ""),
      source: String(record.source ?? "unknown") as RemoteSessionEntry["source"]
    };
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error.";
}
