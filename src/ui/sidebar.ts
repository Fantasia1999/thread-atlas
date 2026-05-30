import type { SessionDescriptor, SessionSource } from "../parsers/types.js";
import { escapeHtml, formatLocalDateTime } from "./utils.js";

interface SidebarOptions {
  descriptors: SessionDescriptor[];
  selectedKey?: string;
  sourceFilter: SessionSource | "all";
  search: string;
  loading: boolean;
  pinned: boolean;
  open: boolean;
  pinnedKeys: Set<string>;
  favoriteKeys: Set<string>;
  favoriteMetadata: Map<string, { tags: string[]; notes: string }>;
  onToggleOpen: () => void;
  onTogglePin: () => void;
  onTogglePinSession: (key: string) => void;
  onToggleFavoriteSession: (key: string) => void;
  onSearch: (value: string) => void;
  onFilter: (value: SessionSource | "all") => void;
  onSelect: (key: string) => void;
}

export function renderSidebar(options: SidebarOptions): HTMLElement {
  let hoverTimeout: number | undefined;
  let leaveTimeout: number | undefined;
  let isMouseOver = false;

  const container = document.createElement("div");
  container.className = `sidebar-dock${options.open ? " open" : ""}${options.pinned ? " pinned" : ""}`;

  const clearAllTimeouts = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = undefined;
    }
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = undefined;
    }
  };

  container.addEventListener("mouseleave", () => {
    isMouseOver = false;
    clearAllTimeouts();
    const isOpen = container.classList.contains("open");
    const isPinned = container.classList.contains("pinned");

    // Do not close the sidebar if an input or select inside it has focus
    const activeEl = document.activeElement;
    if (activeEl && container.contains(activeEl)) {
      return;
    }

    if (isOpen && !isPinned) {
      leaveTimeout = window.setTimeout(() => {
        options.onToggleOpen();
      }, 80);
    }
  });

  container.addEventListener("mouseenter", () => {
    isMouseOver = true;
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = undefined;
    }
  });

  container.addEventListener("focusout", (event) => {
    const newFocus = event.relatedTarget as HTMLElement | null;
    if (newFocus && container.contains(newFocus)) {
      return;
    }

    const isOpen = container.classList.contains("open");
    const isPinned = container.classList.contains("pinned");
    if (isOpen && !isPinned && !isMouseOver) {
      clearAllTimeouts();
      leaveTimeout = window.setTimeout(() => {
        options.onToggleOpen();
      }, 80);
    }
  });

  const rail = document.createElement("div");
  rail.className = "sidebar-rail";

  const openButton = document.createElement("button");
  openButton.className = "rail-button";
  openButton.type = "button";
  openButton.title = options.open ? "Collapse sessions" : "Open sessions";
  openButton.setAttribute("aria-label", openButton.title);
  openButton.innerHTML = listIcon();

  openButton.addEventListener("click", () => {
    clearAllTimeouts();
    const isOpen = container.classList.contains("open");
    if (!isOpen) {
      options.onToggleOpen();
    }
  });

  openButton.addEventListener("mouseenter", () => {
    const isOpen = container.classList.contains("open");
    if (!isOpen) {
      hoverTimeout = window.setTimeout(() => {
        options.onToggleOpen();
      }, 50);
    }
  });

  openButton.addEventListener("mouseleave", () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = undefined;
    }
  });

  rail.append(openButton);

  const panel = document.createElement("aside");
  panel.className = "sidebar";

  const heading = document.createElement("div");
  heading.className = "panel-header";
  heading.innerHTML = `
    <div>
      <p class="eyebrow">Session Index</p>
      <h2>Local + Synced Logs</h2>
    </div>
    <div class="panel-header-actions">
      <div class="count-badge">${options.descriptors.length}</div>
    </div>
  `;

  const pinButton = document.createElement("button");
  pinButton.className = `panel-icon-button${options.pinned ? " active" : ""}`;
  pinButton.type = "button";
  pinButton.title = options.pinned ? "Unpin sessions" : "Pin sessions";
  pinButton.setAttribute("aria-label", pinButton.title);
  pinButton.innerHTML = pinIcon();
  pinButton.addEventListener("click", options.onTogglePin);
  heading.querySelector(".panel-header-actions")?.append(pinButton);

  const controls = document.createElement("div");
  controls.className = "sidebar-controls";

  const search = document.createElement("input");
  search.className = "text-input";
  search.type = "search";
  search.placeholder = "Search title or path";
  search.value = options.search;
  search.addEventListener("input", () => {
    options.onSearch(search.value);
  });

  const sourceItems: DropdownItem[] = [
    { value: "all", label: "All sources" },
    { value: "codex", label: "Codex" },
    { value: "claude", label: "Claude" },
    { value: "opencode", label: "OpenCode" },
    { value: "gemini", label: "Gemini" },
    { value: "antigravity", label: "Antigravity" },
    { value: "copilot", label: "Copilot" }
  ];

  const filter = createCustomDropdown({
    items: sourceItems,
    selectedValue: options.sourceFilter,
    placeholder: "All sources",
    onChange: (value) => {
      options.onFilter(value as SessionSource | "all");
    }
  });
  filter.classList.add("source-filter-dropdown");

  // Render C.3 Quick Search Chips (Favorites Chip + Tag Select Dropdown)
  const chipsContainer = document.createElement("div");
  chipsContainer.className = "quick-chips-container";

  const renderChips = () => {
    chipsContainer.innerHTML = "";

    // 1. Extract unique tags and Usage Counts from all annotated metadata (starred or not)
    const tagCounts = new Map<string, number>();
    for (const [_, meta] of options.favoriteMetadata.entries()) {
      if (meta && meta.tags) {
        for (const t of meta.tags) {
          const cleanT = t.trim();
          if (cleanT) {
            tagCounts.set(cleanT, (tagCounts.get(cleanT) || 0) + 1);
          }
        }
      }
    }

    const hasFavorites = options.favoriteKeys.size > 0;
    const hasTags = tagCounts.size > 0;
    const showChips = hasFavorites || hasTags;

    if (chipsContainer.style) {
      chipsContainer.style.display = showChips ? "flex" : "none";
    }
    chipsContainer.classList.toggle("hidden", !showChips);
    if (!showChips) {
      return;
    }

    // 2. Favorites overall chip
    if (hasFavorites) {
      const allFavChip = document.createElement("button");
      allFavChip.type = "button";
      const isFavSearchActive =
        options.search.toLowerCase().includes("is:starred") ||
        options.search.toLowerCase().includes("is:favorite");
      allFavChip.className = `chip-btn star-chip${isFavSearchActive ? " active" : ""}`;
      allFavChip.textContent = `⭐ Favorites`;
      allFavChip.addEventListener("click", (e) => {
        e?.stopPropagation();
        if (isFavSearchActive) {
          const nextSearch = options.search
            .replace(/\bis:starred\b/gi, "")
            .replace(/\bis:favorite\b/gi, "")
            .trim()
            .replace(/\s+/g, " ");
          options.onSearch(nextSearch);
        } else {
          const nextSearch = (options.search ? options.search + " " : "") + "is:starred";
          options.onSearch(nextSearch.trim());
        }
      });
      chipsContainer.append(allFavChip);
    }

    // 3. Render custom tag filter dropdown if any tags exist
    if (hasTags) {
      const tagItems: DropdownItem[] = [];
      let activeTagValue = "";
      const searchLower = options.search.toLowerCase();

      [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([tag, count]) => {
          tagItems.push({ value: tag, label: `#${tag} (${count})` });
          if (searchLower.includes(`#${tag.toLowerCase()}`)) {
            activeTagValue = tag;
          }
        });

      // Prepend "Clear Filter" option if a tag filter is active
      if (activeTagValue) {
        tagItems.unshift({ value: "", label: "❌ Clear Tag Filter" });
      }

      const tagSelect = createCustomDropdown({
        items: tagItems,
        selectedValue: activeTagValue,
        placeholder: "🏷️ Filter by Tag",
        onChange: (selectedTag) => {
          // Clear existing tags from search query first
          let nextSearch = options.search;
          [...tagCounts.keys()].forEach((t) => {
            const regex = new RegExp(`#${t}\\b`, "gi");
            nextSearch = nextSearch.replace(regex, "");
          });
          nextSearch = nextSearch.trim().replace(/\s+/g, " ");

          if (selectedTag) {
            nextSearch = (nextSearch ? nextSearch + " " : "") + `#${selectedTag}`;
          }

          options.onSearch(nextSearch.trim());
        }
      });
      tagSelect.classList.add("tag-filter-dropdown");
      chipsContainer.append(tagSelect);
    }
  };

  renderChips();
  controls.append(search, filter, chipsContainer);

  const list = document.createElement("div");
  list.className = "session-list";

  if (options.loading && options.descriptors.length === 0) {
    list.append(emptyState("Scanning local session directories..."));
  } else if (options.descriptors.length === 0) {
    list.append(emptyState("No sessions found."));
  } else {
    let hasRenderedPinnedHeader = false;
    let hasRenderedNormalHeader = false;

    for (const descriptor of options.descriptors) {
      const isPinned = options.pinnedKeys.has(descriptor.key);
      const isFavorited = options.favoriteKeys.has(descriptor.key);

      // Group headers
      if (isPinned && !hasRenderedPinnedHeader) {
        const pHeader = document.createElement("div");
        pHeader.className = "session-group-header";
        pHeader.innerHTML = `📌 Pinned Sessions`;
        list.append(pHeader);
        hasRenderedPinnedHeader = true;
      } else if (!isPinned && !hasRenderedNormalHeader) {
        const nHeader = document.createElement("div");
        nHeader.className = "session-group-header divider";
        nHeader.innerHTML = `📁 Scanned History`;
        list.append(nHeader);
        hasRenderedNormalHeader = true;
      }

      const button = document.createElement("button");
      button.className = `session-row${descriptor.key === options.selectedKey ? " active" : ""}${isPinned ? " pinned-row" : ""}${isFavorited ? " favorite-row" : ""}`;
      button.type = "button";
      button.addEventListener("click", () => {
        options.onSelect(descriptor.key);
      });

      const dateLabel = formatLocalDateTime(descriptor.mtimeMs, "Unknown time");
      const workspaceLabel = getWorkspaceLabel(descriptor);
      const workspaceHtml = workspaceLabel
        ? `<span class="session-workspace" title="${escapeHtml(getWorkspaceFullPath(descriptor))}">${escapeHtml(workspaceLabel)}</span>`
        : "";

      const meta = options.favoriteMetadata.get(descriptor.key);

      // Create rowTop elegantly via DOM elements for mock testing harness compatibility
      const rowTop = document.createElement("div");
      rowTop.className = "session-row-top";

      const sourceAndDate = document.createElement("div");
      sourceAndDate.className = "source-and-date";
      sourceAndDate.innerHTML = `
        <span class="source-badge ${descriptor.source}">${descriptor.source}</span>
        <span class="session-date">${dateLabel}</span>
      `;
      rowTop.append(sourceAndDate);
      button.append(rowTop);

      const titleEl = document.createElement("strong");
      titleEl.className = "session-title";
      titleEl.textContent = descriptor.title;

      const pathRow = document.createElement("div");
      pathRow.className = "session-path-row";
      pathRow.innerHTML = workspaceHtml + `<p class="session-path">${escapeHtml(descriptor.primaryPath)}</p>`;

      button.append(titleEl, pathRow);

      // 1. Create and append actions via DOM elements for full compatibility with mock testing harness
      const actionsContainer = document.createElement("div");
      actionsContainer.className = "session-item-actions";

      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `session-action-btn pin-btn${isPinned ? " active" : ""}`;
      pinBtn.title = isPinned ? "Unpin session" : "Pin session";
      pinBtn.innerHTML = pinIconMini();
      pinBtn.addEventListener("click", (e) => {
        e?.stopPropagation();
        options.onTogglePinSession(descriptor.key);
      });

      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = `session-action-btn favorite-btn${isFavorited ? " active" : ""}`;
      favBtn.title = isFavorited ? "Remove from Favorites" : "Add to Favorites";
      favBtn.innerHTML = starIconMini();
      favBtn.addEventListener("click", (e) => {
        e?.stopPropagation();
        options.onToggleFavoriteSession(descriptor.key);
      });

      actionsContainer.append(pinBtn, favBtn);
      rowTop.append(actionsContainer);

      // 2. Create and append tags capsules
      if (meta && meta.tags && meta.tags.length > 0) {
        const tagsContainer = document.createElement("div");
        tagsContainer.className = "session-row-tags";
        for (const t of meta.tags) {
          const pill = document.createElement("span");
          pill.className = "tag-pill";
          pill.textContent = t;
          tagsContainer.append(pill);
        }
        button.append(tagsContainer);
      }

      // 3. Create and append private notes
      if (meta && meta.notes && meta.notes.trim()) {
        const notesEl = document.createElement("p");
        notesEl.className = "session-row-note";
        notesEl.title = meta.notes;
        notesEl.textContent = `📝 ${meta.notes}`;
        button.append(notesEl);
      }

      list.append(button);
    }
  }

  panel.append(heading, controls, list);
  container.append(rail, panel);
  return container;
}

function getWorkspaceFullPath(descriptor: SessionDescriptor): string {
  const rawWorkspace = 
    descriptor.metadata?.primaryWorkspace || 
    descriptor.metadata?.cwd || 
    descriptor.metadata?.directory;

  if (typeof rawWorkspace === "string" && rawWorkspace.trim()) {
    return rawWorkspace.trim();
  }

  // Claude inference from path
  const pathStr = descriptor.primaryPath || "";
  const claudeMatch = pathStr.match(/[\\/]\.claude[\\/]projects[\\/]([^\\/]+)/i);
  if (claudeMatch && claudeMatch[1]) {
    return claudeMatch[1];
  }

  return "";
}

function getWorkspaceLabel(descriptor: SessionDescriptor): string {
  const fullPath = getWorkspaceFullPath(descriptor);
  if (!fullPath) {
    return "";
  }

  // If it's a path, extract the last folder/directory name
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  const lastPart = parts.at(-1);
  return lastPart ?? fullPath;
}

function emptyState(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}

function listIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Z"/>
    </svg>
  `;
}

function pinIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.25 1.75A.75.75 0 0 1 6 1h4a.75.75 0 0 1 .53 1.28l-.78.78v3.38l2.28 2.28A.75.75 0 0 1 11.5 10H8.75v4.25a.75.75 0 0 1-1.5 0V10H4.5a.75.75 0 0 1-.53-1.28l2.28-2.28V3.06l-.78-.78a.75.75 0 0 1-.22-.53Zm2.03.75.25.25a.75.75 0 0 1 .22.53v3.47a.75.75 0 0 1-.22.53L6.31 8.5h3.38L8.47 7.28a.75.75 0 0 1-.22-.53V3.28a.75.75 0 0 1 .22-.53l.25-.25H7.28Z"/>
    </svg>
  `;
}

function pinIconMini(): string {
  return `
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="13" height="13">
      <path d="M10.25 1a.75.75 0 0 1 .75.75v3.38l1.78 1.78a.75.75 0 0 1-.53 1.28H9.5v4.25a.75.75 0 0 1-1.5 0V8.19H5.25a.75.75 0 0 1-.53-1.28l1.78-1.78V1.75a.75.75 0 0 1 .75-.75h3Z"/>
    </svg>
  `;
}

function starIconMini(): string {
  return `
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="13" height="13">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97 1.053 4.208a.75.75 0 0 1-1.087.79L8 12.257l-3.751 1.973a.75.75 0 0 1-1.087-.79l1.053-4.208-3.046-2.97a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
    </svg>
  `;
}

interface DropdownItem {
  value: string;
  label: string;
}

function createCustomDropdown(options: {
  items: DropdownItem[];
  selectedValue: string;
  placeholder: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const container = document.createElement("div");
  container.className = "custom-dropdown-container";

  const trigger = document.createElement("div");
  trigger.className = "custom-dropdown-trigger";

  const currentItem = options.items.find((item) => item.value === options.selectedValue);
  trigger.innerHTML = `
    <span class="trigger-label">${escapeHtml(currentItem ? currentItem.label : options.placeholder)}</span>
    <span class="trigger-arrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </span>
  `;
  container.append(trigger);

  const menu = document.createElement("div");
  menu.className = "custom-dropdown-menu hidden";

  const renderItems = () => {
    menu.innerHTML = "";
    for (const item of options.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `custom-dropdown-item${item.value === options.selectedValue ? " active" : ""}`;
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onChange(item.value);
        menu.classList.add("hidden");
        trigger.classList.remove("open");
      });
      menu.append(btn);
    }
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.contains("hidden");

    // Close all other dropdowns
    document.querySelectorAll(".custom-dropdown-menu").forEach((m) => {
      if (m !== menu) {
        m.classList.add("hidden");
        m.parentElement?.querySelector(".custom-dropdown-trigger")?.classList.remove("open");
      }
    });

    menu.classList.toggle("hidden", !isHidden);
    trigger.classList.toggle("open", isHidden);
    if (isHidden) {
      renderItems();
    }
  });

  document.addEventListener("click", () => {
    menu.classList.add("hidden");
    trigger.classList.remove("open");
  });

  container.append(menu);
  return container;
}
