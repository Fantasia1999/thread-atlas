import type { Message, Session, SessionDescriptor, ToolCall } from "../parsers/types.js";
import { renderMarkdown } from "./markdown.js";
import { renderMermaidDiagrams } from "./mermaidRender.js";
import {
  copyText,
  escapeHtml,
  formatDateTime,
  formatDateTimeLong,
  formatDateTimeTitle,
  formatDisplayTime,
  ansiToHtml
} from "./utils.js";

export type MessageViewFilter = "default" | "not-tool" | "user" | "answer";

interface ChatViewOptions {
  descriptor?: SessionDescriptor;
  session?: Session;
  loading: boolean;
  messageFilter: MessageViewFilter;
  timelinePinned: boolean;
  timelineOpen: boolean;
  pinnedKeys: Set<string>;
  favoriteKeys: Set<string>;
  favoriteMetadata: Map<string, { tags: string[]; notes: string }>;
  onFilterChange: (filter: MessageViewFilter) => void;
  onTimelineToggleOpen: () => void;
  onTimelineTogglePin: () => void;
  onExport: (session: Session, format: "json" | "md") => void;
  onTogglePinSession: (key: string) => void;
  onToggleFavoriteSession: (key: string) => void;
  onUpdateMetadata: (key: string, tags: string[], notes: string) => void;
  onRenderComplete?: () => void;
}

const FILTER_OPTIONS: Array<{ key: MessageViewFilter; label: string }> = [
  { key: "default", label: "default" },
  { key: "not-tool", label: "not tool" },
  { key: "user", label: "user" },
  { key: "answer", label: "answer" }
];

export function renderChatView(options: ChatViewOptions): HTMLElement {
  const container = document.createElement("section");
  container.className = `main-panel${options.timelinePinned ? " timeline-pinned" : ""}${options.timelineOpen ? " timeline-open" : ""}`;

  if (!options.descriptor) {
    container.append(createEmpty("Select a session or import files to begin."));
    return container;
  }

  const descriptor = options.descriptor;
  const session = options.session;
  const filteredMessages = session
    ? filterMessagesForView(session.messages, options.messageFilter)
    : [];

  container.append(
    renderSessionHeader({
      descriptor,
      session,
      filteredCount: filteredMessages.length,
      filter: options.messageFilter,
      pinnedKeys: options.pinnedKeys,
      favoriteKeys: options.favoriteKeys,
      favoriteMetadata: options.favoriteMetadata,
      onFilterChange: options.onFilterChange,
      onExport: options.onExport,
      onTogglePinSession: options.onTogglePinSession,
      onToggleFavoriteSession: options.onToggleFavoriteSession,
      onUpdateMetadata: options.onUpdateMetadata
    })
  );

  if (options.loading && !session) {
    container.append(createEmpty("Loading session..."));
    return container;
  }

  if (!session) {
    container.append(createEmpty("Session metadata loaded. Select again if parsing failed."));
    return container;
  }

  container.append(
    renderChatLayout({
      messages: filteredMessages,
      showToolBlocks: options.messageFilter === "default",
      timelinePinned: options.timelinePinned,
      timelineOpen: options.timelineOpen,
      onTimelineToggleOpen: options.onTimelineToggleOpen,
      onTimelineTogglePin: options.onTimelineTogglePin,
      onRenderComplete: options.onRenderComplete
    })
  );

  return container;
}

function renderSessionHeader(options: {
  descriptor: SessionDescriptor;
  session: Session | undefined;
  filteredCount: number;
  filter: MessageViewFilter;
  pinnedKeys: Set<string>;
  favoriteKeys: Set<string>;
  favoriteMetadata: Map<string, { tags: string[]; notes: string }>;
  onFilterChange: (filter: MessageViewFilter) => void;
  onExport: (session: Session, format: "json" | "md") => void;
  onTogglePinSession: (key: string) => void;
  onToggleFavoriteSession: (key: string) => void;
  onUpdateMetadata: (key: string, tags: string[], notes: string) => void;
}): HTMLElement {
  const header = document.createElement("div");
  header.className = "chat-header";

  const descriptor = options.descriptor;
  const session = options.session;

  const isPinned = options.pinnedKeys.has(descriptor.key);
  const isFavorited = options.favoriteKeys.has(descriptor.key);
  const favMeta = options.favoriteMetadata.get(descriptor.key) || { tags: [], notes: "" };

  const main = document.createElement("div");
  main.className = "chat-header-main";

  const titleRow = document.createElement("div");
  titleRow.className = "chat-title-row";

  const heading = document.createElement("div");
  heading.className = "chat-heading";

  let titleBadges = "";
  if (isPinned) {
    titleBadges += `<span class="header-badge pin-badge" title="Pinned session">📌</span>`;
  }
  if (isFavorited) {
    titleBadges += `<span class="header-badge star-badge" title="Favorited session">⭐</span>`;
  }

  heading.innerHTML = `
    <div class="eyebrow">Session Detail</div>
    <div class="chat-title-container">
      <h1 title="${escapeHtml(session?.title ?? descriptor.title)}">${escapeHtml(session?.title ?? descriptor.title)}</h1>
      ${titleBadges ? `<div class="chat-header-badges">${titleBadges}</div>` : ""}
    </div>
  `;

  titleRow.append(heading);

  const favActions = document.createElement("div");
  favActions.className = "chat-fav-actions";

  const pinToggleBtn = document.createElement("button");
  pinToggleBtn.type = "button";
  pinToggleBtn.className = `button header-fav-btn pin-btn${isPinned ? " active" : ""}`;
  pinToggleBtn.innerHTML = `📌 ${isPinned ? "Pinned" : "Pin"}`;
  pinToggleBtn.title = isPinned ? "Unpin from top" : "Pin to top";
  pinToggleBtn.addEventListener("click", () => {
    options.onTogglePinSession(descriptor.key);
  });

  const favToggleBtn = document.createElement("button");
  favToggleBtn.type = "button";
  favToggleBtn.className = `button header-fav-btn favorite-btn${isFavorited ? " active" : ""}`;
  favToggleBtn.innerHTML = `⭐ ${isFavorited ? "Favorited" : "Favorite"}`;
  favToggleBtn.title = isFavorited ? "Remove from Favorites" : "Add to Favorites";
  favToggleBtn.addEventListener("click", () => {
    options.onToggleFavoriteSession(descriptor.key);
  });

  favActions.append(pinToggleBtn, favToggleBtn);

  if (isFavorited) {
    const editTagsBtn = document.createElement("button");
    editTagsBtn.type = "button";
    editTagsBtn.className = "button header-fav-btn edit-tags-btn secondary";
    editTagsBtn.innerHTML = `🏷️ Tags`;
    editTagsBtn.title = "Edit tags and custom notes";
    editTagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = header.querySelector<HTMLElement>(".tags-edit-panel");
      if (panel) {
        const isHidden = panel.style.display === "none";
        panel.style.display = isHidden ? "block" : "none";
        if (isHidden) {
          panel.querySelector<HTMLInputElement>(".tags-input")?.focus();
        }
      }
    });
    favActions.append(editTagsBtn);
  }

  titleRow.append(favActions);

  if (session) {
    const actions = document.createElement("div");
    actions.className = "chat-actions";

    const codexCommand = buildCodexResumeCommand(session);
    if (codexCommand) {
      actions.append(createCopyResumeButton(codexCommand, "Copy Codex resume command"));
    }

    const antigravityCommand = buildAntigravityResumeCommand(session);
    if (antigravityCommand) {
      actions.append(createCopyResumeButton(antigravityCommand, "Copy Antigravity resume command"));
    }

    const claudeCommand = buildClaudeResumeCommand(session);
    if (claudeCommand) {
      actions.append(createCopyResumeButton(claudeCommand, "Copy Claude resume command"));
    }

    const copilotCommand = buildCopilotResumeCommand(session);
    if (copilotCommand) {
      actions.append(createCopyResumeButton(copilotCommand, "Copy Copilot resume command"));
    }

    const exportContainer = document.createElement("div");
    exportContainer.className = "custom-dropdown-container";
    exportContainer.style.width = "auto";

    const exportBtn = document.createElement("button");
    exportBtn.className = "button secondary custom-dropdown-trigger";
    exportBtn.type = "button";
    exportBtn.innerHTML = `
      <span class="trigger-label">Export</span>
      <span class="trigger-arrow" style="margin-left: 4px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </span>
    `;

    const exportMenu = document.createElement("div");
    exportMenu.className = "custom-dropdown-menu hidden";
    exportMenu.style.minWidth = "120px";
    exportMenu.style.right = "0";
    exportMenu.style.left = "auto";

    const jsonBtn = document.createElement("button");
    jsonBtn.type = "button";
    jsonBtn.className = "custom-dropdown-item";
    jsonBtn.textContent = "JSON";
    jsonBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.add("hidden");
      exportBtn.classList.remove("open");
      options.onExport(session, "json");
    });

    const mdBtn = document.createElement("button");
    mdBtn.type = "button";
    mdBtn.className = "custom-dropdown-item";
    mdBtn.textContent = "MD";
    mdBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.add("hidden");
      exportBtn.classList.remove("open");
      options.onExport(session, "md");
    });

    exportMenu.append(jsonBtn, mdBtn);

    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = exportMenu.classList.contains("hidden");
      
      // Close other dropdowns
      document.querySelectorAll(".custom-dropdown-menu").forEach((m) => {
        if (m !== exportMenu) {
          m.classList.add("hidden");
          m.parentElement?.querySelector(".custom-dropdown-trigger")?.classList.remove("open");
        }
      });

      exportMenu.classList.toggle("hidden", !isHidden);
      exportBtn.classList.toggle("open", isHidden);
    });

    document.addEventListener("click", () => {
      exportMenu.classList.add("hidden");
      exportBtn.classList.remove("open");
    });

    exportContainer.append(exportBtn, exportMenu);
    actions.append(exportContainer);

    titleRow.append(actions);
  }

  // Tags & Notes glassmorphic edit panel
  const tagsPanel = document.createElement("div");
  tagsPanel.className = "tags-edit-panel card glassmorphic";
  tagsPanel.style.display = "none";
  tagsPanel.innerHTML = `
    <div class="tags-panel-inner">
      <h3>🏷️ Edit Session Tags & Annotations</h3>
      <div class="tags-form-field">
        <label for="tags-input-field">Tags (comma separated)</label>
        <input type="text" id="tags-input-field" class="text-input tags-input" placeholder="e.g. bugfix, auth, template" value="${escapeHtml(favMeta.tags.join(", "))}">
      </div>
      <div class="tags-form-field">
        <label for="notes-input-field">Private Notes / Annotations</label>
        <textarea id="notes-input-field" class="text-input textarea-input notes-input" placeholder="Enter private summary, context or annotations here...">${escapeHtml(favMeta.notes)}</textarea>
      </div>
      <div class="tags-panel-actions">
        <button type="button" class="button btn-save-tags">Save Changes</button>
        <button type="button" class="button link btn-cancel-tags">Cancel</button>
      </div>
    </div>
  `;

  tagsPanel.querySelector(".btn-cancel-tags")?.addEventListener("click", () => {
    tagsPanel.style.display = "none";
  });

  tagsPanel.querySelector(".btn-save-tags")?.addEventListener("click", () => {
    const tagsInput = tagsPanel.querySelector<HTMLInputElement>(".tags-input");
    const notesInput = tagsPanel.querySelector<HTMLTextAreaElement>(".notes-input");
    const parsedTags = (tagsInput?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    options.onUpdateMetadata(descriptor.key, parsedTags, notesInput?.value || "");
    tagsPanel.style.display = "none";
  });

  main.append(titleRow, tagsPanel);

  // Render tag pills and notes in header if favorited
  if (isFavorited && (favMeta.tags.length > 0 || favMeta.notes.trim())) {
    const summaryWrapper = document.createElement("div");
    summaryWrapper.className = "header-bookmark-summary";

    const tagPills = favMeta.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("");
    const notesContent = favMeta.notes.trim() ? `<span class="note-text">📝 ${escapeHtml(favMeta.notes)}</span>` : "";

    summaryWrapper.innerHTML = `
      ${tagPills ? `<div class="summary-tags">${tagPills}</div>` : ""}
      ${notesContent ? `<div class="summary-notes">${notesContent}</div>` : ""}
    `;
    main.append(summaryWrapper);
  }



  const meta = document.createElement("div");
  meta.className = "chat-meta";

  // 1. Source
  const sourceSpan = document.createElement("span");
  sourceSpan.textContent = descriptor.source;
  meta.append(sourceSpan);

  // 2. Origin
  const originSpan = document.createElement("span");
  originSpan.textContent = descriptor.origin;
  meta.append(originSpan);

  // 3. Transport (prefixed with "remote-" for sessions from a remote agent)
  const transportSpan = document.createElement("span");
  transportSpan.textContent =
    descriptor.origin === "remote" ? `remote-${descriptor.transport}` : descriptor.transport;
  meta.append(transportSpan);

  // 3b. Connection name (which machine this session came from)
  if (descriptor.connectionLabel) {
    const connectionSpan = document.createElement("span");
    connectionSpan.className = `chat-meta-connection${
      descriptor.origin === "remote" ? " is-remote" : ""
    }`;
    connectionSpan.textContent = descriptor.connectionLabel;
    connectionSpan.title = descriptor.connectionDetail
      ? `Connection: ${descriptor.connectionLabel} (${descriptor.connectionDetail})`
      : `Connection: ${descriptor.connectionLabel}`;
    meta.append(connectionSpan);
  }

  if (session) {
    // 4. Messages count
    const msgSpan = document.createElement("span");
    msgSpan.textContent = `${options.filteredCount}/${session.messageCount} messages`;
    meta.append(msgSpan);

    // 5. CWD (Workspace)
    const cwdSpan = document.createElement("span");
    if (session.cwd) {
      const dirName = session.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? session.cwd;
      cwdSpan.textContent = dirName;
      cwdSpan.title = `${session.cwd} (Double-click to copy full path)`;
      cwdSpan.style.cursor = "pointer";
      cwdSpan.style.userSelect = "none";
      
      cwdSpan.addEventListener("dblclick", async () => {
        try {
          await copyText(session.cwd!);
          const originalText = cwdSpan.textContent;
          cwdSpan.textContent = "Copied!";
          cwdSpan.style.color = "var(--success)";
          cwdSpan.style.fontWeight = "700";
          setTimeout(() => {
            cwdSpan.textContent = originalText;
            cwdSpan.style.color = "";
            cwdSpan.style.fontWeight = "";
          }, 1200);
        } catch {
          // Fallback if clipboard API fails
        }
      });
    } else {
      cwdSpan.textContent = "cwd unavailable";
    }
    meta.append(cwdSpan);

    // 6. Started At
    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatDateTime(session.startedAt, "time unavailable");
    if (session.startedAt) {
      timeSpan.title = formatDateTimeLong(session.startedAt);
    }
    meta.append(timeSpan);
  }

  const metaRow = document.createElement("div");
  metaRow.className = "chat-meta-row";
  metaRow.append(meta);

  if (session) {
    const filterRow = document.createElement("div");
    filterRow.className = "chat-filter-row";

    const chipRow = document.createElement("div");
    chipRow.className = "filter-chip-row";

    for (const filter of FILTER_OPTIONS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `filter-chip${filter.key === options.filter ? " active" : ""}`;
      chip.textContent = filter.label;
      chip.addEventListener("click", () => {
        options.onFilterChange(filter.key);
      });
      chipRow.append(chip);
    }

    filterRow.append(chipRow);
    metaRow.append(filterRow);
  }

  main.append(titleRow, metaRow);

  header.append(main);
  return header;
}

export function buildCodexResumeCommand(session: Session): string | null {
  if (session.source !== "codex") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `codex resume ${sessionId}`;
}

export function buildAntigravityResumeCommand(session: Session): string | null {
  if (session.source !== "antigravity") {
    return null;
  }

  const cascadeId = session.metadata.cascadeId;
  if (typeof cascadeId !== "string" || !cascadeId.trim()) {
    return null;
  }

  return `agy --conversation=${cascadeId}`;
}

export function buildClaudeResumeCommand(session: Session): string | null {
  if (session.source !== "claude") {
    return null;
  }

  if (!session.primaryPath) {
    return null;
  }

  const baseName = session.primaryPath.split(/[\\/]/).pop();
  if (!baseName) {
    return null;
  }

  const projectId = baseName.replace(/\.jsonl$/i, "");
  if (!projectId.trim()) {
    return null;
  }

  return `claude --resume ${projectId}`;
}

export function buildCopilotResumeCommand(session: Session): string | null {
  if (session.source !== "copilot") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `copilot --session-id=${sessionId}`;
}

export function createCopyResumeButton(command: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  let resetTimer = 0;

  button.className = "button secondary copy-command-button icon-button";
  button.type = "button";
  button.innerHTML = clipboardIcon();
  button.title = command;
  button.setAttribute("aria-label", label);

  button.addEventListener("click", async () => {
    window.clearTimeout(resetTimer);
    button.disabled = true;
    button.dataset.state = "";
    button.innerHTML = spinnerIcon();

    try {
      await copyText(command);
      button.dataset.state = "success";
      button.innerHTML = successIcon();
    } catch {
      button.dataset.state = "error";
      button.innerHTML = errorIcon();
    }

    resetTimer = window.setTimeout(() => {
      button.disabled = false;
      button.dataset.state = "";
      button.innerHTML = clipboardIcon();
    }, 1600);
  });

  return button;
}

function clipboardIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 1.75a1.75 1.75 0 0 1 1.58 1H13A1.75 1.75 0 0 1 14.75 4.5v8A1.75 1.75 0 0 1 13 14.25H5A1.75 1.75 0 0 1 3.25 12.5v-8A1.75 1.75 0 0 1 5 2.75h1.42A1.75 1.75 0 0 1 8 1.75Zm0 1.5H8a.25.25 0 0 0-.25.25v.5h2.5v-.5A.25.25 0 0 0 10 3.25ZM5 4.25a.25.25 0 0 0-.25.25v8A.25.25 0 0 0 5 12.75h8a.25.25 0 0 0 .25-.25v-8A.25.25 0 0 0 13 4.25h-1.25v.5A.75.75 0 0 1 11 5.5H7a.75.75 0 0 1-.75-.75v-.5Z"/>
    </svg>
  `;
}

function spinnerIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.25a5.75 5.75 0 1 0 5.17 3.23.75.75 0 1 1 1.35-.66A7.25 7.25 0 1 1 8 0v2.25a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 7.25 0H8a.75.75 0 0 1 0 1.5h-.25v.75A.25.25 0 0 0 8 2.25Z"/>
    </svg>
  `;
}

function successIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06l1.97 1.97 5.47-5.47a.75.75 0 0 1 1.06 0Z"/>
    </svg>
  `;
}

function errorIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06Z"/>
    </svg>
  `;
}

function timelineIcon(): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.25a1.75 1.75 0 1 1 1.5 1.73v2.27h5a1.75 1.75 0 1 1 0 1.5h-5v2.27a1.75 1.75 0 1 1-1.5 0V3.98A1.75 1.75 0 0 1 4 2.25Zm1.5 0a.25.25 0 1 0-.5 0 .25.25 0 0 0 .5 0ZM12 6.75a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5Zm-6.5 7a.25.25 0 1 0-.5 0 .25.25 0 0 0 .5 0Z"/>
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

function renderChatLayout(options: {
  messages: Message[];
  showToolBlocks: boolean;
  timelinePinned: boolean;
  timelineOpen: boolean;
  onTimelineToggleOpen: () => void;
  onTimelineTogglePin: () => void;
  onRenderComplete?: () => void;
}): HTMLElement {
  let hoverTimeout: number | undefined;
  let leaveTimeout: number | undefined;

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

  const layout = document.createElement("div");
  layout.className = "chat-layout";

  const messageList = document.createElement("div");
  messageList.className = "chat-messages";

  const timelineDock = document.createElement("div");
  timelineDock.className = `timeline-dock${options.timelineOpen ? " open" : ""}${options.timelinePinned ? " pinned" : ""}`;

  timelineDock.addEventListener("mouseleave", () => {
    clearAllTimeouts();
    const isOpen = timelineDock.classList.contains("open");
    const isPinned = timelineDock.classList.contains("pinned");
    if (isOpen && !isPinned) {
      leaveTimeout = window.setTimeout(() => {
        options.onTimelineToggleOpen();
      }, 80);
    }
  });

  timelineDock.addEventListener("mouseenter", () => {
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = undefined;
    }
  });

  const timelineRail = document.createElement("div");
  timelineRail.className = "timeline-rail";

  const timelineToggle = document.createElement("button");
  timelineToggle.className = "rail-button";
  timelineToggle.type = "button";
  timelineToggle.title = options.timelineOpen ? "Collapse timeline" : "Open timeline";
  timelineToggle.setAttribute("aria-label", timelineToggle.title);
  timelineToggle.innerHTML = timelineIcon();

  timelineToggle.addEventListener("click", () => {
    clearAllTimeouts();
    const isOpen = timelineDock.classList.contains("open");
    if (!isOpen) {
      options.onTimelineToggleOpen();
    }
  });

  timelineToggle.addEventListener("mouseenter", () => {
    const isOpen = timelineDock.classList.contains("open");
    const isPinned = timelineDock.classList.contains("pinned");
    if (!isOpen && !isPinned) {
      hoverTimeout = window.setTimeout(() => {
        options.onTimelineToggleOpen();
      }, 50);
    }
  });

  timelineToggle.addEventListener("mouseleave", () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = undefined;
    }
  });

  timelineRail.append(timelineToggle);

  const timeline = document.createElement("aside");
  timeline.className = "timeline-panel";

  const timelineHeader = document.createElement("div");
  timelineHeader.className = "timeline-header";
  timelineHeader.innerHTML = `
    <div>
      <div class="eyebrow">Timeline</div>
      <div class="timeline-summary">Click to jump through the session.</div>
    </div>
  `;

  const timelinePin = document.createElement("button");
  timelinePin.className = `panel-icon-button${options.timelinePinned ? " active" : ""}`;
  timelinePin.type = "button";
  timelinePin.title = options.timelinePinned ? "Unpin timeline" : "Pin timeline";
  timelinePin.setAttribute("aria-label", timelinePin.title);
  timelinePin.innerHTML = pinIcon();
  timelinePin.addEventListener("click", options.onTimelineTogglePin);
  timelineHeader.append(timelinePin);

  const timelineList = document.createElement("div");
  timelineList.className = "timeline-list";
  const timelineButtons: HTMLButtonElement[] = [];

  const setActiveTimelineItem = (anchorId?: string | null) => {
    for (const button of timelineButtons) {
      button.classList.toggle("active", button.dataset.target === anchorId);
    }
  };

  const totalMessages = options.messages.length;
  let currentIndex = 0;
  const chunkSize = 10;

  function renderNextChunk() {
    // If the messageList has been disconnected, the user has navigated away, so stop rendering.
    if (currentIndex > 0 && !messageList.isConnected) {
      return;
    }

    const end = Math.min(currentIndex + chunkSize, totalMessages);
    for (let i = currentIndex; i < end; i++) {
      const message = options.messages[i];
      const anchorId = buildAnchorId(message, i);
      const messageElement = renderMessage(message, {
        anchorId,
        showToolBlocks: options.showToolBlocks
      });
      const timelineButton = renderTimelineButton(message, i, anchorId);

      timelineButton.addEventListener("click", () => {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        setActiveTimelineItem(anchorId);
      });

      timelineButtons.push(timelineButton);
      messageList.append(messageElement);
      timelineList.append(timelineButton);
    }

    if (currentIndex === 0 && timelineButtons[0]) {
      timelineButtons[0].classList.add("active");
    }

    currentIndex = end;
    if (currentIndex < totalMessages) {
      setTimeout(renderNextChunk, 0);
    } else {
      renderMermaidDiagrams(messageList).then(() => {
        if (options.onRenderComplete) {
          options.onRenderComplete();
        }
      });
      updateScrollHubState();
    }
  }

  const scrollHub = document.createElement("div");
  scrollHub.className = "scroll-helper-hub";

  const btnTop = document.createElement("button");
  btnTop.className = "scroll-btn scroll-btn-top";
  btnTop.type = "button";
  btnTop.title = "Scroll to top";
  btnTop.setAttribute("aria-label", "Scroll to top");
  btnTop.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;

  const btnBottom = document.createElement("button");
  btnBottom.className = "scroll-btn scroll-btn-bottom";
  btnBottom.type = "button";
  btnBottom.title = "Scroll to bottom";
  btnBottom.setAttribute("aria-label", "Scroll to bottom");
  btnBottom.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;

  scrollHub.append(btnTop, btnBottom);

  btnTop.addEventListener("click", () => {
    messageList.scrollTo({ top: 0, behavior: "smooth" });
  });

  btnBottom.addEventListener("click", () => {
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  });

  const updateScrollHubState = () => {
    const scrollTop = messageList.scrollTop;
    const scrollHeight = messageList.scrollHeight;
    const clientHeight = messageList.clientHeight;

    const isScrollable = scrollHeight > clientHeight + 10;

    if (!isScrollable) {
      scrollHub.classList.remove("visible");
      return;
    }

    scrollHub.classList.add("visible");
    btnTop.disabled = scrollTop <= 5;
    btnTop.classList.toggle("disabled", scrollTop <= 5);

    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    btnBottom.disabled = isAtBottom;
    btnBottom.classList.toggle("disabled", isAtBottom);
  };

  messageList.addEventListener("scroll", updateScrollHubState);

  renderNextChunk();

  timeline.append(timelineHeader, timelineList);
  timelineDock.append(timelineRail, timeline);
  layout.append(messageList, timelineDock, scrollHub);
  return layout;
}

function renderTimelineButton(
  message: Message,
  index: number,
  anchorId: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "timeline-item";
  button.type = "button";
  button.dataset.target = anchorId;

  const timelineTime = formatDisplayTime(message.createdAt, "unknown time");
  const timelineTimeTitle = formatDateTimeLong(message.createdAt);
  button.innerHTML = `
    <span class="timeline-index">${String(index + 1).padStart(2, "0")}</span>
    <span class="timeline-role-emoji" title="${escapeHtml(timelineLabel(message.role))}">${timelineEmoji(message.role)}</span>
    <strong class="timeline-preview">${escapeHtml(buildTimelinePreview(message))}</strong>
    <span class="timeline-time" title="${escapeHtml(timelineTimeTitle)}">${escapeHtml(timelineTime)}</span>
  `;

  return button;
}

function renderMessage(
  message: Message,
  options: {
    anchorId: string;
    showToolBlocks: boolean;
  }
): HTMLElement {
  const entry = document.createElement("article");
  entry.className = "log-entry";
  entry.id = options.anchorId;
  entry.setAttribute("data-message-anchor", options.anchorId);

  const header = document.createElement("div");
  header.className = "log-entry-header";
  const messageTime = formatDisplayTime(message.createdAt);
  const messageTimeTitle = formatDateTimeLong(message.createdAt);
  header.innerHTML = `
    <span class="log-role-badge ${message.role}">${escapeHtml(message.role)}</span>
    <span class="message-type">${escapeHtml(message.rawType ?? "message")}</span>
    <span class="message-time" title="${escapeHtml(messageTimeTitle)}">${escapeHtml(messageTime)}</span>
  `;

  entry.append(header);

  if (message.text.trim()) {
    const body = document.createElement("div");
    body.className = "log-content markdown-theme";
    body.append(renderMarkdown(message.text));
    entry.append(body);
  }

  if (!options.showToolBlocks) {
    return entry;
  }

  for (const toolCall of message.toolCalls ?? []) {
    const block = document.createElement("details");
    block.className = "tool-call-block";

    const summary = document.createElement("summary");
    summary.className = "tool-call-header";
    summary.textContent = `${toolCall.toolName} · ${toolCall.status}`;

    const output = document.createElement("div");
    output.className = "tool-call-output";

    if (toolCall.args?.trim()) {
      const label = document.createElement("div");
      label.className = "tool-call-label";
      label.textContent = "input";
      output.append(label);
      renderTruncatedPre(output, toolCall.args);
    }

    if (toolCall.backgroundTask) {
      output.append(renderBackgroundTask(toolCall));
    }

    if (toolCall.output?.trim()) {
      const label = document.createElement("div");
      label.className = "tool-call-label";
      label.textContent = "output";
      output.append(label);
      renderTruncatedPre(output, toolCall.output);
    }

    block.append(summary, output);
    entry.append(block);
  }

  return entry;
}

function renderBackgroundTask(toolCall: ToolCall): HTMLElement {
  const container = document.createElement("div");
  container.className = "tool-call-task";

  const header = document.createElement("div");
  header.className = "tool-call-task-header";

  const label = document.createElement("span");
  label.className = "tool-call-task-label";
  label.textContent = "background task";

  const status = document.createElement("span");
  status.className = "tool-call-task-status";
  status.textContent = toolCall.backgroundTask?.status ?? "unknown";

  header.append(label, status);
  container.append(header);

  if (toolCall.backgroundTask?.summary?.trim()) {
    const summary = document.createElement("div");
    summary.className = "tool-call-task-summary";
    summary.textContent = toolCall.backgroundTask.summary;
    container.append(summary);
  }

  if (toolCall.backgroundTask?.taskId || toolCall.backgroundTask?.outputFile) {
    const meta = document.createElement("div");
    meta.className = "tool-call-task-meta";

    if (toolCall.backgroundTask.taskId) {
      const taskId = document.createElement("div");
      taskId.className = "tool-call-task-meta-item";
      taskId.innerHTML = `task: <code>${escapeHtml(toolCall.backgroundTask.taskId)}</code>`;
      meta.append(taskId);
    }

    if (toolCall.backgroundTask.outputFile) {
      const outputFile = document.createElement("div");
      outputFile.className = "tool-call-task-meta-item";
      outputFile.innerHTML = `output file: <code>${escapeHtml(toolCall.backgroundTask.outputFile)}</code>`;
      meta.append(outputFile);
    }

    container.append(meta);
  }

  return container;
}

function createEmpty(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state empty-large";
  element.textContent = message;
  return element;
}

export function filterMessagesForView(messages: Message[], filter: MessageViewFilter): Message[] {
  switch (filter) {
    case "not-tool":
      return messages.filter(
        (message) =>
          !isToolOnlyMessage(message) &&
          message.role !== "system" &&
          message.role !== "developer"
      );
    case "user":
      return messages.filter((message) => message.role === "user");
    case "answer":
      return messages.filter((message) => message.role === "assistant");
    default:
      return messages;
  }
}

export function isToolOnlyMessage(message: Message): boolean {
  return message.role === "tool" || (!message.text.trim() && (message.toolCalls?.length ?? 0) > 0);
}

function buildAnchorId(message: Message, index: number): string {
  const normalized = `${message.id || index}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `message-${normalized}`;
}

function buildTimelinePreview(message: Message): string {
  let source = message.text.trim();
  if (source.includes("<USER_REQUEST>")) {
    const match = source.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    if (match) {
      source = match[1].trim();
    } else {
      source = source.replace(/<\/?USER_REQUEST>/gi, "").trim();
    }
  }
  if (!source) {
    source = message.toolCalls?.[0]?.toolName ?? "tool activity";
  }
  const firstLine = source.split("\n").find((line) => line.trim()) ?? source;
  return firstLine.trim().slice(0, 86) || "Empty message";
}

function timelineLabel(role: Message["role"]): string {
  if (role === "assistant") {
    return "answer";
  }

  return role;
}

function timelineEmoji(role: Message["role"]): string {
  switch (role) {
    case "user":
      return "🙂";
    case "assistant":
      return "🤖";
    case "developer":
      return "🛠️";
    case "system":
      return "⚙️";
    case "tool":
      return "🔧";
    default:
      return "•";
  }
}

function renderTruncatedPre(parent: HTMLElement, text: string): void {
  const lines = text.split("\n");
  const isLong = lines.length > 100 || text.length > 15000;

  const pre = document.createElement("pre");

  if (!isLong) {
    if (text.includes("\u001b") || text.includes("\x1b")) {
      pre.innerHTML = ansiToHtml(text);
    } else {
      pre.textContent = text;
    }
    parent.append(pre);
    return;
  }

  const truncatedText = lines.slice(0, 100).join("\n");
  if (text.includes("\u001b") || text.includes("\x1b")) {
    pre.innerHTML = ansiToHtml(truncatedText);
  } else {
    pre.textContent = truncatedText;
  }

  const toggleButton = document.createElement("button");
  toggleButton.className = "button secondary message-expand-button";
  toggleButton.type = "button";
  toggleButton.style.marginTop = "6px";
  toggleButton.style.padding = "4px 8px";
  toggleButton.style.fontSize = "11px";
  toggleButton.style.height = "auto";
  toggleButton.style.display = "inline-block";
  toggleButton.textContent = `Show full output (+${lines.length - 100} lines)`;

  let isExpanded = false;
  toggleButton.addEventListener("click", () => {
    isExpanded = !isExpanded;
    if (isExpanded) {
      if (text.includes("\u001b") || text.includes("\x1b")) {
        pre.innerHTML = ansiToHtml(text);
      } else {
        pre.textContent = text;
      }
      toggleButton.textContent = "Show less";
    } else {
      if (text.includes("\u001b") || text.includes("\x1b")) {
        pre.innerHTML = ansiToHtml(truncatedText);
      } else {
        pre.textContent = truncatedText;
      }
      toggleButton.textContent = `Show full output (+${lines.length - 100} lines)`;
      pre.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  parent.append(pre, toggleButton);
}
