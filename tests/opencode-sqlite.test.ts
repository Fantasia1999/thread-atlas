import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadLocalSessionBundle, scanLocalSessions } from "../server/scanner.ts";

test("OpenCode SQLite sessions are discovered and loaded from the remote mirror", async (t) => {
  const fixtureRoot = path.join(
    process.cwd(),
    "data",
    "remote",
    `opencode-test-${process.pid}-${Date.now()}`
  );
  const dbPath = path.join(
    fixtureRoot,
    "alice@host",
    "home",
    "alice",
    ".local",
    "share",
    "opencode",
    "opencode.db"
  );

  await mkdir(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  t.after(async () => {
    database.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  database.exec(`
    create table session (
      id text primary key,
      title text,
      directory text,
      time_created integer,
      time_updated integer
    );
    create table message (
      id text primary key,
      session_id text,
      time_created integer,
      time_updated integer,
      data text
    );
    create table part (
      id text primary key,
      message_id text,
      session_id text,
      time_created integer,
      time_updated integer,
      data text
    );
  `);

  database
    .prepare(
      "insert into session (id, title, directory, time_created, time_updated) values (?, ?, ?, ?, ?);"
    )
    .run("session-1", "Demo OpenCode Session", "/repo/thread-atlas", 1000, 2000);
  database
    .prepare(
      "insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?);"
    )
    .run(
      "message-1",
      "session-1",
      1100,
      1200,
      JSON.stringify({
        role: "user",
        text: "hello from sqlite",
        time: { created: 1100 }
      })
    );
  database
    .prepare(
      "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?);"
    )
    .run(
      "part-1",
      "message-1",
      "session-1",
      1150,
      1160,
      JSON.stringify({
        type: "text",
        text: "hello from sqlite"
      })
    );

  const descriptors = await scanLocalSessions();
  const descriptor = descriptors.find(
    (entry) => entry.key === `opencode-sqlite::${dbPath}::session-1`
  );

  assert.ok(descriptor);
  assert.equal(descriptor.source, "opencode");
  assert.equal(descriptor.origin, "remote");
  assert.equal(descriptor.title, "Demo OpenCode Session");

  const bundle = await loadLocalSessionBundle(descriptor.key);
  assert.equal(bundle.key, descriptor.key);
  assert.equal(bundle.files.length, 3);
  assert.match(bundle.files[0]?.content ?? "", /"id": "session-1"/);
  assert.match(bundle.files[1]?.content ?? "", /"message-1"/);
  assert.match(bundle.files[2]?.content ?? "", /"part-1"/);
});
