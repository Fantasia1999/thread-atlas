import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { loadLocalSessionBundle } from "../server/scanner.ts";
import { getServerAdapter } from "../server/sources/registry.ts";
import { parseAntigravitySession } from "../src/parsers/antigravity.ts";
import { extractAntigravityPreviewTitle } from "../shared/extractors/antigravity.ts";
import type { SessionBundle } from "../shared/types.ts";

const PROMPT_TITLE = "Implement first user prompt extraction as session title";

test("parseAntigravitySession uses the first user message as the title", () => {
  const bundle = buildAntigravityBundle([
    {
      record_type: "session_meta",
      cascade_id: "019e0133-f8ec-7e62-8b31-bbe8d119c117"
    },
    {
      record_type: "message",
      role: "user",
      content: `<USER_REQUEST>\n${PROMPT_TITLE}\n</USER_REQUEST>`
    },
    {
      record_type: "message",
      role: "assistant",
      content: "Sure, let's implement that."
    }
  ]);

  const session = parseAntigravitySession(bundle);
  assert.equal(session.title, PROMPT_TITLE);
});

test("extractAntigravityPreviewTitle extracts the first user prompt correctly", () => {
  const content = [
    JSON.stringify({
      record_type: "session_meta",
      cascade_id: "019e0133"
    }),
    JSON.stringify({
      record_type: "message",
      role: "user",
      content: `<USER_REQUEST>\n${PROMPT_TITLE}\n</USER_REQUEST>`
    }),
    JSON.stringify({
      record_type: "message",
      role: "assistant",
      content: "Helper answer"
    })
  ].join("\n");

  assert.equal(extractAntigravityPreviewTitle(content), PROMPT_TITLE);
});

test("extractAntigravityPreviewTitle handles transcript step types (USER_INPUT)", () => {
  const content = [
    JSON.stringify({
      type: "USER_INPUT",
      content: `<USER_REQUEST>\n${PROMPT_TITLE}\n</USER_REQUEST>`
    })
  ].join("\n");

  assert.equal(extractAntigravityPreviewTitle(content), PROMPT_TITLE);
});

test("loadLocalSessionBundle uses Antigravity first prompt for bundle title", async (t) => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "thread-atlas-"));
  const fixtureRoot = path.join(baseDir, ".gemini", "antigravity-cli");
  // Note: the path must end with transcript_full.jsonl and have a /brain/<session-id>/.system_generated/logs/ directory structure
  const logsDir = path.join(fixtureRoot, "brain", "session123", ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const sessionPath = path.join(logsDir, "transcript_full.jsonl");

  await writeFile(
    sessionPath,
    JSON.stringify({
      type: "USER_INPUT",
      content: `<USER_REQUEST>\n${PROMPT_TITLE}\n</USER_REQUEST>`
    })
  );

  t.after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const key = `file::${sessionPath}`;
  const routedBundle = await getServerAdapter("antigravity")?.loadBundle?.(key);
  assert.equal(routedBundle?.key, key);

  const bundle = await loadLocalSessionBundle(key);
  assert.equal(bundle.title, PROMPT_TITLE);
});

function buildAntigravityBundle(records: Array<Record<string, unknown>>): SessionBundle {
  return {
    key: "file::/tmp/brain/session123/.system_generated/logs/transcript_full.jsonl",
    source: "antigravity",
    title: "transcript_full.jsonl",
    primaryPath: "/tmp/brain/session123/.system_generated/logs/transcript_full.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/brain/session123/.system_generated/logs/transcript_full.jsonl",
        content: records.map((record) => JSON.stringify(record)).join("\n")
      }
    ]
  };
}
