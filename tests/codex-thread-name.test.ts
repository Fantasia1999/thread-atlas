import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { loadLocalSessionBundle } from "../server/scanner.ts";
import { extractCodexPreviewTitle, parseCodexSession } from "../src/parsers/codex.ts";
import type { SessionBundle } from "../src/parsers/types.ts";

const CODEX_THREAD_NAME = "解释 physical-planner 模块";

test("parseCodexSession uses the latest thread_name_updated event as the title", () => {
  const bundle = buildCodexBundle([
    {
      timestamp: "2026-05-07T06:50:00.000Z",
      type: "session_meta",
      payload: {
        id: "019e0133-f8ec-7e62-8b31-bbe8d119c117",
        cwd: "/workspace/thread-atlas"
      }
    },
    {
      timestamp: "2026-05-07T06:51:07.486Z",
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_id: "019e0133-f8ec-7e62-8b31-bbe8d119c117",
        thread_name: CODEX_THREAD_NAME
      }
    },
    {
      timestamp: "2026-05-07T06:51:08.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "这个模块做什么？"
      }
    }
  ]);

  const session = parseCodexSession(bundle);

  assert.equal(session.title, CODEX_THREAD_NAME);
  assert.equal(session.metadata.threadName, CODEX_THREAD_NAME);
});

test("extractCodexPreviewTitle returns the latest non-empty thread name", () => {
  const content = [
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: "旧标题"
      }
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: CODEX_THREAD_NAME
      }
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: "  "
      }
    })
  ].join("\n");

  assert.equal(extractCodexPreviewTitle(content), CODEX_THREAD_NAME);
});

test("loadLocalSessionBundle uses Codex thread name for bundle title", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "thread-atlas-codex-"));
  const sessionPath = path.join(fixtureRoot, "rollout-2026-05-07.jsonl");

  await writeFile(
    sessionPath,
    JSON.stringify({
      timestamp: "2026-05-07T06:51:07.486Z",
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: CODEX_THREAD_NAME
      }
    })
  );

  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const bundle = await loadLocalSessionBundle(`file::${sessionPath}`);

  assert.equal(bundle.title, CODEX_THREAD_NAME);
});

function buildCodexBundle(records: Array<Record<string, unknown>>): SessionBundle {
  return {
    key: "file::/tmp/rollout-2026-05-07.jsonl",
    source: "codex",
    title: "rollout-2026-05-07.jsonl",
    primaryPath: "/tmp/rollout-2026-05-07.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/rollout-2026-05-07.jsonl",
        content: records.map((record) => JSON.stringify(record)).join("\n")
      }
    ]
  };
}
