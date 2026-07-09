import test from "node:test";
import assert from "node:assert/strict";
import { SessionStore, type StateScope } from "../src/store/sessionStore.ts";
import type { SessionBundle } from "../shared/types.ts";

const localStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => localStore[key] ?? null,
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
  key: (index: number) => Object.keys(localStore)[index] ?? null
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true
});

test.beforeEach(() => {
  mockLocalStorage.clear();
});

function collectScopes(store: SessionStore): Array<StateScope | undefined> {
  const scopes: Array<StateScope | undefined> = [];
  store.subscribe((_state, scope) => {
    scopes.push(scope);
  });
  return scopes;
}

test("SessionStore subscriptions start with an all notification", () => {
  const scopes = collectScopes(new SessionStore());

  assert.deepEqual(scopes, ["all"]);
});

test("SessionStore search changes notify the sidebar scope", () => {
  const store = new SessionStore();
  const scopes = collectScopes(store);
  scopes.shift();

  store.setSearch("parser");

  assert.deepEqual(scopes, ["sidebar"]);
});

test("SessionStore source filter changes notify the sidebar scope", () => {
  const store = new SessionStore();
  const scopes = collectScopes(store);
  scopes.shift();

  store.setSourceFilter("codex");

  assert.deepEqual(scopes, ["sidebar"]);
});

test("SessionStore pin changes notify all renderers", () => {
  const store = new SessionStore();
  const scopes = collectScopes(store);
  scopes.shift();

  store.togglePin("import::session.jsonl");

  assert.deepEqual(scopes, ["all"]);
});

test("SessionStore selection changes notify all renderers", async () => {
  const bundle: SessionBundle = {
    key: "import::session.jsonl",
    source: "claude",
    title: "Imported session",
    primaryPath: "session.jsonl",
    relatedPaths: [],
    transport: "browser-file",
    origin: "imported",
    fileCount: 1,
    size: 65,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "session.jsonl",
        content: '{"type":"user","message":{"role":"user","content":"Hello"}}'
      }
    ]
  };
  const store = new SessionStore();
  store.importBundles([bundle]);
  const scopes = collectScopes(store);
  scopes.shift();

  await store.selectSession(bundle.key);

  assert.deepEqual(scopes, ["all", "all"]);
});
