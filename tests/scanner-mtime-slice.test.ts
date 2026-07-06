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

test("scanFileTree recovers parent sessions that fall outside the MAX_FILES_PER_SOURCE slice limit", async (t) => {
  const remoteRoot = path.resolve(process.cwd(), "data", "remote");
  const testDir = path.join(remoteRoot, `test-parent-recovery-${process.pid}-${Date.now()}`);

  await fs.mkdir(testDir, { recursive: true });

  t.after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const parentUuid = "parent-uuid-12345";
  const subagentUuid = "subagent-uuid-67890";

  // 1. Create parent session with old mtime.
  const parentFilename = `rollout-2020-01-01T00-00-00-${parentUuid}.jsonl`;
  const parentPath = path.join(testDir, parentFilename);
  await fs.writeFile(parentPath, JSON.stringify({
    type: "session_meta",
    payload: {
      id: parentUuid,
      session_id: parentUuid
    }
  }));
  const oldTime = new Date("2020-01-01T00:00:00Z");
  await fs.utimes(parentPath, oldTime, oldTime);

  // 2. Create 120 dummy files with newer mtime.
  const newTime = new Date("2026-06-19T00:00:00Z");
  for (let i = 0; i < 120; i++) {
    const filename = `rollout-2026-06-19T00-00-00-dummy-${String(i).padStart(3, "0")}.jsonl`;
    const filePath = path.join(testDir, filename);
    await fs.writeFile(filePath, JSON.stringify({
      events: []
    }));
    await fs.utimes(filePath, newTime, newTime);
  }

  // 3. Create 1 subagent session with newer mtime and parent_thread_id referencing parentUuid.
  const subagentFilename = `rollout-2026-06-19T00-00-01-${subagentUuid}.jsonl`;
  const subagentPath = path.join(testDir, subagentFilename);
  await fs.writeFile(subagentPath, JSON.stringify({
    type: "session_meta",
    payload: {
      id: subagentUuid,
      session_id: subagentUuid,
      parent_thread_id: parentUuid
    }
  }));
  const subagentTime = new Date(newTime.getTime() + 10000);
  await fs.utimes(subagentPath, subagentTime, subagentTime);

  // Run scanner
  const descriptors = await scanLocalSessions();

  // Find descriptors that correspond to our test directory.
  const testDescriptors = descriptors.filter((d) => d.key.includes(testDir));

  // The parent session must be present, even though it has the oldest mtime
  // and there are 121 newer files (so it fell outside the slice limit of 120).
  const hasParent = testDescriptors.some((d) => d.key.endsWith(parentFilename));
  assert.ok(hasParent, "Parent session should be recovered and present in scan results");

  // The subagent session must also be present
  const hasSubagent = testDescriptors.some((d) => d.key.endsWith(subagentFilename));
  assert.ok(hasSubagent, "Subagent session should be present in scan results");
});

