import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import { scanLocalSessions } from "../server/scanner.ts";

test("scanFileTree sorts candidate files by mtimeMs descending before slicing to MAX_FILES_PER_SOURCE", async (t) => {
  const remoteRoot = path.resolve(process.cwd(), "data", "remote");
  const testDir = path.join(remoteRoot, `test-slice-${process.pid}-${Date.now()}`);

  await fs.mkdir(testDir, { recursive: true });

  t.after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const totalFiles = 125;
  const newestCount = 5;

  // Create 125 rollout files.
  // We name them rollout-000.jsonl through rollout-124.jsonl.
  // If sorted alphabetically, rollout-120.jsonl to rollout-124.jsonl are at the end.
  // We'll set the mtime of rollout-120.jsonl to rollout-124.jsonl to a future date (newest).
  // The rest (rollout-000.jsonl to rollout-119.jsonl) will have an old mtime.
  const oldTime = new Date("2020-01-01T00:00:00Z");
  const newTime = new Date("2026-06-19T00:00:00Z");

  for (let i = 0; i < totalFiles; i++) {
    const filename = `rollout-${String(i).padStart(3, "0")}.jsonl`;
    const filePath = path.join(testDir, filename);
    await fs.writeFile(filePath, JSON.stringify({
      events: []
    }));

    const isNew = i >= (totalFiles - newestCount); // 120 to 124
    const mtime = isNew ? newTime : oldTime;
    await fs.utimes(filePath, mtime, mtime);
  }

  const descriptors = await scanLocalSessions();

  // Find descriptors that correspond to our test directory.
  const testDescriptors = descriptors.filter((d) => d.key.includes(testDir));

  // Since MAX_FILES_PER_SOURCE is 120, we should only see 120 descriptors.
  assert.equal(testDescriptors.length, 120);

  // The 5 newest files (120 to 124) MUST be present in the results.
  for (let i = totalFiles - newestCount; i < totalFiles; i++) {
    const filename = `rollout-${String(i).padStart(3, "0")}.jsonl`;
    const hasFile = testDescriptors.some((d) => d.key.endsWith(filename));
    assert.ok(hasFile, `Should include the newest file: ${filename}`);
  }

  // Some of the oldest files must have been sliced out.
  // Specifically, since rollout-000 to rollout-004 are the oldest and alphabetically first,
  // they should not be present.
  const excludedFiles = [];
  for (let i = 0; i < totalFiles - newestCount; i++) {
    const filename = `rollout-${String(i).padStart(3, "0")}.jsonl`;
    const hasFile = testDescriptors.some((d) => d.key.endsWith(filename));
    if (!hasFile) {
      excludedFiles.push(filename);
    }
  }
  assert.equal(excludedFiles.length, 5);
});
