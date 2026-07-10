import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { renderMessage } from "../src/ui/messageRenderer.ts";
import type { Message } from "../shared/types.ts";

class MockClipboardItem {
  constructor(readonly data: Record<string, Blob>) {}
}

const copiedTexts: string[] = [];
const richWrites: MockClipboardItem[][] = [];

Object.defineProperty(globalThis, "ClipboardItem", {
  value: MockClipboardItem,
  configurable: true,
  writable: true
});

Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: {
      writeText: async (value: string) => {
        copiedTexts.push(value);
      },
      write: async (items: MockClipboardItem[]) => {
        richWrites.push(items);
      }
    }
  },
  configurable: true,
  writable: true
});

test.beforeEach(() => {
  copiedTexts.length = 0;
  richWrites.length = 0;
  delete (window as typeof window & { getSelection?: typeof window.getSelection }).getSelection;
  delete (document as Document & { createRange?: typeof document.createRange }).createRange;
  delete (document as Document & { execCommand?: typeof document.execCommand }).execCommand;
});

function renderCopyableMessage(overrides: Partial<Message> = {}): HTMLElement {
  return renderMessage({
    id: "message-1",
    role: "assistant",
    text: "# Heading\n\nThis is **bold**.",
    ...overrides
  }, {
    anchorId: "message-message-1",
    showToolBlocks: false
  });
}

test("each rendered message content has Markdown and rich-text copy actions", () => {
  const entry = renderCopyableMessage();
  const actions = entry.querySelector(".message-copy-actions");
  assert.ok(actions);

  const buttons = actions.querySelectorAll("button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute("aria-label"), "Copy Markdown source");
  assert.equal(buttons[1].getAttribute("aria-label"), "Copy rendered rich text");
  assert.equal(buttons.every((button) => button.classList.contains("ui-chip")), true);
});

test("Markdown copy writes the original source text", async () => {
  const source = "  # Heading\n\nThis is **bold**.  ";
  const entry = renderCopyableMessage({ text: source });
  const markdownButton = entry.querySelectorAll(".message-copy-button")[0];

  markdownButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(copiedTexts, [source]);
  assert.equal(richWrites.length, 0);
});

test("rich-text copy writes rendered HTML with a plain-text fallback", async () => {
  const entry = renderCopyableMessage();
  const richTextButton = entry.querySelectorAll(".message-copy-button")[1];

  richTextButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(copiedTexts.length, 0);
  assert.equal(richWrites.length, 1);
  assert.equal(richWrites[0].length, 1);

  const clipboardData = richWrites[0][0].data;
  const html = await clipboardData["text/html"].text();
  const plainText = await clipboardData["text/plain"].text();
  assert.match(html, /<h1[^>]*>Heading<\/h1>/);
  assert.match(html, /<strong[^>]*>bold<\/strong>/);
  assert.match(plainText, /Heading/);
  assert.match(plainText, /bold/);
});

test("rich-text copy uses the browser native selection path and restores the prior selection", async () => {
  const entry = renderCopyableMessage();
  const content = entry.querySelector(".log-content");
  const richTextButton = entry.querySelectorAll(".message-copy-button")[1];
  assert.ok(content);

  const restoredRange = { id: "restored" } as unknown as Range;
  const originalRange = {
    cloneRange: () => restoredRange
  } as unknown as Range;
  const copyRange = {
    selectedNode: undefined as HTMLElement | undefined,
    selectNodeContents(node: HTMLElement) {
      this.selectedNode = node;
    }
  } as unknown as Range & { selectedNode?: HTMLElement };
  let activeRanges: Range[] = [originalRange];
  let copyCommands = 0;

  const selection = {
    get rangeCount() {
      return activeRanges.length;
    },
    getRangeAt: (index: number) => activeRanges[index],
    removeAllRanges: () => {
      activeRanges = [];
    },
    addRange: (range: Range) => {
      activeRanges.push(range);
    }
  } as unknown as Selection;

  (window as typeof window & { getSelection: () => Selection }).getSelection = () => selection;
  (document as Document & { createRange: () => Range }).createRange = () => copyRange;
  (document as Document & { execCommand: (command: string) => boolean }).execCommand = (command) => {
    assert.equal(command, "copy");
    assert.deepEqual(activeRanges, [copyRange]);
    copyCommands += 1;
    return true;
  };

  richTextButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(copyCommands, 1);
  assert.equal(copyRange.selectedNode, content);
  assert.deepEqual(activeRanges, [restoredRange]);
  assert.equal(richWrites.length, 0);
  assert.equal(copiedTexts.length, 0);
});

test("subagent message content also renders both copy actions", () => {
  const entry = renderCopyableMessage({
    text: "",
    subagentNotification: {
      agentPath: "example-agent",
      status: "completed",
      content: "## Report\n\nDone."
    }
  });

  assert.equal(entry.querySelectorAll(".message-copy-button").length, 2);
});
