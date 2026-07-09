import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import {
  buildCodexResumeCommand,
  buildAntigravityResumeCommand,
  buildClaudeResumeCommand,
  buildCopilotResumeCommand
} from "../src/ui/resumeCommands.ts";
import { createCopyResumeButton } from "../src/ui/chatView.ts";
import type { Session } from "../shared/types.ts";

test("buildCodexResumeCommand builds command for Codex sessions with sessionId", () => {
  const session: Session = {
    id: "session-123",
    source: "codex",
    title: "Codex Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      sessionId: "codex-session-abc"
    },
    rawFiles: []
  };

  const command = buildCodexResumeCommand(session);
  assert.equal(command, "codex resume codex-session-abc");
});

test("buildCodexResumeCommand returns null for non-Codex sessions", () => {
  const session: Session = {
    id: "session-123",
    source: "antigravity",
    title: "Antigravity Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      cascadeId: "019e0133"
    },
    rawFiles: []
  };

  const command = buildCodexResumeCommand(session);
  assert.equal(command, null);
});

test("buildAntigravityResumeCommand builds command for Antigravity sessions with cascadeId", () => {
  const session: Session = {
    id: "session-456",
    source: "antigravity",
    title: "Antigravity Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      cascadeId: "cd7d2767-7c09-4e74-8c2f-227efe147a35"
    },
    rawFiles: []
  };

  const command = buildAntigravityResumeCommand(session);
  assert.equal(command, "agy --conversation=cd7d2767-7c09-4e74-8c2f-227efe147a35");
});

test("buildAntigravityResumeCommand returns null for non-Antigravity sessions", () => {
  const session: Session = {
    id: "session-123",
    source: "codex",
    title: "Codex Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      sessionId: "codex-session-abc"
    },
    rawFiles: []
  };

  const command = buildAntigravityResumeCommand(session);
  assert.equal(command, null);
});

test("createCopyResumeButton sets correct class, title and aria-label", () => {
  const command = "agy --conversation=cd7d2767-7c09-4e74-8c2f-227efe147a35";
  const label = "Copy Antigravity resume command";
  const button = createCopyResumeButton(command, label) as any;

  assert.equal(button.tagName, "button");
  assert.equal(button.className, "button secondary copy-command-button icon-button");
  assert.equal(button.title, command);
  assert.equal(button.attributes?.["aria-label"] || (button as any).getAttribute?.("aria-label"), label);
});

test("createCopyResumeButton copies to clipboard on click", async () => {
  const command = "agy --conversation=cd7d2767-7c09-4e74-8c2f-227efe147a35";
  const label = "Copy Antigravity resume command";
  const button = createCopyResumeButton(command, label) as any;

  let copiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copiedText = text;
        }
      }
    },
    configurable: true,
    writable: true
  });

  button.dispatchEvent("click");

  // Wait a small amount of time for any async clipboard action to take place
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(copiedText, command);
});

test("buildClaudeResumeCommand builds command for Claude sessions with primaryPath", () => {
  const session: Session = {
    id: "session-789",
    source: "claude",
    title: "Claude Session",
    summary: "",
    primaryPath: "/home/user/.claude/projects/cd7d2767-7c09-4e74-8c2f-227efe147a35.jsonl",
    messageCount: 0,
    messages: [],
    metadata: {},
    rawFiles: []
  };

  const command = buildClaudeResumeCommand(session);
  assert.equal(command, "claude --resume cd7d2767-7c09-4e74-8c2f-227efe147a35");
});

test("buildClaudeResumeCommand returns null for non-Claude sessions", () => {
  const session: Session = {
    id: "session-123",
    source: "antigravity",
    title: "Antigravity Session",
    summary: "",
    primaryPath: "/home/user/.gemini/antigravity/conversations/abc.pb",
    messageCount: 0,
    messages: [],
    metadata: {
      cascadeId: "abc"
    },
    rawFiles: []
  };

  const command = buildClaudeResumeCommand(session);
  assert.equal(command, null);
});

test("buildCopilotResumeCommand builds command for Copilot sessions with sessionId", () => {
  const session: Session = {
    id: "session-abc",
    source: "copilot",
    title: "Copilot Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      sessionId: "0cb916db-26aa-40f2-86b5-1ba81b225fd2"
    },
    rawFiles: []
  };

  const command = buildCopilotResumeCommand(session);
  assert.equal(command, "copilot --session-id=0cb916db-26aa-40f2-86b5-1ba81b225fd2");
});

test("buildCopilotResumeCommand returns null for non-Copilot sessions", () => {
  const session: Session = {
    id: "session-123",
    source: "antigravity",
    title: "Antigravity Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      cascadeId: "abc"
    },
    rawFiles: []
  };

  const command = buildCopilotResumeCommand(session);
  assert.equal(command, null);
});

test("buildCodexResumeCommand supports unsafe option", () => {
  const session: Session = {
    id: "session-123",
    source: "codex",
    title: "Codex Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      sessionId: "codex-session-abc"
    },
    rawFiles: []
  };

  const command = buildCodexResumeCommand(session, { unsafe: true });
  assert.equal(command, "codex resume codex-session-abc --yolo");
});

test("buildAntigravityResumeCommand supports unsafe option", () => {
  const session: Session = {
    id: "session-456",
    source: "antigravity",
    title: "Antigravity Session",
    summary: "",
    primaryPath: "/some/path",
    messageCount: 0,
    messages: [],
    metadata: {
      cascadeId: "cd7d2767-7c09-4e74-8c2f-227efe147a35"
    },
    rawFiles: []
  };

  const command = buildAntigravityResumeCommand(session, { unsafe: true });
  assert.equal(command, "agy --conversation=cd7d2767-7c09-4e74-8c2f-227efe147a35 --dangerously-skip-permissions");
});

test("buildClaudeResumeCommand supports unsafe option", () => {
  const session: Session = {
    id: "session-789",
    source: "claude",
    title: "Claude Session",
    summary: "",
    primaryPath: "/home/user/.claude/projects/cd7d2767-7c09-4e74-8c2f-227efe147a35.jsonl",
    messageCount: 0,
    messages: [],
    metadata: {},
    rawFiles: []
  };

  const command = buildClaudeResumeCommand(session, { unsafe: true });
  assert.equal(command, "claude --resume cd7d2767-7c09-4e74-8c2f-227efe147a35 --dangerously-skip-permissions");
});

test("createCopyResumeButton supports dynamic command function", async () => {
  let flag = false;
  const getCommand = () => `test-command${flag ? " --flag" : ""}`;
  const button = createCopyResumeButton(getCommand, "Test Copy") as any;

  assert.equal(button.title, "test-command");

  flag = true;
  button.title = getCommand();
  assert.equal(button.title, "test-command --flag");

  let copiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copiedText = text;
        }
      }
    },
    configurable: true,
    writable: true
  });

  button.dispatchEvent("click");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(copiedText, "test-command --flag");
});

test("createCopyResumeButton renders simple button when single option is passed", async () => {
  const options = [{ label: "Default", command: "copilot --session-id=123" }];
  const container = createCopyResumeButton(options, "Resume");

  assert.equal(container.tagName, "button");
  assert.equal(container.className, "button secondary copy-command-button");
  assert.equal((container as HTMLButtonElement).title, "copilot --session-id=123");
  assert.ok(container.innerHTML.includes("Resume"));
});

test("createCopyResumeButton renders dropdown when multiple options are passed", async () => {
  const options = [
    { label: "Default", command: "codex resume 123" },
    { label: "Unsafe", command: "codex resume 123 --yolo" }
  ];
  const container = createCopyResumeButton(options, "Resume");

  assert.equal(container.tagName, "div");
  assert.equal(container.className, "custom-dropdown-container copy-command-dropdown-container");

  const trigger = container.querySelector(".custom-dropdown-trigger");
  assert.ok(trigger);
  assert.ok(trigger.innerHTML.includes("Resume"));

  const menu = container.querySelector(".custom-dropdown-menu");
  assert.ok(menu);

  const items = menu.querySelectorAll(".custom-dropdown-item");
  assert.equal(items.length, 2);
  assert.equal(items[0].textContent, "Default");
  assert.equal(items[0].title, "codex resume 123");
  assert.equal(items[1].textContent, "Unsafe");
  assert.equal(items[1].title, "codex resume 123 --yolo");
});

