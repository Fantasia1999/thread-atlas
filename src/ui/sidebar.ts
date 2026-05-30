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
  onToggleOpen: () => void;
  onTogglePin: () => void;
  onSearch: (value: string) => void;
  onFilter: (value: SessionSource | "all") => void;
  onSelect: (key: string) => void;
}

export function renderSidebar(options: SidebarOptions): HTMLElement {
  let hoverTimeout: number | undefined;
  let leaveTimeout: number | undefined;

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
    clearAllTimeouts();
    const isOpen = container.classList.contains("open");
    const isPinned = container.classList.contains("pinned");
    if (isOpen && !isPinned) {
      leaveTimeout = window.setTimeout(() => {
        options.onToggleOpen();
      }, 80);
    }
  });

  container.addEventListener("mouseenter", () => {
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = undefined;
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

  const filter = document.createElement("select");
  filter.className = "select-input";
  filter.innerHTML = `
    <option value="all">All sources</option>
    <option value="codex">Codex</option>
    <option value="claude">Claude</option>
    <option value="opencode">OpenCode</option>
    <option value="gemini">Gemini</option>
    <option value="antigravity">Antigravity</option>
    <option value="copilot">Copilot</option>
  `;
  filter.value = options.sourceFilter;
  filter.addEventListener("change", () => {
    options.onFilter(filter.value as SessionSource | "all");
  });

  controls.append(search, filter);

  const list = document.createElement("div");
  list.className = "session-list";

  if (options.loading && options.descriptors.length === 0) {
    list.append(emptyState("Scanning local session directories..."));
  } else if (options.descriptors.length === 0) {
    list.append(emptyState("No sessions found."));
  } else {
    for (const descriptor of options.descriptors) {
      const button = document.createElement("button");
      button.className = `session-row${descriptor.key === options.selectedKey ? " active" : ""}`;
      button.type = "button";
      button.addEventListener("click", () => {
        options.onSelect(descriptor.key);
      });

      const dateLabel = formatLocalDateTime(descriptor.mtimeMs, "Unknown time");
      const workspaceLabel = getWorkspaceLabel(descriptor);
      const workspaceHtml = workspaceLabel
        ? `<span class="session-workspace" title="${escapeHtml(getWorkspaceFullPath(descriptor))}">${escapeHtml(workspaceLabel)}</span>`
        : "";

      button.innerHTML = `
        <div class="session-row-top">
          <span class="source-badge ${descriptor.source}">${descriptor.source}</span>
          <span class="session-date">${dateLabel}</span>
        </div>
        <strong class="session-title">${escapeHtml(descriptor.title)}</strong>
        <div class="session-path-row">
          ${workspaceHtml}
          <p class="session-path">${escapeHtml(descriptor.primaryPath)}</p>
        </div>
      `;

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
