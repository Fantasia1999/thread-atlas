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

async function createSelectedApp(): Promise<HTMLElement> {
  return (await createSelectedAppContext()).root;
}

async function createSelectedAppContext(): Promise<{
  root: HTMLElement;
  store: SessionStore;
  bundle: SessionBundle;
}> {
  const bundle = createImportedBundle();
  const store = new SessionStore();
  store.importBundles([bundle]);
  await store.selectSession(bundle.key);

  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);
  return { root, store, bundle };
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
  const secondBundle: SessionBundle = {
    ...createImportedBundle(),
    key: "import::second-session.jsonl",
    title: "Second imported session",
    primaryPath: "second-session.jsonl",
    files: [
      {
        path: "second-session.jsonl",
        content: '{"type":"user","message":{"role":"user","content":"Second"}}'
      }
    ]
  };
  const store = new SessionStore();
  store.importBundles([bundle, secondBundle]);
  const mainMount = createRenderedApp(store);
  const mainChild = mainMount.firstElementChild;
  assert.ok(mainChild);

  await store.selectSession(secondBundle.key);

  assert.notEqual(mainMount.firstElementChild, mainChild);
});

test("same-session metadata updates preserve messages and refresh the header", async () => {
  const { root, store, bundle } = await createSelectedAppContext();
  const messageList = root.querySelector(".chat-messages");
  assert.ok(messageList);

  store.togglePin(bundle.key);
  assert.equal(root.querySelector(".chat-messages"), messageList);
  const header = root.querySelector(".chat-header");
  const pinButton = header?.querySelector(".pin-btn");
  assert.equal(pinButton?.classList.contains("active"), true);
  assert.equal(pinButton?.getAttribute("title"), "Unpin from top");

  store.toggleFavorite(bundle.key);
  assert.equal(root.querySelector(".chat-messages"), messageList);
  const favoriteButton = root.querySelector(".chat-header")?.querySelector(".favorite-btn");
  assert.equal(favoriteButton?.classList.contains("active"), true);
  assert.equal(favoriteButton?.getAttribute("title"), "Remove from Favorites");

  store.updateFavoriteMetadata(bundle.key, {
    tags: ["stable"],
    notes: "Keep the message list mounted."
  });
  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.ok(root.querySelector(".header-bookmark-summary"));
});

test("same-session rescan preserves the rendered message list", async () => {
  const { root, store } = await createSelectedAppContext();
  const messageList = root.querySelector(".chat-messages");
  assert.ok(messageList);

  (store.getConnection() as any).fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, files: [] })
  });
  await store.refreshLocalScan();

  assert.equal(root.querySelector(".chat-messages"), messageList);
});

test("updated session content replaces the rendered message list", async () => {
  const { root, store, bundle } = await createSelectedAppContext();
  const messageList = root.querySelector(".chat-messages");
  assert.ok(messageList);

  const updatedBundle: SessionBundle = {
    ...bundle,
    files: [
      {
        path: bundle.primaryPath,
        content: '{"type":"user","message":{"role":"user","content":"Updated"}}'
      }
    ]
  };
  store.importBundles([updatedBundle]);

  assert.notEqual(root.querySelector(".chat-messages"), messageList);
});

test("message filter changes replace the rendered message list", async () => {
  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const filterButtons = root.querySelectorAll(".filter-chip") as HTMLElement[];
  assert.ok(messageList);
  assert.ok(filterButtons.length > 1);

  (filterButtons[1] as any).click();

  assert.notEqual(root.querySelector(".chat-messages"), messageList);
});

test("closing the timeline with Escape preserves the rendered message list", async () => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1000,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "false");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const timelineToggle = timelineDock?.querySelector(".rail-button") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(timelineDock);
  assert.ok(timelineToggle);

  (timelineToggle as any).click();
  assert.equal(timelineDock.classList.contains("open"), true);
  (document as any).dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault: () => {}
  });

  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(timelineDock.classList.contains("open"), false);
});

test("viewport width changes preserve the rendered message list", async (context) => {
  const originalAddEventListener = globalThis.addEventListener;
  let resizeListener: ((event: Event) => void) | undefined;
  (globalThis as any).addEventListener = (type: string, listener: (event: Event) => void) => {
    if (type === "resize") {
      resizeListener = listener;
    }
  };
  context.after(() => {
    (globalThis as any).addEventListener = originalAddEventListener;
  });

  Object.defineProperty(globalThis, "innerWidth", {
    value: 1000,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "true");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(timelineDock);
  assert.ok(resizeListener);

  globalThis.innerWidth = 1300;
  resizeListener({ type: "resize" } as Event);

  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(timelineDock.classList.contains("pinned"), true);
  assert.equal(timelineDock.classList.contains("open"), true);
});

test("timeline hover does not redraw the message list", async () => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1000,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "false");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const timelineToggle = timelineDock?.querySelector(".rail-button") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(timelineDock);
  assert.ok(timelineToggle);

  (timelineToggle as any).dispatchEvent("mouseenter");
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(timelineDock.classList.contains("open"), true);
  assert.equal(timelineToggle.getAttribute("title"), "Collapse timeline");

  (timelineDock as any).dispatchEvent("mouseleave");
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(timelineDock.classList.contains("open"), false);
  assert.equal(timelineToggle.getAttribute("title"), "Open timeline");
});

test("pinning the timeline does not redraw the message list", async () => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1300,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "false");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const pinButton = timelineDock?.querySelector(".panel-icon-button") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(timelineDock);
  assert.ok(pinButton);

  (pinButton as any).click();

  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(timelineDock.classList.contains("pinned"), true);
  assert.equal(timelineDock.classList.contains("open"), true);
  assert.equal(pinButton.classList.contains("active"), true);
  assert.equal(pinButton.getAttribute("title"), "Unpin timeline");
});
