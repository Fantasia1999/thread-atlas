import type { SessionDescriptor, SessionSource } from "../parsers/types.js";
import { escapeHtml, formatLocalDateTime } from "./utils.js";

interface SidebarOptions {
  descriptors: SessionDescriptor[];
  selectedKey?: string;
  sourceFilter: SessionSource | "all";
  search: string;
  loading: boolean;
  onSearch: (value: string) => void;
  onFilter: (value: SessionSource | "all") => void;
  onSelect: (key: string) => void;
}

export function renderSidebar(options: SidebarOptions): HTMLElement {
  const container = document.createElement("aside");
  container.className = "sidebar";

  const heading = document.createElement("div");
  heading.className = "panel-header";
  heading.innerHTML = `
    <div>
      <p class="eyebrow">Session Index</p>
      <h2>Local + Synced Logs</h2>
    </div>
    <div class="count-badge">${options.descriptors.length}</div>
  `;

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

      button.innerHTML = `
        <div class="session-row-top">
          <span class="source-badge ${descriptor.source}">${descriptor.source}</span>
          <span class="session-date">${dateLabel}</span>
        </div>
        <strong class="session-title">${escapeHtml(descriptor.title)}</strong>
        <p class="session-path">${escapeHtml(descriptor.primaryPath)}</p>
      `;

      list.append(button);
    }
  }

  container.append(heading, controls, list);
  return container;
}

function emptyState(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}
