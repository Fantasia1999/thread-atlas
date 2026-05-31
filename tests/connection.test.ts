import test from "node:test";
import assert from "node:assert/strict";

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = String(value);
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  key: () => null,
  length: 0
};

const { ConnectionManager } = await import("../src/store/connection.ts");

function freshManager() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  return new ConnectionManager();
}

test("ConnectionManager defaults to the local agent", () => {
  const manager = freshManager();
  assert.equal(manager.getActive().mode, "local");
  assert.equal(manager.sessionApiBase(), "/api/local");
  assert.deepEqual(manager.authHeaders(), {});
});

test("ConnectionManager attaches a Bearer header when a token is set", () => {
  const manager = freshManager();
  manager.setToken("secret");
  assert.deepEqual(manager.authHeaders(), { Authorization: "Bearer secret" });
});

test("ConnectionManager switches to a registered remote agent", () => {
  const manager = freshManager();
  manager.upsertRemote({ id: "abc", label: "alice@host", host: "host", username: "alice" });
  manager.useRemote("abc");
  assert.equal(manager.getActive().mode, "remote");
  assert.equal(manager.sessionApiBase(), "/api/remote/abc");
  assert.equal(manager.getActiveLabel(), "alice@host");
});

test("ConnectionManager ignores switching to an unknown remote", () => {
  const manager = freshManager();
  manager.useRemote("missing");
  assert.equal(manager.getActive().mode, "local");
});

test("ConnectionManager falls back to local when the active remote is removed", () => {
  const manager = freshManager();
  manager.upsertRemote({ id: "abc", label: "alice@host", host: "host", username: "alice" });
  manager.useRemote("abc");
  manager.removeRemote("abc");
  assert.equal(manager.getActive().mode, "local");
  assert.equal(manager.sessionApiBase(), "/api/local");
});

test("ConnectionManager persists token and remotes across instances", () => {
  const manager = freshManager();
  manager.setToken("persisted");
  manager.upsertRemote({ id: "xyz", label: "bob@box", host: "box", username: "bob" });
  manager.useRemote("xyz");

  const restored = new ConnectionManager();
  assert.equal(restored.getToken(), "persisted");
  assert.equal(restored.getActive().mode, "remote");
  assert.equal(restored.getActive().remoteId, "xyz");
});

test("ConnectionManager saves, updates, and removes connection profiles", () => {
  const manager = freshManager();
  manager.upsertProfile({
    id: "p1",
    label: "bob@box",
    host: "box",
    port: 22,
    username: "bob",
    password: "secret",
    privateKey: "",
    passphrase: ""
  });
  assert.equal(manager.getProfiles().length, 1);
  assert.equal(manager.getProfiles()[0].password, "secret");

  manager.upsertProfile({
    id: "p1",
    label: "bob renamed",
    host: "box",
    port: 2222,
    username: "bob",
    password: "secret",
    privateKey: "",
    passphrase: ""
  });
  assert.equal(manager.getProfiles().length, 1);
  assert.equal(manager.getProfiles()[0].label, "bob renamed");
  assert.equal(manager.getProfiles()[0].port, 2222);

  manager.removeProfile("p1");
  assert.equal(manager.getProfiles().length, 0);
});

test("ConnectionManager restores saved profiles across instances", () => {
  const manager = freshManager();
  manager.upsertProfile({
    id: "p2",
    label: "alice@host",
    host: "host",
    port: 22,
    username: "alice",
    password: "",
    privateKey: "KEYDATA",
    passphrase: "pp"
  });

  const restored = new ConnectionManager();
  const profiles = restored.getProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].privateKey, "KEYDATA");
  assert.equal(profiles[0].passphrase, "pp");
});

test("reconcileRemotes drops remotes whose backend agent is no longer live", async () => {
  const manager = freshManager();
  manager.upsertRemote({ id: "live1", label: "A", host: "h1", username: "u1" });
  manager.upsertRemote({ id: "dead1", label: "B", host: "h2", username: "u2" });
  manager.useRemote("dead1");

  (manager as unknown as { fetch: unknown }).fetch = async () =>
    ({ ok: true, json: async () => ({ ok: true, agents: [{ id: "live1" }] }) }) as unknown as Response;

  await manager.reconcileRemotes();

  const ids = manager.getRemotes().map((r) => r.id);
  assert.deepEqual(ids, ["live1"]);
  // Active pointed at a now-dead remote, so it should fall back to local.
  assert.equal(manager.getActive().mode, "local");
});

test("reconcileRemotes keeps remotes when the backend list cannot be fetched", async () => {
  const manager = freshManager();
  manager.upsertRemote({ id: "keep1", label: "A", host: "h1", username: "u1" });

  (manager as unknown as { fetch: unknown }).fetch = async () => {
    throw new Error("network down");
  };

  await manager.reconcileRemotes();
  assert.deepEqual(manager.getRemotes().map((r) => r.id), ["keep1"]);
});
