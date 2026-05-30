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
    pinnedKeys: new Set<string>(),
    favoriteKeys: new Set<string>(),
    favoriteMetadata: new Map<string, { tags: string[]; notes: string }>(),
    onToggleOpen: () => {},
    onTogglePin: () => {},
    onTogglePinSession: () => {},
    onToggleFavoriteSession: () => {},
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

test("select-input blurs on second click (closing dropdown)", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select") as any;

  let blurred = false;
  select.blur = () => {
    blurred = true;
  };

  // First click (opens dropdown)
  select.dispatchEvent("click");
  assert.equal(blurred, false);

  // Second click (closes dropdown)
  select.dispatchEvent("click");
  assert.equal(blurred, true);
});

test("select-input blurs on Escape keydown", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select") as any;

  let blurred = false;
  select.blur = () => {
    blurred = true;
  };

  // Non-Escape keydown
  if (select.listeners?.["keydown"]) {
    for (const listener of select.listeners["keydown"]) {
      listener({ key: "Enter" });
    }
  }
  assert.equal(blurred, false);

  // Escape keydown
  if (select.listeners?.["keydown"]) {
    for (const listener of select.listeners["keydown"]) {
      listener({ key: "Escape" });
    }
  }
  assert.equal(blurred, true);
});

test("select-input blurs on change", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options) as any;
  const select = sidebar.querySelector("select") as any;

  let blurred = false;
  select.blur = () => {
    blurred = true;
  };

  select.dispatchEvent("change");
  assert.equal(blurred, true);
});

test("renderSidebar renders pinned/favorite row classes and custom tag pills", () => {
  const key = "file::/path/to/session.jsonl";
  const options = createSidebarOptions({
    pinnedKeys: new Set([key]),
    favoriteKeys: new Set([key]),
    favoriteMetadata: new Map([[key, { tags: ["auth", "bug"], notes: "Some notes" }]])
  });

  const sidebar = renderSidebar(options);
  const row = sidebar.querySelector(".session-row");
  assert.ok(row);
  assert.ok(row.classList.contains("pinned-row"));
  assert.ok(row.classList.contains("favorite-row"));

  // Check tag pills
  const pills = row.querySelectorAll(".tag-pill");
  assert.equal(pills.length, 2);
  assert.equal(pills[0].textContent, "auth");
  assert.equal(pills[1].textContent, "bug");

  // Check notes display
  const note = row.querySelector(".session-row-note");
  assert.ok(note);
  assert.ok(note.textContent?.includes("Some notes"));
});

test("clicking pin and favorite action buttons triggers appropriate callbacks", () => {
  let pinTriggered = false;
  let favTriggered = false;
  const key = "file::/path/to/session.jsonl";

  const options = createSidebarOptions({
    onTogglePinSession: (k) => {
      if (k === key) pinTriggered = true;
    },
    onToggleFavoriteSession: (k) => {
      if (k === key) favTriggered = true;
    }
  });

  const sidebar = renderSidebar(options);
  const pinBtn = sidebar.querySelector(".pin-btn") as HTMLButtonElement | null;
  const favBtn = sidebar.querySelector(".favorite-btn") as HTMLButtonElement | null;

  assert.ok(pinBtn);
  assert.ok(favBtn);

  pinBtn.dispatchEvent("click");
  favBtn.dispatchEvent("click");

  assert.equal(pinTriggered, true);
  assert.equal(favTriggered, true);
});

test("renderSidebar renders quick search chips when favorites exist", () => {
  const key = "file::/path/to/session.jsonl";
  const options = createSidebarOptions({
    favoriteKeys: new Set([key]),
    favoriteMetadata: new Map([[key, { tags: ["ui", "store"], notes: "" }]])
  });

  const sidebar = renderSidebar(options);
  const chipsContainer = sidebar.querySelector(".quick-chips-container") as any;
  assert.ok(chipsContainer);
  assert.equal(chipsContainer.classList.contains("hidden"), false);

  // Verify only Favorites button and the select dropdown are rendered
  const chipBtn = chipsContainer.querySelector(".chip-btn") as any;
  assert.ok(chipBtn);
  assert.ok(chipBtn.textContent?.includes("Favorites"));

  const selectDropdown = chipsContainer.querySelector("select") as any;
  assert.ok(selectDropdown);
  assert.equal(selectDropdown.className, "select-input tag-filter-select");

  // Verify select options: placeholder, store, ui (3 options total)
  const optionsList = selectDropdown.querySelectorAll("option");
  assert.equal(optionsList.length, 3);
  assert.equal(optionsList[0].textContent, "🏷️ Filter by Tag");
  assert.equal(optionsList[1].textContent, "#store (1)");
  assert.equal(optionsList[2].textContent, "#ui (1)");
});

