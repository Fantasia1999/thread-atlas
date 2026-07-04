import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { renderChatView } from "../src/ui/chatView.ts";
import type { Session, SessionDescriptor } from "../src/parsers/types.ts";

test("scroll to bottom button behavior", () => {
  const dateStr = new Date().toISOString();
  
  const descriptor: SessionDescriptor = {
    id: "session-1",
    source: "codex",
    title: "Test Session",
    summary: "",
    primaryPath: "/path/to/session",
    messageCount: 2,
    createdAt: Date.now()
  };

  const session: Session = {
    id: "session-1",
    source: "codex",
    title: "Test Session",
    summary: "",
    primaryPath: "/path/to/session",
    messageCount: 2,
    messages: [
      { id: "msg-1", role: "user", text: "Hello", createdAt: dateStr },
      { id: "msg-2", role: "assistant", text: "World", createdAt: dateStr }
    ],
    metadata: {},
    rawFiles: []
  };

  const options = {
    descriptor,
    session,
    loading: false,
    messageFilter: "pure" as const,
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
  };

  const container = renderChatView(options);
  const messageList = container.querySelector(".chat-messages") as any;
  const btnBottom = container.querySelector(".scroll-btn-bottom") as any;

  assert.ok(messageList, "messageList should exist");
  assert.ok(btnBottom, "btnBottom should exist");

  const lastMessage = messageList.lastElementChild as any;
  assert.ok(lastMessage, "lastMessage should exist");

  // Mock getBoundingClientRect
  messageList.getBoundingClientRect = () => ({
    top: 100,
    left: 0, bottom: 0, right: 0, width: 0, height: 0
  });

  lastMessage.getBoundingClientRect = () => ({
    top: 800,
    left: 0, bottom: 0, right: 0, width: 0, height: 0
  });

  // Setup spy variables
  let scrollIntoViewCalled = false;
  let scrollIntoViewOptions: any = null;
  lastMessage.scrollIntoView = (opt: any) => {
    scrollIntoViewCalled = true;
    scrollIntoViewOptions = opt;
  };

  let scrollToCalled = false;
  let scrollToOptions: any = null;
  messageList.scrollTo = (opt: any) => {
    scrollToCalled = true;
    scrollToOptions = opt;
  };

  // 1. Initial State: scrollTop = 0. Target is 700 - 20 = 680.
  // 0 < 680 - 5, so we should call scrollIntoView on lastMessage.
  messageList.scrollTop = 0;
  messageList.scrollHeight = 1000;
  messageList.clientHeight = 500;

  btnBottom.click();

  assert.equal(scrollIntoViewCalled, true, "scrollIntoView should be called when not on last message");
  assert.deepEqual(scrollIntoViewOptions, { behavior: "smooth", block: "start" });
  assert.equal(scrollToCalled, false, "scrollTo should not be called when not on last message");

  // Reset spy status
  scrollIntoViewCalled = false;
  scrollIntoViewOptions = null;
  scrollToCalled = false;
  scrollToOptions = null;

  // 2. Already on last message: scrollTop = 685. Target is 685 + (115 - 100) - 20 = 680.
  // 685 >= 680 - 5, so we should call scrollTo on messageList to scroll to the very bottom.
  messageList.scrollTop = 685;
  lastMessage.getBoundingClientRect = () => ({
    top: 115,
    left: 0, bottom: 0, right: 0, width: 0, height: 0
  });

  btnBottom.click();

  assert.equal(scrollIntoViewCalled, false, "scrollIntoView should not be called when already on last message");
  assert.equal(scrollToCalled, true, "scrollTo should be called when already on last message");
  assert.deepEqual(scrollToOptions, { top: 1000, behavior: "smooth" });
});

test("renderChatView parses and renders oai-mem-citation as collapsible block", () => {
  const dateStr = "2026-07-02T10:48:32.019Z";
  const descriptor = {
    id: "session-1",
    source: "codex" as const,
    title: "Session 1",
    cwd: "/workspace",
    updatedAt: dateStr,
    messageCount: 1
  };
  const session = {
    id: "session-1",
    source: "codex" as const,
    title: "Session 1",
    cwd: "/workspace",
    startedAt: dateStr,
    updatedAt: dateStr,
    messageCount: 1,
    messages: [
      {
        id: "msg-1",
        role: "assistant" as const,
        text: "hello world\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:35-39|note=[confirmed snapshot]\n</citation_entries>\n<rollout_ids>\nuuid-123\n</rollout_ids>\n</oai-mem-citation>",
        createdAt: dateStr
      }
    ],
    metadata: {},
    rawFiles: []
  };

  const options = {
    descriptor,
    session,
    loading: false,
    messageFilter: "raw" as const,
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
  };

  const container = renderChatView(options);
  const citationBlock = container.querySelector(".citation-block");
  assert.ok(citationBlock, "citation-block should exist");

  const titleNode = citationBlock.querySelector(".citation-title");
  assert.ok(titleNode);
  assert.equal(titleNode.textContent, "Memory Citations (1)");

  const fileNode = citationBlock.querySelector(".citation-file");
  assert.ok(fileNode);
  assert.equal(fileNode.textContent, "MEMORY.md:35-39");
  assert.equal(fileNode.getAttribute("href"), "file://~/.codex/memories/MEMORY.md#L35");

  const noteNode = citationBlock.querySelector(".citation-note");
  assert.ok(noteNode);
  assert.equal(noteNode.textContent, "confirmed snapshot");

  const rolloutsDiv = citationBlock.querySelector(".citation-rollouts");
  assert.ok(rolloutsDiv);
  const codeNode = rolloutsDiv.querySelector("code");
  assert.ok(codeNode);
  assert.equal(codeNode.textContent, "uuid-123");

  // Check that the tag itself is stripped from the main content body
  const bodyText = container.querySelector(".log-content")?.textContent || "";
  assert.ok(!bodyText.includes("<oai-mem-citation>"), "Should strip tag from main body");
  assert.ok(bodyText.includes("hello world"), "Should render main markdown text");
});

test("renderChatView groups consecutive commentary messages in pure mode", () => {
  const dateStr = "2026-07-04T12:00:00Z";
  const descriptor = {
    id: "session-2",
    source: "codex" as const,
    title: "Session 2",
    cwd: "/workspace",
    updatedAt: dateStr,
    messageCount: 4
  };
  const session = {
    id: "session-2",
    source: "codex" as const,
    title: "Session 2",
    cwd: "/workspace",
    startedAt: dateStr,
    updatedAt: dateStr,
    messageCount: 4,
    messages: [
      {
        id: "msg-1",
        role: "user" as const,
        text: "first user request",
        createdAt: dateStr
      },
      {
        id: "msg-2",
        role: "assistant" as const,
        text: "thinking step 1",
        createdAt: dateStr
      },
      {
        id: "msg-3",
        role: "assistant" as const,
        text: "thinking step 2",
        createdAt: dateStr
      },
      {
        id: "msg-4",
        role: "assistant" as const,
        text: "final reply",
        createdAt: dateStr
      }
    ],
    metadata: {},
    rawFiles: []
  };

  const options = {
    descriptor,
    session,
    loading: false,
    messageFilter: "pure" as const,
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
  };

  const container = renderChatView(options);

  const group = container.querySelector(".collapsed-commentary-group");
  assert.ok(group, "Should render a commentary group container");

  const label = group.querySelector(".commentary-label");
  assert.ok(label);
  assert.equal(label.textContent, "Thinking / Commentary (2 steps)");

  const innerItems = group.querySelectorAll(".commentary-group-inner-item");
  assert.equal(innerItems.length, 2, "Should render 2 inner thinking items");

  assert.ok(innerItems[0].textContent.includes("thinking step 1"));
  assert.ok(innerItems[1].textContent.includes("thinking step 2"));

  const logEntries = container.querySelectorAll(".log-entry");
  const finalReplyNode = logEntries.find(
    (el: any) => el.getAttribute("data-message-anchor") === "message-msg-4"
  );
  assert.ok(finalReplyNode);
  assert.ok(!finalReplyNode.classList.contains("commentary-group-inner-item"));
  assert.ok(finalReplyNode.textContent.includes("final reply"));
});
