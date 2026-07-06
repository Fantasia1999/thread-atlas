import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { parseCodexSession } from "../src/parsers/codex.ts";
import { renderChatView } from "../src/ui/chatView.ts";
import type { Session, SessionBundle, SessionDescriptor } from "../src/parsers/types.ts";

function buildCodexBundle(records: Array<Record<string, unknown>>): SessionBundle {
  return {
    key: "file::/tmp/rollout-2026-07-02.jsonl",
    source: "codex",
    title: "rollout-2026-07-02.jsonl",
    primaryPath: "/tmp/rollout-2026-07-02.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/rollout-2026-07-02.jsonl",
        content: records.map((record) => JSON.stringify(record)).join("\n")
      }
    ]
  };
}

test("parseCodexSession parses subagent notifications correctly", () => {
  const bundle = buildCodexBundle([
    {
      timestamp: "2026-07-02T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "parent-session-id",
        cwd: "/workspace/thread-atlas"
      }
    },
    {
      timestamp: "2026-07-02T12:01:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<subagent_notification>\n{\"agent_path\":\"subagent-session-id\",\"status\":{\"completed\":\"Inspected temp clone successfully.\\n\\nConclusion: Pos is parsed.\"}}\n</subagent_notification>"
          }
        ]
      }
    },
    {
      timestamp: "2026-07-02T12:02:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<subagent_notification>\n{\"agent_path\":\"subagent-2-id\",\"status\":\"shutdown\"}\n</subagent_notification>"
          }
        ]
      }
    }
  ]);

  const session = parseCodexSession(bundle);
  assert.equal(session.messages.length, 2);

  const msg1 = session.messages[0];
  assert.ok(msg1.subagentNotification);
  assert.equal(msg1.subagentNotification.agentPath, "subagent-session-id");
  assert.equal(msg1.subagentNotification.status, "completed");
  assert.equal(msg1.subagentNotification.content, "Inspected temp clone successfully.\n\nConclusion: Pos is parsed.");

  const msg2 = session.messages[1];
  assert.ok(msg2.subagentNotification);
  assert.equal(msg2.subagentNotification.agentPath, "subagent-2-id");
  assert.equal(msg2.subagentNotification.status, "shutdown");
  assert.equal(msg2.subagentNotification.content, undefined);
});

test("renders subagent notification card in ChatView", () => {
  const dateStr = new Date().toISOString();

  const descriptor: SessionDescriptor = {
    key: "parent-key",
    source: "codex",
    title: "Parent Session",
    primaryPath: "/tmp/parent.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 100,
    metadata: { sessionId: "parent-session-id" }
  };

  const session: Session = {
    id: "parent-session-id",
    source: "codex",
    title: "Parent Session",
    summary: "",
    primaryPath: "/tmp/parent.jsonl",
    messageCount: 2,
    messages: [
      {
        id: "msg-1",
        role: "user",
        text: "<subagent_notification>\n{\"agent_path\":\"subagent-session-id\",\"status\":{\"completed\":\"Inspected temp clone successfully.\"}}\n</subagent_notification>",
        createdAt: dateStr,
        subagentNotification: {
          agentPath: "subagent-session-id",
          status: "completed",
          content: "Inspected temp clone successfully."
        }
      }
    ],
    metadata: {},
    rawFiles: []
  };

  const container = renderChatView({
    descriptor,
    session,
    loading: false,
    messageFilter: "raw",
    timelinePinned: false,
    timelineOpen: false,
    pinnedKeys: new Set<string>(),
    favoriteKeys: new Set<string>(),
    favoriteMetadata: new Map(),
    onFilterChange: () => {},
    onTimelineToggleOpen: () => {},
    onTimelineTogglePin: () => {},
    onExport: () => {},
    onTogglePinSession: () => {},
    onToggleFavoriteSession: () => {},
    onUpdateMetadata: () => {}
  });

  const subagentEntry = container.querySelector(".subagent-notification-entry");
  assert.ok(subagentEntry, "Should render a subagent notification card");
  
  const statusPill = subagentEntry.querySelector(".completed");
  assert.ok(statusPill, "Should render completed status pill");
  assert.equal(statusPill.textContent, "completed");

  const sessionLink = subagentEntry.querySelector(".subagent-session-link") as HTMLAnchorElement;
  assert.ok(sessionLink, "Should render session link");
  assert.equal(sessionLink.getAttribute("href"), "session://subagent-session-id");

  const contentBox = subagentEntry.querySelector(".subagent-notification-content");
  assert.ok(contentBox, "Should render content box");
  assert.ok(contentBox.textContent?.includes("Inspected temp clone successfully."));
});

test("ThreadAtlasApp intercepts session:// clicks and switches session", async () => {
  globalThis.matchMedia = globalThis.matchMedia || (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  } as any));

  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

  (globalThis.document as any).documentElement = {
    dataset: {}
  };

  const root = document.createElement("div");

  const { SessionStore } = await import("../src/store/sessionStore.ts");
  const store = new SessionStore();

  // Populate store state with parent and subagent descriptors
  const parentDescriptor: SessionDescriptor = {
    key: "parent-key",
    source: "codex",
    title: "Parent Session",
    primaryPath: "/tmp/parent.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 100,
    metadata: { sessionId: "parent-session-id" }
  };

  const subagentDescriptor: SessionDescriptor = {
    key: "subagent-key",
    source: "codex",
    title: "Subagent Session",
    primaryPath: "/tmp/subagent.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 100,
    metadata: { sessionId: "subagent-session-id" }
  };

  store["state"].descriptors = [parentDescriptor, subagentDescriptor];
  store["state"].selectedKey = "parent-key";

  // Mock fetchBundle to return mock subagent bundle
  store["fetchBundle"] = async (key: string) => {
    return {
      key: "subagent-key",
      source: "codex",
      title: "Subagent Session",
      primaryPath: "/tmp/subagent.jsonl",
      relatedPaths: [],
      transport: "local-scan",
      origin: "local",
      fileCount: 1,
      size: 100,
      mtimeMs: 100,
      metadata: { sessionId: "subagent-session-id" },
      files: [{ path: "/tmp/subagent.jsonl", content: "{\"type\":\"session_meta\",\"payload\":{\"id\":\"subagent-session-id\"}}" }]
    };
  };

  const { ThreadAtlasApp } = await import("../src/ui/app.ts");
  const app = new ThreadAtlasApp(root, store);

  // Render app with current state
  app["render"](store.getState());

  // Create a link with session:// URL
  const link = document.createElement("a");
  link.className = "md-link subagent-session-link";
  link.setAttribute("href", "session://subagent-session-id");
  link.textContent = "View Session";
  root.append(link);

  // Dispatch click to root
  root.dispatchEvent("click", { target: link });

  // Verify selection changed
  assert.equal(store.getState().selectedKey, "subagent-key");

  // Wait for async selectSession and render lifecycle setTimeout to resolve completely
  await new Promise((resolve) => setTimeout(resolve, 100));
});

test("renders parent session backlink in session header when parentThreadId is present", () => {
  const descriptor: SessionDescriptor = {
    key: "subagent-key",
    source: "codex",
    title: "Subagent Session",
    primaryPath: "/tmp/subagent.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 100,
    metadata: { parentThreadId: "parent-session-id" }
  };

  const session: Session = {
    id: "subagent-key",
    source: "codex",
    title: "Subagent Session",
    summary: "",
    primaryPath: "/tmp/subagent.jsonl",
    messageCount: 0,
    messages: [],
    metadata: { parentThreadId: "parent-session-id" },
    rawFiles: []
  };

  const container = renderChatView({
    descriptor,
    session,
    loading: false,
    messageFilter: "raw",
    timelinePinned: false,
    timelineOpen: false,
    pinnedKeys: new Set<string>(),
    favoriteKeys: new Set<string>(),
    favoriteMetadata: new Map(),
    onFilterChange: () => {},
    onTimelineToggleOpen: () => {},
    onTimelineTogglePin: () => {},
    onExport: () => {},
    onTogglePinSession: () => {},
    onToggleFavoriteSession: () => {},
    onUpdateMetadata: () => {}
  });

  const backLink = container.querySelector(".parent-session-backlink") as HTMLAnchorElement;
  assert.ok(backLink, "Should render parent session backlink link");
  assert.equal(backLink.getAttribute("href"), "session://parent-session-id");
  assert.equal(backLink.textContent, "← Parent Session");
});

test("renders history Back link in session header when previousKeys is not empty", () => {
  const descriptor: SessionDescriptor = {
    key: "subagent-key",
    source: "codex",
    title: "Subagent Session",
    primaryPath: "/tmp/subagent.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 100,
    mtimeMs: 100,
    metadata: {}
  };

  const session: Session = {
    id: "subagent-key",
    source: "codex",
    title: "Subagent Session",
    summary: "",
    primaryPath: "/tmp/subagent.jsonl",
    messageCount: 0,
    messages: [],
    metadata: {},
    rawFiles: []
  };

  let goBackCalled = false;
  const container = renderChatView({
    descriptor,
    session,
    loading: false,
    messageFilter: "raw",
    timelinePinned: false,
    timelineOpen: false,
    pinnedKeys: new Set<string>(),
    favoriteKeys: new Set<string>(),
    favoriteMetadata: new Map(),
    onFilterChange: () => {},
    onTimelineToggleOpen: () => {},
    onTimelineTogglePin: () => {},
    onExport: () => {},
    onTogglePinSession: () => {},
    onToggleFavoriteSession: () => {},
    onUpdateMetadata: () => {},
    previousKeys: ["previous-session-key"],
    onGoBack: () => {
      goBackCalled = true;
    }
  });

  const backLink = container.querySelector(".history-back-link") as HTMLAnchorElement;
  assert.ok(backLink, "Should render history back link");
  assert.equal(backLink.textContent, "← Back");

  // Click back link
  backLink.dispatchEvent("click");
  assert.ok(goBackCalled, "onGoBack should be called");
});
