import test from "node:test";
import assert from "node:assert/strict";
import "./dom-mock.ts";
import { SessionStore, type StateScope } from "../src/store/sessionStore.ts";
import { ThreadAtlasApp } from "../src/ui/app.ts";
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

globalThis.matchMedia = globalThis.matchMedia || (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {}
} as MediaQueryList));

globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

(globalThis.document as any).documentElement = {
  dataset: {}
};

function createImportedBundle(): SessionBundle {
  return {
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
}

function createRenderedApp(store: SessionStore): HTMLElement {
  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);

  const mainMount = root.querySelector(".main-mount") as HTMLElement | null;
  assert.ok(mainMount);
  return mainMount;
}

function collectScopes(store: SessionStore): Array<StateScope | undefined> {
  const scopes: Array<StateScope | undefined> = [];
  store.subscribe((_state, scope) => {
    scopes.push(scope);
  });
  return scopes;
}

test("app shell composes shared control primitives", () => {
  const store = new SessionStore();
  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);

  const topbar = root.querySelector(".topbar");
  assert.ok(topbar);
  const topbarButtons = topbar.querySelectorAll(".button");
  assert.ok(topbarButtons.length >= 4);
  assert.equal(topbarButtons.every((button) => button.classList.contains("ui-button")), true);
  assert.equal(root.querySelector(".status-pill")?.classList.contains("ui-badge"), true);
  assert.equal(root.querySelectorAll(".theme-toggle-button").every((button) => button.classList.contains("ui-chip")), true);
});

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
  const bundle = createImportedBundle();
  const store = new SessionStore();
  store.importBundles([bundle]);
  const scopes = collectScopes(store);
  scopes.shift();

  await store.selectSession(bundle.key);

  assert.deepEqual(scopes, ["all", "all"]);
});

test("search updates keep the rendered main child", () => {
  const store = new SessionStore();
  store.importBundles([createImportedBundle()]);
  const mainMount = createRenderedApp(store);
  const mainChild = mainMount.firstElementChild;
  assert.ok(mainChild);

  store.setSearch("needle");

  assert.equal(mainMount.firstElementChild, mainChild);
});

test("search updates preserve copied status feedback until the latest status is restored", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async () => {}
      }
    },
    configurable: true,
    writable: true
  });

  const store = new SessionStore();
  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);

  const statusNode = root.querySelector(".status-pill") as HTMLElement | null;
  const mainMount = root.querySelector(".main-mount") as HTMLElement | null;
  assert.ok(statusNode);
  assert.ok(mainMount);
  const mainChild = mainMount.firstElementChild;
  assert.ok(mainChild);

  (statusNode as any).dispatchEvent("dblclick");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(statusNode.textContent, "Copied! ✓");
  assert.equal(statusNode.title, "Successfully copied to clipboard");
  assert.equal(statusNode.classList.contains("copied"), true);

  store.setSearch("needle");

  assert.equal(statusNode.textContent, "Copied! ✓");
  assert.equal(statusNode.title, "Successfully copied to clipboard");
  assert.equal(statusNode.classList.contains("copied"), true);
  assert.equal(mainMount.firstElementChild, mainChild);

  store.importBundles([]);
  const latestStatus = store.getState().status;
  assert.notEqual(latestStatus, "Ready.");
  assert.equal(statusNode.textContent, "Copied! ✓");
  assert.equal(statusNode.title, "Successfully copied to clipboard");
  assert.equal(statusNode.classList.contains("copied"), true);

  await new Promise((resolve) => setTimeout(resolve, 1250));

  assert.equal(statusNode.textContent, latestStatus);
  assert.equal(statusNode.title, latestStatus);
  assert.equal(statusNode.classList.contains("copied"), false);
});

test("session selection replaces the rendered main child", async () => {
  const bundle = createImportedBundle();
  const store = new SessionStore();
  store.importBundles([bundle]);
  const mainMount = createRenderedApp(store);
  const mainChild = mainMount.firstElementChild;
  assert.ok(mainChild);

  await store.selectSession(bundle.key);

  assert.notEqual(mainMount.firstElementChild, mainChild);
});
