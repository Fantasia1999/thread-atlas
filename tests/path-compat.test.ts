import test from "node:test";
import assert from "node:assert/strict";

import { parseClaudeSession } from "../src/parsers/claude.ts";
import { parseCodexSession } from "../src/parsers/codex.ts";
import { detectSessionSource } from "../src/parsers/detect.ts";
import type { SessionBundle } from "../src/parsers/types.ts";
import {
  inferSourceFromPath,
  isWithinPathRoot,
  normalizePathForMatch
} from "../server/scanner.ts";

test("normalizePathForMatch converts Windows separators to lowercase POSIX-style paths", () => {
  assert.equal(
    normalizePathForMatch("C:\\Users\\Alice\\.Codex\\Sessions\\Rollout-1.JSONL"),
    "c:/users/alice/.codex/sessions/rollout-1.jsonl"
  );
});

test("inferSourceFromPath recognizes Windows session roots", () => {
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl"),
    "codex"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl"),
    "claude"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\tmp\\chat.json"),
    "gemini"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.local\\share\\opencode\\opencode.db"),
    "opencode"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\antigravity\\conversations\\abc.pb"),
    "antigravity"
  );
});

test("isWithinPathRoot matches Windows-style remote mirror paths", () => {
  assert.equal(
    isWithinPathRoot(
      "C:\\work\\thread-atlas\\data\\remote\\alice@host\\home\\alice\\.codex\\sessions\\rollout-1.jsonl",
      "C:\\work\\thread-atlas\\data\\remote"
    ),
    true
  );
  assert.equal(
    isWithinPathRoot(
      "C:\\work\\thread-atlas\\data\\remote-other\\alice@host\\home\\alice\\.codex\\sessions\\rollout-1.jsonl",
      "C:\\work\\thread-atlas\\data\\remote"
    ),
    false
  );
});

test("detectSessionSource recognizes Windows bundle paths", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    source: "unknown",
    title: "rollout-1.jsonl",
    primaryPath: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
        content: "{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"C:\\\\repo\\\\atlas\"}}"
      }
    ]
  };

  assert.equal(detectSessionSource(bundle), "codex");
});

test("parseCodexSession uses Windows cwd basename in the title", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    source: "codex",
    title: "rollout-1.jsonl",
    primaryPath: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
        content: [
          JSON.stringify({
            type: "session_meta",
            payload: {
              id: "codex-1",
              cwd: "C:\\repo\\thread-atlas"
            }
          }),
          JSON.stringify({
            type: "message",
            role: "user",
            content: "hello"
          })
        ].join("\n")
      }
    ]
  };

  const session = parseCodexSession(bundle);
  assert.equal(session.title, "thread-atlas · Codex");
});

test("parseClaudeSession uses Windows cwd basename in the title", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
    source: "claude",
    title: "session.jsonl",
    primaryPath: "C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
        content: JSON.stringify({
          cwd: "C:\\repo\\thread-atlas",
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "hello" }]
          }
        })
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  assert.equal(session.title, "thread-atlas · Claude");
});
