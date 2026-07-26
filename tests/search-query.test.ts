import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { descriptorMatchesSearch, parseSearchQuery } from "../src/store/searchQuery.ts";
import { SessionStore } from "../src/store/sessionStore.ts";
import type { SessionDescriptor } from "../shared/types.ts";

function makeDescriptor(overrides: Partial<SessionDescriptor>): SessionDescriptor {
  return {
    key: "file::/s.jsonl",
    source: "claude",
    title: "Session",
    primaryPath: "/s.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 1000,
    metadata: {},
    ...overrides
  } as SessionDescriptor;
}

const emptyContext = { workspacePath: "", isFavorite: false, meta: undefined };

test("parseSearchQuery tokenizes terms, negations, tags, and field filters", () => {
  const query = parseSearchQuery("Auth -webpack #bug is:starred source:codex path:/proj title:fix project:atlas after:2026-01-01 before:2026-02-01");
  assert.deepEqual(query.terms, ["auth"]);
  assert.deepEqual(query.negatedTerms, ["webpack"]);
  assert.deepEqual(query.tags, ["bug"]);
  assert.equal(query.showOnlyStarred, true);
  assert.deepEqual(query.sourceTerms, ["codex"]);
  assert.deepEqual(query.pathTerms, ["/proj"]);
  assert.deepEqual(query.titleTerms, ["fix"]);
  assert.deepEqual(query.projectTerms, ["atlas"]);
  assert.equal(query.afterMs, Date.parse("2026-01-01"));
  assert.equal(query.beforeMs, Date.parse("2026-02-01"));
});

test("parseSearchQuery treats unknown fields and bad dates tolerantly", () => {
  // Unknown field tokens degrade to plain terms so paths still search literally.
  const query = parseSearchQuery("c:/work/repo");
  assert.deepEqual(query.terms, ["c:/work/repo"]);

  // Unparseable dates are ignored instead of filtering everything out.
  const badDate = parseSearchQuery("before:soon");
  assert.equal(badDate.beforeMs, undefined);
  assert.deepEqual(badDate.terms, []);
});

test("descriptorMatchesSearch requires every term and rejects negated matches", () => {
  const descriptor = makeDescriptor({ title: "React Auth Bug", primaryPath: "/work/auth.jsonl" });

  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("react auth"), emptyContext), true);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("react webpack"), emptyContext), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("react -auth"), emptyContext), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("react -webpack"), emptyContext), true);
});

test("descriptorMatchesSearch supports field and date filters", () => {
  const descriptor = makeDescriptor({ source: "codex", mtimeMs: Date.parse("2026-01-15") });

  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("source:codex"), emptyContext), true);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("source:claude"), emptyContext), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("path:s.jsonl"), emptyContext), true);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("path:other"), emptyContext), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("after:2026-01-01 before:2026-02-01"), emptyContext), true);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("after:2026-02-01"), emptyContext), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("before:2026-01-01"), emptyContext), false);
});

test("descriptorMatchesSearch matches workspace paths via project filter and plain terms", () => {
  const descriptor = makeDescriptor({});
  const context = { workspacePath: "/workspace/thread-atlas", isFavorite: false, meta: undefined };

  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("project:thread-atlas"), context), true);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("workspace:other"), context), false);
  assert.equal(descriptorMatchesSearch(descriptor, parseSearchQuery("thread-atlas"), context), true);
});

test("SessionStore getVisibleDescriptors applies the enhanced query syntax", () => {
  (globalThis as any).localStorage.clear();
  const store = new SessionStore() as any;

  store.state.descriptors = [
    makeDescriptor({
      key: "file::/s1.jsonl",
      source: "claude",
      title: "React Auth Bug",
      primaryPath: "/s1.jsonl",
      mtimeMs: Date.parse("2026-01-10")
    }),
    makeDescriptor({
      key: "file::/s2.jsonl",
      source: "codex",
      title: "React Perf Sweep",
      primaryPath: "/s2.jsonl",
      mtimeMs: Date.parse("2026-03-10")
    }),
    makeDescriptor({
      key: "file::/s3.jsonl",
      source: "codex",
      title: "Webpack Setup",
      primaryPath: "/s3.jsonl",
      mtimeMs: Date.parse("2026-03-20")
    })
  ];

  // Multi-term AND across title
  store.setSearch("react perf");
  assert.deepEqual(store.getVisibleDescriptors().map((d: SessionDescriptor) => d.key), ["file::/s2.jsonl"]);

  // Negation
  store.setSearch("react -perf");
  assert.deepEqual(store.getVisibleDescriptors().map((d: SessionDescriptor) => d.key), ["file::/s1.jsonl"]);

  // Source filter combined with a term
  store.setSearch("source:codex react");
  assert.deepEqual(store.getVisibleDescriptors().map((d: SessionDescriptor) => d.key), ["file::/s2.jsonl"]);

  // Date window
  store.setSearch("after:2026-03-01 before:2026-03-15");
  assert.deepEqual(store.getVisibleDescriptors().map((d: SessionDescriptor) => d.key), ["file::/s2.jsonl"]);

  store.setSearch("");
  assert.equal(store.getVisibleDescriptors().length, 3);
});
