import test from "node:test";
import assert from "node:assert/strict";

import { resolveLocalScanRoots } from "../server/platformRoots.ts";

test("resolveLocalScanRoots maps dot-directories under the home on Linux", () => {
  const roots = resolveLocalScanRoots({
    platform: "linux",
    home: "/home/alice",
    env: {}
  });

  assert.deepEqual(roots.codexSessions, [{ path: "/home/alice/.codex/sessions" }]);
  assert.deepEqual(roots.claudeProjects, [{ path: "/home/alice/.claude/projects" }]);
  assert.deepEqual(roots.geminiTmp, [{ path: "/home/alice/.gemini/tmp" }]);
  assert.deepEqual(roots.copilotSessionState, [
    { path: "/home/alice/.copilot/session-state" }
  ]);
  assert.deepEqual(roots.openCodeDb, [
    { path: "/home/alice/.local/share/opencode/opencode.db" }
  ]);
  assert.deepEqual(roots.antigravityRoots, [
    { path: "/home/alice/.gemini/antigravity" },
    { path: "/home/alice/.gemini/antigravity-cli" }
  ]);
  assert.equal(
    roots.antigravityCliHistory,
    "/home/alice/.gemini/antigravity-cli/history.jsonl"
  );
});

test("resolveLocalScanRoots honors XDG_DATA_HOME for OpenCode on any platform", () => {
  const roots = resolveLocalScanRoots({
    platform: "linux",
    home: "/home/alice",
    env: { XDG_DATA_HOME: "/custom/data" }
  });

  assert.deepEqual(roots.openCodeDb, [{ path: "/custom/data/opencode/opencode.db" }]);
});

test("resolveLocalScanRoots uses LOCALAPPDATA for OpenCode on Windows", () => {
  const roots = resolveLocalScanRoots({
    platform: "win32",
    home: "C:\\Users\\alice",
    env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" }
  });

  assert.deepEqual(roots.openCodeDb, [
    { path: "C:\\Users\\alice\\AppData\\Local\\opencode\\opencode.db" }
  ]);
  assert.deepEqual(roots.codexSessions, [
    { path: "C:\\Users\\alice\\.codex\\sessions" }
  ]);
});

test("resolveLocalScanRoots falls back to AppData Local when no env on Windows", () => {
  const roots = resolveLocalScanRoots({
    platform: "win32",
    home: "C:\\Users\\bob",
    env: {}
  });

  assert.deepEqual(roots.openCodeDb, [
    { path: "C:\\Users\\bob\\AppData\\Local\\opencode\\opencode.db" }
  ]);
});

test("resolveLocalScanRoots prefers APPDATA when LOCALAPPDATA is absent on Windows", () => {
  const roots = resolveLocalScanRoots({
    platform: "win32",
    home: "C:\\Users\\carol",
    env: { APPDATA: "C:\\Users\\carol\\AppData\\Roaming" }
  });

  assert.deepEqual(roots.openCodeDb, [
    { path: "C:\\Users\\carol\\AppData\\Roaming\\opencode\\opencode.db" }
  ]);
});
