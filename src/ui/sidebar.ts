import type { SessionDescriptor, SessionSource } from "../parsers/types.js";
import { escapeHtml, formatLocalDateTime, formatLocalDateTimeLong } from "./utils.js";
import { getWorkspaceFullPath, getWorkspaceLabel } from "../store/sessionStore.js";

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
  hiddenProjects: Set<string>;
  expandedSessionKeys?: Set<string>;
  onToggleOpen: () => void;
  onTogglePin: () => void;
  onTogglePinSession: (key: string) => void;
  onToggleFavoriteSession: (key: string) => void;
  onToggleSessionCollapse?: (key: string) => void;
  onSearch: (value: string) => void;
  onFilter: (value: SessionSource | "all") => void;
  onSelect: (key: string) => void;
  onHideProject: (projectPath: string) => void;
  onShowProject: (projectPath: string) => void;
  onClearHiddenProjects: () => void;
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
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const val = search.value.trim();
      if (val === ":hide") {
        event.preventDefault();
        if (options.selectedKey) {
          const currentDesc = options.descriptors.find(d => d.key === options.selectedKey);
          if (currentDesc) {
            const wsPath = getWorkspaceFullPath(currentDesc);
            if (wsPath) {
              options.onHideProject(wsPath);
              options.onSearch("");
            }
          }
        }
      } else if (val === ":unhide-all") {
        event.preventDefault();
        options.onClearHiddenProjects();
        options.onSearch("");
      }
    }
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

  if (options.search.trim().toLowerCase() === ":hidden") {
    if (options.hiddenProjects.size === 0) {
      list.append(emptyState("No projects are currently hidden."));
    } else {
      const header = document.createElement("div");
      header.className = "session-group-header";
      header.innerHTML = `🚫 Hidden Workspaces (${options.hiddenProjects.size})`;
      list.append(header);

      for (const projectPath of options.hiddenProjects) {
        const button = document.createElement("button");
        button.className = "session-row";
        button.type = "button";
        button.title = "Click to restore workspace";

        const parts = projectPath.split(/[\\/]/).filter(Boolean);
        const label = parts.at(-1) || projectPath;

        button.innerHTML = `
          <div class="session-row-top">
            <div class="source-and-date">
              <span class="source-badge unknown">hidden</span>
            </div>
          </div>
          <strong class="session-title">${escapeHtml(label)}</strong>
          <div class="session-path-row">
            <p class="session-path">${escapeHtml(projectPath)}</p>
          </div>
        `;

        button.addEventListener("click", () => {
          options.onShowProject(projectPath);
        });

        list.append(button);
      }
    }
  } else if (options.loading && options.descriptors.length === 0) {
    list.append(emptyState("Scanning local session directories..."));
  } else if (options.descriptors.length === 0) {
    list.append(emptyState("No sessions found."));
  } else {
    let hasRenderedPinnedHeader = false;
    let hasRenderedNormalHeader = false;

    const renderSingleDescriptor = (descriptor: SessionDescriptor) => {
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
      const hoverDateLabel = formatLocalDateTimeLong(descriptor.mtimeMs, "");
      const workspaceLabel = getWorkspaceLabel(descriptor);

      const meta = options.favoriteMetadata.get(descriptor.key);

      // Create rowTop elegantly via DOM elements for mock testing harness compatibility
      const rowTop = document.createElement("div");
      rowTop.className = "session-row-top";

      const sourceAndDate = document.createElement("div");
      sourceAndDate.className = "source-and-date";
      sourceAndDate.innerHTML = `
        <span class="source-badge ${descriptor.source}">${descriptor.source}</span>
        <span class="session-date" title="${escapeHtml(hoverDateLabel)}">${dateLabel}</span>
      `;
      rowTop.append(sourceAndDate);
      button.append(rowTop);

      const titleEl = document.createElement("strong");
      titleEl.className = "session-title";
      titleEl.textContent = descriptor.title;

      const pathRow = document.createElement("div");
      pathRow.className = "session-path-row";
      
      if (workspaceLabel) {
        const workspaceEl = document.createElement("span");
        workspaceEl.className = "session-workspace";
        const wsFullPath = getWorkspaceFullPath(descriptor);
        workspaceEl.title = `${wsFullPath} (Double-click to hide project)`;
        workspaceEl.textContent = workspaceLabel;
        workspaceEl.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          options.onHideProject(wsFullPath);
        });
        pathRow.append(workspaceEl);
      }

      if (descriptor.origin === "remote" && descriptor.connectionLabel) {
        const connectionBadgeEl = document.createElement("span");
        connectionBadgeEl.className = "connection-badge";
        connectionBadgeEl.title = descriptor.connectionDetail ?? descriptor.connectionLabel;
        connectionBadgeEl.textContent = descriptor.connectionLabel;
        pathRow.append(connectionBadgeEl);
      }

      const pathEl = document.createElement("p");
      pathEl.className = "session-path";
      pathEl.textContent = descriptor.primaryPath;
      pathRow.append(pathEl);

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
    };

    interface TreeNode {
      descriptor: SessionDescriptor;
      children: TreeNode[];
    }

    const buildDescriptorTree = (descriptors: SessionDescriptor[], allDescriptors: SessionDescriptor[]): TreeNode[] => {
      const descriptorMap = new Map<string, SessionDescriptor>();
      for (const d of allDescriptors) {
        const sId = d.metadata?.sessionId || d.metadata?.cascadeId;
        if (sId) {
          descriptorMap.set(String(sId), d);
        }
        descriptorMap.set(d.key, d);
        const filename = d.primaryPath ? d.primaryPath.split(/[\\/]/).pop() : "";
        if (filename) {
          descriptorMap.set(filename, d);
        }
      }

      const nodes = descriptors.map(d => ({ descriptor: d, children: [] as TreeNode[] }));
      const nodeMap = new Map<string, TreeNode>();
      for (const node of nodes) {
        nodeMap.set(node.descriptor.key, node);
      }

      const roots: TreeNode[] = [];

      for (const node of nodes) {
        const pId = node.descriptor.metadata?.parentThreadId;
        let parentNode: TreeNode | undefined;
        if (pId) {
          const parentDesc = descriptorMap.get(String(pId));
          if (parentDesc) {
            parentNode = nodeMap.get(parentDesc.key);
          }
        }

        if (parentNode) {
          parentNode.children.push(node);
        } else {
          roots.push(node);
        }
      }

      const sortNodes = (a: TreeNode, b: TreeNode) => {
        return b.descriptor.mtimeMs - a.descriptor.mtimeMs;
      };

      const recursiveSort = (node: TreeNode) => {
        node.children.sort(sortNodes);
        node.children.forEach(recursiveSort);
      };

      roots.sort(sortNodes);
      roots.forEach(recursiveSort);

      return roots;
    };

    const isDescendantSelected = (n: TreeNode): boolean => {
      return n.children.some(child => child.descriptor.key === options.selectedKey || isDescendantSelected(child));
    };

    const renderTreeNode = (node: TreeNode, depth: number, parentContainer: HTMLElement) => {
      const descriptor = node.descriptor;
      const isPinned = options.pinnedKeys.has(descriptor.key);
      const isFavorited = options.favoriteKeys.has(descriptor.key);

      const nodeContainer = document.createElement("div");
      nodeContainer.className = "session-tree-node";

      const hasChildren = node.children.length > 0;
      const isCollapsed = !(options.expandedSessionKeys?.has(descriptor.key) ?? false) && !isDescendantSelected(node);

      const button = document.createElement("button");
      let btnClassName = `session-row${descriptor.key === options.selectedKey ? " active" : ""}${isPinned ? " pinned-row" : ""}${isFavorited ? " favorite-row" : ""}`;
      if (depth > 0) {
        btnClassName += ` subagent-row subagent-row-depth-${depth}`;
      }
      button.className = btnClassName;
      button.type = "button";
      button.addEventListener("click", () => {
        options.onSelect(descriptor.key);
      });

      const dateLabel = formatLocalDateTime(descriptor.mtimeMs, "Unknown time");
      const hoverDateLabel = formatLocalDateTimeLong(descriptor.mtimeMs, "");
      const workspaceLabel = getWorkspaceLabel(descriptor);
      const meta = options.favoriteMetadata.get(descriptor.key);

      const rowTop = document.createElement("div");
      rowTop.className = "session-row-top";

      const sourceAndDate = document.createElement("div");
      sourceAndDate.className = "source-and-date";

      const badgeSpan = document.createElement("span");
      badgeSpan.className = `source-badge ${descriptor.source}`;
      badgeSpan.textContent = descriptor.source;

      const dateSpan = document.createElement("span");
      dateSpan.className = "session-date";
      dateSpan.title = hoverDateLabel;
      dateSpan.textContent = dateLabel;

      sourceAndDate.append(badgeSpan, dateSpan);

      if (hasChildren) {
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "subagent-count-badge";
        badge.textContent = String(node.children.length);
        badge.title = isCollapsed ? "Expand subagents" : "Collapse subagents";
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          options.onToggleSessionCollapse?.(descriptor.key);
        });
        sourceAndDate.append(badge);
      }

      rowTop.append(sourceAndDate);
      button.append(rowTop);

      const titleRow = document.createElement("div");
      titleRow.className = "session-title-row";

      const titleEl = document.createElement("strong");
      titleEl.className = "session-title";
      titleEl.textContent = descriptor.title;
      titleRow.append(titleEl);

      button.append(titleRow);

      const pathRow = document.createElement("div");
      pathRow.className = "session-path-row";
      
      if (workspaceLabel) {
        const workspaceEl = document.createElement("span");
        workspaceEl.className = "session-workspace";
        const wsFullPath = getWorkspaceFullPath(descriptor);
        workspaceEl.title = `${wsFullPath} (Double-click to hide project)`;
        workspaceEl.textContent = workspaceLabel;
        workspaceEl.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          options.onHideProject(wsFullPath);
        });
        pathRow.append(workspaceEl);
      }

      if (descriptor.origin === "remote" && descriptor.connectionLabel) {
        const connectionBadgeEl = document.createElement("span");
        connectionBadgeEl.className = "connection-badge";
        connectionBadgeEl.title = descriptor.connectionDetail ?? descriptor.connectionLabel;
        connectionBadgeEl.textContent = descriptor.connectionLabel;
        pathRow.append(connectionBadgeEl);
      }

      const pathEl = document.createElement("p");
      pathEl.className = "session-path";
      pathEl.textContent = descriptor.primaryPath;
      pathRow.append(pathEl);

      button.append(pathRow);

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

      if (meta && meta.notes && meta.notes.trim()) {
        const notesEl = document.createElement("p");
        notesEl.className = "session-row-note";
        notesEl.title = meta.notes;
        notesEl.textContent = `📝 ${meta.notes}`;
        button.append(notesEl);
      }

      nodeContainer.append(button);

      if (hasChildren && !isCollapsed) {
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "session-children-container";
        for (const child of node.children) {
          renderTreeNode(child, depth + 1, childrenContainer);
        }
        nodeContainer.append(childrenContainer);
      }

      parentContainer.append(nodeContainer);
    };

    const isSearching = options.search.trim().length > 0;
    const MAX_INITIAL_NORMAL = 200;
    const pendingDescriptors: SessionDescriptor[] = [];
    let renderedNormalCount = 0;

    if (isSearching) {
      for (const descriptor of options.descriptors) {
        const isPinned = options.pinnedKeys.has(descriptor.key);
        const isSelected = descriptor.key === options.selectedKey;

        if (!isPinned && !isSelected && renderedNormalCount >= MAX_INITIAL_NORMAL) {
          pendingDescriptors.push(descriptor);
          continue;
        }

        if (!isPinned) {
          renderedNormalCount++;
        }

        renderSingleDescriptor(descriptor);
      }
    } else {
      // First render all pinned descriptors
      for (const descriptor of options.descriptors) {
        if (options.pinnedKeys.has(descriptor.key)) {
          renderSingleDescriptor(descriptor);
        }
      }

      // Build and render history tree
      const unpinnedDescriptors = options.descriptors.filter(d => !options.pinnedKeys.has(d.key));
      const treeRoots = buildDescriptorTree(unpinnedDescriptors, options.descriptors);

      for (const root of treeRoots) {
        const isSelected = root.descriptor.key === options.selectedKey || isDescendantSelected(root);

        if (!isSelected && renderedNormalCount >= MAX_INITIAL_NORMAL) {
          const collectPending = (n: TreeNode) => {
            pendingDescriptors.push(n.descriptor);
            n.children.forEach(collectPending);
          };
          collectPending(root);
          continue;
        }

        renderedNormalCount++;
        renderTreeNode(root, 0, list);
      }
    }

    if (pendingDescriptors.length > 0) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "button secondary show-more-sessions-btn";
      moreBtn.style.width = "calc(100% - 16px)";
      moreBtn.style.margin = "12px 8px";
      moreBtn.style.padding = "8px 12px";
      moreBtn.style.fontSize = "12px";
      moreBtn.textContent = `Show full history (+${pendingDescriptors.length} remaining)`;
      moreBtn.addEventListener("click", () => {
        moreBtn.remove();
        if (isSearching) {
          for (const descriptor of pendingDescriptors) {
            renderSingleDescriptor(descriptor);
          }
        } else {
          const divider = list.querySelector(".session-group-header.divider");
          if (divider) {
            while (divider.nextSibling) {
              divider.nextSibling.remove();
            }
          }
          const unpinnedDescriptors = options.descriptors.filter(d => !options.pinnedKeys.has(d.key));
          const treeRoots = buildDescriptorTree(unpinnedDescriptors, options.descriptors);
          for (const root of treeRoots) {
            renderTreeNode(root, 0, list);
          }
        }
      });
      list.append(moreBtn);
    }
  }

  panel.append(heading, controls, list);
  container.append(rail, panel);
  return container;
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

function caretRightIcon(): string {
  return `
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="display: block;">
      <path d="M5.72 13.47a.75.75 0 0 1 0-1.06L9.66 8.5 5.72 4.59a.75.75 0 1 1 1.06-1.06l4.47 4.47a.75.75 0 0 1 0 1.06l-4.47 4.47a.75.75 0 0 1-1.06 0Z"/>
    </svg>
  `;
}

function caretDownIcon(): string {
  return `
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="display: block;">
      <path d="M3.47 5.72a.75.75 0 0 1 1.06 0L8 9.19l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06Z"/>
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
