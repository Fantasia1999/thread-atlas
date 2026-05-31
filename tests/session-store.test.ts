import test from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/store/sessionStore.ts";

// Setup a mock localStorage for tests
const localStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => localStore[key] || null,
  setItem: (key: string, value: string) => {
    localStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete localStore[key];
  },
  clear: () => {
    for (const key of Object.keys(localStore)) {
      delete localStore[key];
    }
  },
  get length() {
    return Object.keys(localStore).length;
  },
  key: (index: number) => Object.keys(localStore)[index] || null
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true
});

test("SessionStore reads and writes sourceFilter from/to localStorage", () => {
  // 1. Write initial filter to localStorage
  mockLocalStorage.setItem("thread-atlas-source-filter", "claude");

  // 2. Instantiate SessionStore and check if it reads the filter
  const store = new SessionStore();
  assert.equal(store.getState().sourceFilter, "claude");

  // 3. Update the source filter and check if it writes to localStorage
  store.setSourceFilter("gemini");
  assert.equal(store.getState().sourceFilter, "gemini");
  assert.equal(mockLocalStorage.getItem("thread-atlas-source-filter"), "gemini");

  // 4. Test invalid filter fallback
  mockLocalStorage.setItem("thread-atlas-source-filter", "invalid-source");
  const storeWithFallback = new SessionStore();
  assert.equal(storeWithFallback.getState().sourceFilter, "all");
});

test("SessionStore supports session pinning, bookmarking and smart metadata updates", () => {
  mockLocalStorage.clear();
  const store = new SessionStore();

  const key1 = "file::/session1.jsonl";
  const key2 = "file::/session2.jsonl";

  // 1. Toggle Pin
  assert.equal(store.getState().pinnedKeys.has(key1), false);
  store.togglePin(key1);
  assert.equal(store.getState().pinnedKeys.has(key1), true);
  assert.ok(mockLocalStorage.getItem("thread-atlas-pinned-sessions")?.includes(key1));

  store.togglePin(key1);
  assert.equal(store.getState().pinnedKeys.has(key1), false);

  // 2. Toggle Favorite
  assert.equal(store.getState().favoriteKeys.has(key2), false);
  store.toggleFavorite(key2);
  assert.equal(store.getState().favoriteKeys.has(key2), true);
  assert.ok(mockLocalStorage.getItem("thread-atlas-favorite-sessions")?.includes(key2));

  // 3. Update Favorite Metadata
  store.updateFavoriteMetadata(key2, { tags: ["bugfix", "react"], notes: "Fixed auth bug" });
  const meta = store.getState().favoriteMetadata.get(key2);
  assert.ok(meta);
  assert.equal(meta.notes, "Fixed auth bug");
  assert.deepEqual(meta.tags, ["bugfix", "react"]);
  assert.ok(mockLocalStorage.getItem("thread-atlas-favorite-metadata")?.includes("Fixed auth bug"));
});

test("SessionStore getVisibleDescriptors returns pinned items first and supports smart filtering", () => {
  mockLocalStorage.clear();
  const store = new SessionStore() as any;

  // Pre-populate descriptors directly in state for testing getVisibleDescriptors
  const descriptors = [
    {
      key: "file::/s1.jsonl",
      source: "claude",
      title: "React Auth Bug",
      primaryPath: "/s1.jsonl",
      mtimeMs: 1000,
      metadata: {}
    },
    {
      key: "file::/s2.jsonl",
      source: "gemini",
      title: "Antigravity Refactor",
      primaryPath: "/s2.jsonl",
      mtimeMs: 2000,
      metadata: {}
    },
    {
      key: "file::/s3.jsonl",
      source: "claude",
      title: "Webpack Setup",
      primaryPath: "/s3.jsonl",
      mtimeMs: 3000,
      metadata: {}
    }
  ];

  store.state.descriptors = descriptors;
  store.state.favoriteKeys = new Set(["file::/s1.jsonl", "file::/s2.jsonl"]);
  store.state.favoriteMetadata = new Map([
    ["file::/s1.jsonl", { tags: ["bug", "auth"], notes: "Important fix" }],
    ["file::/s2.jsonl", { tags: ["refactor"], notes: "Performance boost" }]
  ]);

  // 1. Regular sorting is chronological by mtimeMs descending (s3 -> s2 -> s1)
  let visible = store.getVisibleDescriptors();
  assert.equal(visible[0].key, "file::/s3.jsonl");
  assert.equal(visible[1].key, "file::/s2.jsonl");
  assert.equal(visible[2].key, "file::/s1.jsonl");

  // 2. Pin s1, it should move to the top despite having lower mtimeMs (s1 -> s3 -> s2)
  store.state.pinnedKeys = new Set(["file::/s1.jsonl"]);
  visible = store.getVisibleDescriptors();
  assert.equal(visible[0].key, "file::/s1.jsonl");
  assert.equal(visible[1].key, "file::/s3.jsonl");
  assert.equal(visible[2].key, "file::/s2.jsonl");

  // 3. Search "is:starred" to retrieve only favorited sessions (s1 -> s2)
  store.setSearch("is:starred");
  visible = store.getVisibleDescriptors();
  assert.equal(visible.length, 2);
  assert.equal(visible[0].key, "file::/s1.jsonl"); // pinned
  assert.equal(visible[1].key, "file::/s2.jsonl");

  // 4. Search "#refactor" tag (s2)
  store.setSearch("#refactor");
  visible = store.getVisibleDescriptors();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].key, "file::/s2.jsonl");

  // 5. Search notes content "boost" (s2)
  store.setSearch("boost");
  visible = store.getVisibleDescriptors();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].key, "file::/s2.jsonl");
});

test("SessionStore aggregates sessions across local and remote connections", async () => {
  mockLocalStorage.clear();

  const { ConnectionManager } = await import("../src/store/connection.ts");
  const connection = new ConnectionManager();
  connection.upsertRemote({
    id: "abc123",
    label: "build-box",
    host: "10.0.0.5",
    username: "dev"
  });

  const calls: string[] = [];
  (connection as any).fetch = async (input: string): Promise<Response> => {
    calls.push(input);
    let files: any[] = [];
    if (input.startsWith("/api/local/scan")) {
      files = [
        {
          key: "file::/local/a.jsonl",
          source: "claude",
          title: "Local Session",
          primaryPath: "/local/a.jsonl",
          mtimeMs: 1000,
          metadata: {}
        }
      ];
    } else if (input.startsWith("/api/remote/abc123/scan")) {
      files = [
        {
          key: "file::/remote/b.jsonl",
          source: "codex",
          title: "Remote Session",
          primaryPath: "/remote/b.jsonl",
          mtimeMs: 2000,
          metadata: {}
        }
      ];
    }
    return { ok: true, json: async () => ({ ok: true, files }) } as unknown as Response;
  };

  const store = new (SessionStore as any)(connection);
  await store.refreshLocalScan();

  const descriptors = store.getState().descriptors as any[];
  assert.equal(descriptors.length, 2);

  const local = descriptors.find((d) => d.key === "file::/local/a.jsonl");
  assert.ok(local);
  assert.equal(local.connectionLabel, "Local");
  assert.notEqual(local.origin, "remote");

  const remote = descriptors.find((d) => d.key === "remote:abc123::file::/remote/b.jsonl");
  assert.ok(remote, "remote descriptor key should be namespaced");
  assert.equal(remote.origin, "remote");
  assert.equal(remote.connectionLabel, "build-box");

  assert.ok(calls.some((c) => c.startsWith("/api/local/scan")));
  assert.ok(calls.some((c) => c.startsWith("/api/remote/abc123/scan")));
});

test("SessionStore tolerates a failing connection during aggregation", async () => {
  mockLocalStorage.clear();

  const { ConnectionManager } = await import("../src/store/connection.ts");
  const connection = new ConnectionManager();
  connection.upsertRemote({
    id: "dead1",
    label: "offline-box",
    host: "10.0.0.9",
    username: "dev"
  });

  (connection as any).fetch = async (input: string): Promise<Response> => {
    if (input.startsWith("/api/remote/dead1/scan")) {
      throw new Error("network down");
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        files: [
          {
            key: "file::/local/ok.jsonl",
            source: "claude",
            title: "Local OK",
            primaryPath: "/local/ok.jsonl",
            mtimeMs: 1,
            metadata: {}
          }
        ]
      })
    } as unknown as Response;
  };

  const store = new (SessionStore as any)(connection);
  await store.refreshLocalScan();

  const descriptors = store.getState().descriptors as any[];
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].key, "file::/local/ok.jsonl");
});
