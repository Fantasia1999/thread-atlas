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
