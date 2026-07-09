import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { loadLocalSessionBundle, scanLocalSessions } from "../server/scanner.ts";
import { getServerAdapter } from "../server/sources/registry.ts";
import { parseCopilotSession } from "../src/parsers/copilot.ts";
import { detectSessionSource } from "../src/parsers/detect.ts";
import type { SessionBundle } from "../shared/types.ts";

test("detectSessionSource recognizes Copilot events bundles", () => {
  const bundle: SessionBundle = {
    key: "import::copilot-events",
    source: "unknown",
    title: "events.jsonl",
    primaryPath: "events.jsonl",
    relatedPaths: [],
    transport: "browser-file",
    origin: "imported",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "events.jsonl",
        content: JSON.stringify({
          type: "session.start",
          data: {
            producer: "copilot-agent"
          }
        })
      }
    ]
  };

  assert.equal(detectSessionSource(bundle), "copilot");
});

test("loadLocalSessionBundle loads Copilot session directories", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "thread-atlas-copilot-"));
  const sessionDir = path.join(fixtureRoot, "session-1");

  await mkdir(path.join(sessionDir, "checkpoints"), { recursive: true });
  await writeFile(
    path.join(sessionDir, "events.jsonl"),
    JSON.stringify({
      type: "session.start",
      data: {
        sessionId: "session-1",
        producer: "copilot-agent"
      }
    })
  );
  await writeFile(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-1",
      "cwd: /repo/thread-atlas",
      "summary: Demo Copilot Session",
      "created_at: 2026-04-02T08:58:24.119Z",
      "updated_at: 2026-04-02T09:00:19.604Z"
    ].join("\n")
  );
  await writeFile(path.join(sessionDir, "vscode.metadata.json"), "{}");
  await writeFile(path.join(sessionDir, "plan.md"), "# Plan");
  await writeFile(path.join(sessionDir, "checkpoints", "index.md"), "# Checkpoints");

  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const key = `copilot-dir::${sessionDir}`;
  const routedBundle = await getServerAdapter("copilot")?.loadBundle?.(key);
  assert.equal(routedBundle?.key, key);

  const bundle = await loadLocalSessionBundle(key);

  assert.equal(bundle.source, "copilot");
  assert.equal(bundle.title, "Demo Copilot Session");
  assert.equal(bundle.primaryPath, sessionDir);
  assert.equal(bundle.fileCount, 5);
  assert.deepEqual(
    bundle.files.map((file) => path.basename(file.path)).sort(),
    ["events.jsonl", "workspace.yaml", "vscode.metadata.json", "plan.md", "index.md"].sort()
  );
});

test("Copilot sessions are discovered and loaded from the remote mirror", async (t) => {
  const fixtureRoot = path.join(
    process.cwd(),
    "data",
    "remote",
    `copilot-test-${process.pid}-${Date.now()}`
  );
  const sessionDir = path.join(
    fixtureRoot,
    "alice@host",
    "home",
    "alice",
    ".copilot",
    "session-state",
    "session-remote-1"
  );

  await mkdir(path.join(sessionDir, "checkpoints"), { recursive: true });
  await writeFile(
    path.join(sessionDir, "events.jsonl"),
    JSON.stringify({
      type: "session.start",
      data: {
        sessionId: "session-remote-1",
        producer: "copilot-agent"
      }
    })
  );
  await writeFile(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-remote-1",
      "cwd: /repo/thread-atlas",
      "summary: Remote Copilot Session",
      "updated_at: 2026-04-02T09:00:19.604Z"
    ].join("\n")
  );
  await writeFile(path.join(sessionDir, "vscode.metadata.json"), "{\"producer\":\"copilot-agent\"}");

  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const descriptors = await scanLocalSessions();
  const descriptor = descriptors.find((entry) => entry.key === `copilot-dir::${sessionDir}`);

  assert.ok(descriptor);
  assert.equal(descriptor.source, "copilot");
  assert.equal(descriptor.origin, "remote");
  assert.equal(descriptor.transport, "ssh-sync");
  assert.equal(descriptor.title, "Remote Copilot Session");
  assert.equal(descriptor.fileCount, 3);
  assert.equal(
    descriptors.some((entry) => entry.key === `file::${path.join(sessionDir, "events.jsonl")}`),
    false
  );

  const bundle = await loadLocalSessionBundle(descriptor.key);
  assert.equal(bundle.key, descriptor.key);
  assert.equal(bundle.files.length, 3);
  assert.deepEqual(
    bundle.files.map((file) => path.basename(file.path)).sort(),
    ["events.jsonl", "workspace.yaml", "vscode.metadata.json"].sort()
  );
});

test("parseCopilotSession merges assistant tool requests with execution events", () => {
  const bundle: SessionBundle = {
    key: "copilot-dir::/tmp/session-1",
    source: "copilot",
    title: "session-1",
    primaryPath: "/tmp/session-1",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 2,
    size: 1,
    mtimeMs: Date.parse("2026-04-02T09:00:19.604Z"),
    metadata: {},
    files: [
      {
        path: "/tmp/session-1/events.jsonl",
        content: [
          JSON.stringify({
            type: "session.start",
            id: "event-1",
            timestamp: "2026-04-02T08:58:24.122Z",
            data: {
              sessionId: "session-1",
              producer: "copilot-agent",
              copilotVersion: "1.0.15",
              startTime: "2026-04-02T08:58:24.116Z",
              context: {
                cwd: "/repo/thread-atlas",
                branch: "main"
              }
            }
          }),
          JSON.stringify({
            type: "session.model_change",
            id: "event-2",
            timestamp: "2026-04-02T08:58:56.836Z",
            data: {
              newModel: "claude-opus-4.6",
              reasoningEffort: "high"
            }
          }),
          JSON.stringify({
            type: "user.message",
            id: "event-3",
            timestamp: "2026-04-02T09:00:13.539Z",
            data: {
              content: "帮我做个计划"
            }
          }),
          JSON.stringify({
            type: "assistant.message",
            id: "event-4",
            timestamp: "2026-04-02T09:00:23.635Z",
            data: {
              messageId: "assistant-1",
              content: "",
              toolRequests: [
                {
                  toolCallId: "tool-1",
                  name: "bash",
                  arguments: {
                    command: "git status"
                  },
                  type: "function"
                }
              ]
            }
          }),
          JSON.stringify({
            type: "tool.execution_start",
            id: "event-5",
            timestamp: "2026-04-02T09:00:23.636Z",
            data: {
              toolCallId: "tool-1",
              toolName: "bash",
              arguments: {
                command: "git status"
              }
            }
          }),
          JSON.stringify({
            type: "tool.execution_complete",
            id: "event-6",
            timestamp: "2026-04-02T09:00:24.533Z",
            data: {
              toolCallId: "tool-1",
              toolName: "bash",
              success: true,
              result: {
                content: "On branch main"
              }
            }
          }),
          JSON.stringify({
            type: "session.mode_changed",
            id: "event-7",
            timestamp: "2026-04-02T09:00:30.000Z",
            data: {
              previousMode: "interactive",
              newMode: "plan"
            }
          })
        ].join("\n")
      },
      {
        path: "/tmp/session-1/workspace.yaml",
        content: [
          "id: session-1",
          "cwd: /repo/thread-atlas",
          "summary: Demo Plan Session",
          "created_at: 2026-04-02T08:58:24.119Z",
          "updated_at: 2026-04-02T09:00:30.000Z"
        ].join("\n")
      }
    ]
  };

  const session = parseCopilotSession(bundle);
  const assistantMessage = session.messages.find((message) => message.id === "assistant-1");
  const modeChange = session.messages.find((message) => message.rawType === "session.mode_changed");

  assert.equal(session.title, "Demo Plan Session");
  assert.equal(session.cwd, "/repo/thread-atlas");
  assert.equal(session.metadata.model, "claude-opus-4.6");
  assert.equal(session.metadata.branch, "main");
  assert.equal(assistantMessage?.toolCalls?.length, 1);
  assert.equal(assistantMessage?.toolCalls?.[0]?.status, "completed");
  assert.equal(assistantMessage?.toolCalls?.[0]?.output, "On branch main");
  assert.equal(modeChange?.text, "Mode changed: interactive -> plan");
});
