import test from "node:test";
import assert from "node:assert/strict";

import type { MetadataValue, Session, SessionBundle, SessionSource } from "../shared/types.ts";
import {
  getServerAdapter,
  inferRegisteredSource,
  SERVER_SOURCE_ADAPTERS
} from "../server/sources/registry.ts";
import { detectSessionSource, parseSessionBundle } from "../src/parsers/detect.ts";
import { getAdapter, getSourceLabel, SOURCE_ADAPTERS } from "../src/sources/registry.ts";

function makeSession(
  source: SessionSource,
  metadata: Record<string, MetadataValue> = {},
  primaryPath = "/sessions/session.jsonl"
): Session {
  return {
    id: "session-1",
    source,
    title: "Session",
    summary: "",
    primaryPath,
    messageCount: 0,
    messages: [],
    metadata,
    rawFiles: []
  };
}

function makeBundle(content: string, source: SessionSource = "unknown"): SessionBundle {
  return {
    key: "import::session",
    source,
    title: "session.txt",
    primaryPath: "session.txt",
    relatedPaths: [],
    transport: "browser-file",
    origin: "imported",
    fileCount: 1,
    size: content.length,
    mtimeMs: 1,
    metadata: {},
    files: [{ path: "session.txt", content }]
  };
}

test("frontend source registry preserves detection priority", () => {
  assert.deepEqual(
    SOURCE_ADAPTERS.map((adapter) => adapter.id),
    ["codex", "copilot", "claude", "opencode", "antigravity", "gemini"]
  );
});

test("backend source registry preserves path inference priority", () => {
  assert.deepEqual(
    SERVER_SOURCE_ADAPTERS.map((adapter) => adapter.id),
    ["antigravity", "codex", "claude", "opencode", "copilot", "gemini"]
  );
});

test("backend source registry exposes adapters and current scan roots", () => {
  const roots = {
    codexSessions: [{ path: "/home/example/.codex/sessions" }],
    claudeProjects: [{ path: "/home/example/.claude/projects" }],
    geminiTmp: [{ path: "/home/example/.gemini/tmp" }],
    antigravityRoots: [
      { path: "/home/example/.gemini/antigravity" },
      { path: "/home/example/.gemini/antigravity-cli" }
    ],
    antigravityCliHistory: "/home/example/.gemini/antigravity-cli/history.jsonl",
    copilotSessionState: [{ path: "/home/example/.copilot/session-state" }],
    openCodeDb: [{ path: "/home/example/.local/share/opencode/opencode.db" }]
  };

  assert.equal(getServerAdapter("codex")?.id, "codex");
  assert.equal(getServerAdapter("unknown"), undefined);
  assert.deepEqual(
    Object.fromEntries(
      SERVER_SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter.scanRoots(roots)])
    ),
    {
      antigravity: roots.antigravityRoots.map((root) => ({
        path: root.path,
        archiveLabel: undefined
      })),
      codex: [{ path: roots.codexSessions[0].path, archiveLabel: undefined }],
      claude: [{ path: roots.claudeProjects[0].path, archiveLabel: undefined }],
      opencode: [{ path: roots.openCodeDb[0].path, archiveLabel: undefined }],
      copilot: [{ path: roots.copilotSessionState[0].path, archiveLabel: undefined }],
      gemini: [{ path: roots.geminiTmp[0].path, archiveLabel: undefined }]
    }
  );
});

test("backend source registry routes Windows paths with exact Antigravity matching", () => {
  const cases: Array<[string, SessionSource]> = [
    [
      "C:\\Users\\example\\.gemini\\antigravity\\conversations\\abc.pb",
      "antigravity"
    ],
    [
      "C:\\Users\\example\\.gemini\\antigravity-cli\\brain\\abc\\.system_generated\\logs\\transcript_full.jsonl",
      "antigravity"
    ],
    ["C:\\Users\\example\\.codex\\sessions\\rollout-1.jsonl", "codex"],
    ["C:\\Users\\example\\rollout-2.jsonl", "codex"],
    ["C:\\Users\\example\\.claude\\projects\\demo\\session.jsonl", "claude"],
    ["C:\\Users\\example\\.local\\share\\opencode\\opencode.db", "opencode"],
    ["C:\\Users\\example\\.copilot\\session-state\\demo\\events.jsonl", "copilot"],
    ["C:\\Users\\example\\.gemini\\tmp\\chat.json", "gemini"],
    ["C:\\Users\\example\\.gemini\\antigravity\\notes\\session.jsonl", "gemini"],
    ["C:\\Users\\example\\sessions\\session.jsonl", "unknown"]
  ];

  for (const [absolutePath, expected] of cases) {
    assert.equal(inferRegisteredSource(absolutePath), expected, absolutePath);
  }
});

test("frontend source registry exposes adapters and current labels", () => {
  assert.equal(getAdapter("codex")?.id, "codex");
  assert.deepEqual(
    SOURCE_ADAPTERS.map((adapter) => adapter.label),
    ["Codex", "Copilot", "Claude", "OpenCode", "Antigravity", "Gemini"]
  );
  assert.equal(getSourceLabel("opencode"), "OpenCode");
});

test("frontend source registry leaves unknown sources unregistered", () => {
  assert.equal(getAdapter("unknown"), undefined);
  assert.equal(getSourceLabel("unknown"), "unknown");
});

test("registry order determines the first matching detected source", () => {
  const bundle = makeBundle("plain text");
  bundle.primaryPath = "/tmp/.codex/.copilot/events.jsonl";
  bundle.files[0].path = bundle.primaryPath;

  assert.equal(detectSessionSource(bundle), "codex");
});

test("explicit bundle source still bypasses detection", () => {
  const bundle = makeBundle('{"type":"session_meta"}', "gemini");

  assert.equal(detectSessionSource(bundle), "gemini");
});

test("generic messages object falls back to Gemini", () => {
  assert.equal(detectSessionSource(makeBundle('{"messages":[]}')), "gemini");
});

test("generic JSON falls back to OpenCode", () => {
  assert.equal(detectSessionSource(makeBundle('{"value":1}')), "opencode");
});

test("plain text falls back to Claude", () => {
  assert.equal(detectSessionSource(makeBundle("plain text")), "claude");
});

test("parse orchestration uses the detected adapter", () => {
  const session = parseSessionBundle(makeBundle('{"messages":[]}'));

  assert.equal(session.source, "gemini");
});

test("registry retains unsafe Codex resume commands", () => {
  const session = makeSession("codex", { sessionId: "session-1" });

  assert.equal(getAdapter("codex")?.buildResumeCommand?.(session), "codex resume session-1");
  assert.equal(
    getAdapter("codex")?.buildResumeCommand?.(session, { unsafe: true }),
    "codex resume session-1 --yolo"
  );
});

test("registry retains unsafe Antigravity resume commands", () => {
  const session = makeSession("antigravity", { cascadeId: "cascade-1" });

  assert.equal(
    getAdapter("antigravity")?.buildResumeCommand?.(session),
    "agy --conversation=cascade-1"
  );
  assert.equal(
    getAdapter("antigravity")?.buildResumeCommand?.(session, { unsafe: true }),
    "agy --conversation=cascade-1 --dangerously-skip-permissions"
  );
});

test("registry retains unsafe Claude resume commands", () => {
  const session = makeSession("claude", {}, "/sessions/claude-session.jsonl");

  assert.equal(
    getAdapter("claude")?.buildResumeCommand?.(session),
    "claude --resume claude-session"
  );
  assert.equal(
    getAdapter("claude")?.buildResumeCommand?.(session, { unsafe: true }),
    "claude --resume claude-session --dangerously-skip-permissions"
  );
});

test("registry retains Copilot resume command behavior when unsafe is requested", () => {
  const session = makeSession("copilot", { sessionId: "session-1" });

  assert.equal(
    getAdapter("copilot")?.buildResumeCommand?.(session, { unsafe: true }),
    "copilot --session-id=session-1"
  );
});
