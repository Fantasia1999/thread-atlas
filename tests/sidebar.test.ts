import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { renderSidebar } from "../src/ui/sidebar.ts";
import type { SessionDescriptor } from "../src/parsers/types.ts";

function createSidebarOptions(overrides?: Partial<Parameters<typeof renderSidebar>[0]>) {
  return {
    descriptors: [
      {
        key: "file::/path/to/session.jsonl",
        source: "claude",
        title: "Session 1",
        primaryPath: "/path/to/session.jsonl",
        relatedPaths: [],
        transport: "local-scan" as const,
        origin: "local" as const,
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now(),
        metadata: {}
      }
    ] as SessionDescriptor[],
    selectedKey: undefined,
    sourceFilter: "all" as const,
    search: "",
    loading: false,
    pinned: false,
    open: true,
    onToggleOpen: () => {},
    onTogglePin: () => {},
    onSearch: () => {},
    onFilter: () => {},
    onSelect: () => {},
    ...overrides
  };
}

test("renderSidebar renders search input and filter dropdown", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options);

  const select = sidebar.querySelector("select");
  assert.ok(select);
  assert.equal(select.className, "select-input");

  const input = sidebar.querySelector("input");
  assert.ok(input);
  assert.equal(input.className, "text-input");
});

test("mouseleave closes unpinned sidebar when there is no active focus", async () => {
  let toggled = false;
  const options = createSidebarOptions({
    pinned: false,
    open: true,
    onToggleOpen: () => {
      toggled = true;
    }
  });

  const sidebar = renderSidebar(options) as any;
  sidebar.dispatchEvent("mouseleave");

  // Wait for the timeout (80ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(toggled, true);
});

test("mouseleave does NOT close sidebar if an element inside has active focus", async () => {
  let toggled = false;
  const options = createSidebarOptions({
    pinned: false,
    open: true,
    onToggleOpen: () => {
      toggled = true;
    }
  });

  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select");

  // Mock activeElement to be the select input inside the sidebar
  (globalThis.document as any).activeElement = select;

  sidebar.dispatchEvent("mouseleave");

  // Wait for the timeout (80ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(toggled, false);

  // Clear mock activeElement
  (globalThis.document as any).activeElement = undefined;
});

test("focusout closes sidebar when focus moves outside and mouse is not hovering", async () => {
  let toggled = false;
  const options = createSidebarOptions({
    pinned: false,
    open: true,
    onToggleOpen: () => {
      toggled = true;
    }
  });

  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select");

  // Mock focusout event where focus moves completely outside the container
  const focusoutEvent = {
    type: "focusout",
    relatedTarget: null
  };

  // Trigger focusout
  if (sidebar.listeners?.["focusout"]) {
    for (const listener of sidebar.listeners["focusout"]) {
      listener(focusoutEvent);
    }
  }

  // Wait for the timeout (80ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(toggled, true);
});

test("focusout does NOT close sidebar when focus moves to another element inside", async () => {
  let toggled = false;
  const options = createSidebarOptions({
    pinned: false,
    open: true,
    onToggleOpen: () => {
      toggled = true;
    }
  });

  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select");
  const input = sidebar.querySelector("input");

  // Mock focusout event where focus moves to the input inside the sidebar
  const focusoutEvent = {
    type: "focusout",
    relatedTarget: input
  };

  // Trigger focusout
  if (sidebar.listeners?.["focusout"]) {
    for (const listener of sidebar.listeners["focusout"]) {
      listener(focusoutEvent);
    }
  }

  // Wait for the timeout (80ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(toggled, false);
});
