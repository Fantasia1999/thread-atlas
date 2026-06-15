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
    messageFilter: "default" as const,
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
