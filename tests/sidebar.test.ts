import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { renderSidebar } from "../src/ui/sidebar.ts";
import type { SessionDescriptor } from "../shared/types.ts";

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
    hiddenProjects: new Set<string>(),
    onToggleOpen: () => {},
    onTogglePin: () => {},
    onTogglePinSession: () => {},
    onToggleFavoriteSession: () => {},
    onSearch: () => {},
    onFilter: () => {},
    onSelect: () => {},
    onHideProject: () => {},
    onShowProject: () => {},
    onClearHiddenProjects: () => {},
    ...overrides
  };
}

test("renderSidebar renders search input and custom filter dropdown", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options);

  const customDropdown = sidebar.querySelector(".source-filter-dropdown") as any;
  assert.ok(customDropdown);

  const trigger = customDropdown.querySelector(".custom-dropdown-trigger") as any;
  assert.ok(trigger);
  assert.ok(trigger.innerHTML?.includes("All sources"));

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
  const input = sidebar.querySelector("input");

  // Mock activeElement to be the text input inside the sidebar
  (globalThis.document as any).activeElement = input;

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

test("custom-dropdown-container handles toggles and click expands", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options) as any;
  
  const customDropdown = sidebar.querySelector(".source-filter-dropdown") as any;
  const trigger = customDropdown.querySelector(".custom-dropdown-trigger") as any;
  const menu = customDropdown.querySelector(".custom-dropdown-menu") as any;

  assert.ok(trigger);
  assert.ok(menu);
  assert.ok(menu.classList.contains("hidden"));

  // 1. First click: expands dropdown menu
  trigger.dispatchEvent("click");
  assert.equal(menu.classList.contains("hidden"), false);
  assert.ok(trigger.classList.contains("open"));

  // 2. Second click: collapses dropdown menu
  trigger.dispatchEvent("click");
  assert.ok(menu.classList.contains("hidden"));
  assert.equal(trigger.classList.contains("open"), false);
});

test("custom-dropdown-item click triggers onChange callback and closes menu", () => {
  let selectedValue = "";
  const options = createSidebarOptions({
    onFilter: (val) => {
      selectedValue = val;
    }
  });

  const sidebar = renderSidebar(options) as any;
  const customDropdown = sidebar.querySelector(".source-filter-dropdown") as any;
  const trigger = customDropdown.querySelector(".custom-dropdown-trigger") as any;
  const menu = customDropdown.querySelector(".custom-dropdown-menu") as any;

  // Expand
  trigger.dispatchEvent("click");
  
  // Get item
  const items = menu.querySelectorAll(".custom-dropdown-item");
  assert.ok(items.length > 0);
  
  // Click item 'gemini'
  const targetItem = [...items].find(item => item.textContent === "Gemini");
  assert.ok(targetItem);
  
  targetItem.dispatchEvent("click");
  assert.equal(selectedValue, "gemini");
  assert.ok(menu.classList.contains("hidden"));
});

test("custom-dropdown-menu closes on global document clicks", () => {
  const options = createSidebarOptions();
  const sidebar = renderSidebar(options) as any;
  const customDropdown = sidebar.querySelector(".source-filter-dropdown") as any;
  const trigger = customDropdown.querySelector(".custom-dropdown-trigger") as any;
  const menu = customDropdown.querySelector(".custom-dropdown-menu") as any;

  // Expand
  trigger.dispatchEvent("click");
  assert.equal(menu.classList.contains("hidden"), false);

  // Global document click dismiss
  globalThis.document.dispatchEvent("click" as any);
  assert.ok(menu.classList.contains("hidden"));
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

  // Verify only Favorites button and the custom tag select dropdown are rendered
  const chipBtn = chipsContainer.querySelector(".chip-btn") as any;
  assert.ok(chipBtn);
  assert.ok(chipBtn.textContent?.includes("Favorites"));

  const customDropdown = chipsContainer.querySelector(".tag-filter-dropdown") as any;
  assert.ok(customDropdown);

  const trigger = customDropdown.querySelector(".custom-dropdown-trigger") as any;
  assert.ok(trigger);
  assert.ok(trigger.innerHTML?.includes("Filter by Tag"));

  const menu = customDropdown.querySelector(".custom-dropdown-menu") as any;
  assert.ok(menu);

  // Trigger expand to render option buttons
  trigger.dispatchEvent("click");

  const items = menu.querySelectorAll(".custom-dropdown-item");
  assert.equal(items.length, 2);
  assert.equal(items[0].textContent, "#store (1)");
  assert.equal(items[1].textContent, "#ui (1)");
});

test("renderSidebar renders connection-badge in pathRow right after session-workspace", () => {
  const options = createSidebarOptions({
    descriptors: [
      {
        key: "file::/path/to/session.jsonl",
        source: "claude",
        title: "Session 1",
        primaryPath: "/path/to/session.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "remote",
        connectionLabel: "my-remote-node",
        connectionDetail: "ssh://user@host",
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now(),
        metadata: {
          cwd: "/home/user/workspace"
        }
      }
    ] as any[]
  });

  const sidebar = renderSidebar(options);
  const row = sidebar.querySelector(".session-row");
  assert.ok(row);

  // Since mock DOM does not parse innerHTML, we assert on the innerHTML strings!
  const sourceAndDate = row.querySelector(".source-and-date");
  assert.ok(sourceAndDate);
  assert.equal(sourceAndDate.innerHTML.includes("connection-badge"), false);

  const pathRow = row.querySelector(".session-path-row");
  assert.ok(pathRow);

  const pathRowHtml = pathRow.innerHTML;
  assert.ok(pathRowHtml.includes("session-workspace"));
  assert.ok(pathRowHtml.includes("connection-badge"));
  assert.ok(pathRowHtml.includes("session-path"));

  // Verify connection badge contains correct text
  assert.ok(pathRowHtml.includes("my-remote-node"));

  // Verify the HTML structure order: workspace exists first, then connection-badge, then path
  const workspaceIdx = pathRowHtml.indexOf("session-workspace");
  const connBadgeIdx = pathRowHtml.indexOf("connection-badge");
  const pathIdx = pathRowHtml.indexOf("session-path");

  assert.ok(workspaceIdx < connBadgeIdx);
  assert.ok(connBadgeIdx < pathIdx);
});

test("renderSidebar session-date has title attribute with long datetime", () => {
  const options = createSidebarOptions({
    descriptors: [
      {
        key: "file::/path/to/session.jsonl",
        source: "claude",
        title: "Session 1",
        primaryPath: "/path/to/session.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "local",
        fileCount: 1,
        size: 100,
        mtimeMs: 1773431437000,
        metadata: {}
      }
    ] as any[]
  });

  const sidebar = renderSidebar(options);
  const row = sidebar.querySelector(".session-row");
  assert.ok(row);

  const sourceAndDate = row.querySelector(".source-and-date");
  assert.ok(sourceAndDate);

  const innerHtml = sourceAndDate.innerHTML;
  assert.ok(innerHtml.includes("title="));
  assert.ok(innerHtml.includes("session-date"));
});

test("renderSidebar supports double-clicking workspace badge to hide project", () => {
  let hiddenPath = "";
  const key = "file::/path/to/session.jsonl";
  const options = createSidebarOptions({
    descriptors: [
      {
        key,
        source: "claude",
        title: "Session 1",
        primaryPath: "/path/to/session.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "local",
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now(),
        metadata: { primaryWorkspace: "/workspace/proj1" }
      }
    ] as any[],
    onHideProject: (p) => {
      hiddenPath = p;
    }
  });

  const sidebar = renderSidebar(options);
  const workspaceEl = sidebar.querySelector(".session-workspace");
  assert.ok(workspaceEl);
  workspaceEl.dispatchEvent("dblclick");
  assert.equal(hiddenPath, "/workspace/proj1");
});

test("renderSidebar handles search box enter commands and renders :hidden list", () => {
  let hiddenPath = "";
  let cleared = false;
  let searchedValue = "";
  let shownPath = "";

  const options = createSidebarOptions({
    selectedKey: "file::/path/to/session.jsonl",
    descriptors: [
      {
        key: "file::/path/to/session.jsonl",
        source: "claude",
        title: "Session 1",
        primaryPath: "/path/to/session.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "local",
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now(),
        metadata: { primaryWorkspace: "/workspace/proj1" }
      }
    ] as any[],
    hiddenProjects: new Set(["/workspace/proj2"]),
    search: ":hidden",
    onHideProject: (p) => { hiddenPath = p; },
    onClearHiddenProjects: () => { cleared = true; },
    onSearch: (v) => { searchedValue = v; },
    onShowProject: (p) => { shownPath = p; }
  });

  const sidebar = renderSidebar(options);

  // 1. Verify rendering when search query is ':hidden'
  const list = sidebar.querySelector(".session-list");
  assert.ok(list);
  const listHtml = list.innerHTML;
  assert.ok(listHtml.includes("Hidden Workspaces"));
  assert.ok(listHtml.includes("/workspace/proj2"));

  // Click on hidden project row should trigger onShowProject
  const hiddenRow = list.querySelector(".session-row");
  assert.ok(hiddenRow);
  hiddenRow.dispatchEvent("click");
  assert.equal(shownPath, "/workspace/proj2");

  // 2. Test input commands keydown logic
  const searchInput = sidebar.querySelector("input") as HTMLInputElement | null;
  assert.ok(searchInput);

  // Simulate typing ':hide' and pressing enter
  searchInput.value = ":hide";
  searchInput.dispatchEvent("keydown", { key: "Enter" });
  assert.equal(hiddenPath, "/workspace/proj1");
  assert.equal(searchedValue, "");

  // Simulate typing ':unhide-all' and pressing enter
  searchInput.value = ":unhide-all";
  searchInput.dispatchEvent("keydown", { key: "Enter" });
  assert.equal(cleared, true);
  assert.equal(searchedValue, "");
});

test("renderSidebar groups and nests subagents under main agent sessions", () => {
  let collapsedKey = "";
  const options = createSidebarOptions({
    descriptors: [
      {
        key: "file::/path/to/main.jsonl",
        source: "codex",
        title: "Main Session",
        primaryPath: "/path/to/main.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "local",
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now(),
        metadata: { sessionId: "main-session-id" }
      },
      {
        key: "file::/path/to/sub.jsonl",
        source: "codex",
        title: "Subagent Session",
        primaryPath: "/path/to/sub.jsonl",
        relatedPaths: [],
        transport: "local-scan",
        origin: "local",
        fileCount: 1,
        size: 100,
        mtimeMs: Date.now() - 1000,
        metadata: { parentThreadId: "main-session-id" }
      }
    ] as any[],
    expandedSessionKeys: new Set<string>(),
    onToggleSessionCollapse: (key) => { collapsedKey = key; }
  });

  // Test collapsed state first
  const sidebarCollapsed = renderSidebar(options);
  const listCollapsed = sidebarCollapsed.querySelector(".session-list");
  assert.ok(listCollapsed);
  
  // Should show the subagent count badge
  const badge = listCollapsed.querySelector(".subagent-count-badge");
  assert.ok(badge);
  assert.equal(badge.textContent, "1");

  // Should have a collapse toggle button
  const toggleBtn = listCollapsed.querySelector(".subagent-count-badge");
  assert.ok(toggleBtn);
  toggleBtn.dispatchEvent("click");
  assert.equal(collapsedKey, "file::/path/to/main.jsonl");

  // Test expanded state
  const optionsExpanded = {
    ...options,
    expandedSessionKeys: new Set(["file::/path/to/main.jsonl"])
  };
  const sidebarExpanded = renderSidebar(optionsExpanded);
  const childrenContainer = sidebarExpanded.querySelector(".session-children-container");
  assert.ok(childrenContainer);
  assert.ok(childrenContainer.innerHTML?.includes("Subagent Session"));

  // Test search mode flat rendering
  const optionsSearch = {
    ...options,
    search: "Subagent"
  };
  const sidebarSearch = renderSidebar(optionsSearch);
  assert.ok(!sidebarSearch.querySelector(".session-children-container"));
});



