import type { Message, Session, SessionDescriptor } from "../../shared/types.js";
import { getAdapter } from "../sources/registry.js";
import { renderMermaidDiagrams } from "./mermaidRender.js";
import { renderMessage } from "./messageRenderer.js";
import { clipboardIcon, errorIcon, pinIcon, spinnerIcon, successIcon, timelineIcon } from "./icons.js";
import { FILTER_OPTIONS, filterMessagesForView, getFinalAssistantMessageIds, partitionMessages, type MessageViewFilter } from "./messageFilter.js";
import { buildAnchorId, previewText, renderTimelineButton } from "./timeline.js";
import {
  copyText,
  escapeHtml,
  formatDateTime,
  formatDateTimeLong,
  formatDateTimeTitle
} from "./utils.js";

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
  previousKeys?: string[];
  onGoBack?: () => void;
}

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
      onUpdateMetadata: options.onUpdateMetadata,
      previousKeys: options.previousKeys,
      onGoBack: options.onGoBack
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
      showToolBlocks: options.messageFilter === "raw",
      isPureMode: options.messageFilter === "pure",
      timelinePinned: options.timelinePinned,
      timelineOpen: options.timelineOpen,
      onTimelineToggleOpen: options.onTimelineToggleOpen,
      onTimelineTogglePin: options.onTimelineTogglePin,
      onRenderComplete: options.onRenderComplete,
      session
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
  previousKeys?: string[];
  onGoBack?: () => void;
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

  const eyebrowDiv = document.createElement("div");
  eyebrowDiv.className = "eyebrow";
  eyebrowDiv.textContent = "Session Detail";
  heading.append(eyebrowDiv);

  const titleContainer = document.createElement("div");
  titleContainer.className = "chat-title-container";

  const titleH1 = document.createElement("h1");
  titleH1.title = session?.title ?? descriptor.title;
  titleH1.textContent = session?.title ?? descriptor.title;

  titleContainer.append(titleH1);

  if (titleBadges) {
    const badgesDiv = document.createElement("div");
    badgesDiv.className = "chat-header-badges";
    badgesDiv.innerHTML = titleBadges;
    titleContainer.append(badgesDiv);
  }

  heading.append(titleContainer);

  titleRow.append(heading);

  const favActions = document.createElement("div");
  favActions.className = "chat-fav-actions";

  const pinToggleBtn = document.createElement("button");
  pinToggleBtn.type = "button";
  pinToggleBtn.className = `button header-fav-btn ui-button ui-button--compact pin-btn${isPinned ? " active" : ""}`;
  pinToggleBtn.innerHTML = `📌 ${isPinned ? "Pinned" : "Pin"}`;
  pinToggleBtn.title = isPinned ? "Unpin from top" : "Pin to top";
  pinToggleBtn.addEventListener("click", () => {
    options.onTogglePinSession(descriptor.key);
  });

  const favToggleBtn = document.createElement("button");
  favToggleBtn.type = "button";
  favToggleBtn.className = `button header-fav-btn ui-button ui-button--compact favorite-btn${isFavorited ? " active" : ""}`;
  favToggleBtn.innerHTML = `⭐ ${isFavorited ? "Favorited" : "Favorite"}`;
  favToggleBtn.title = isFavorited ? "Remove from Favorites" : "Add to Favorites";
  favToggleBtn.addEventListener("click", () => {
    options.onToggleFavoriteSession(descriptor.key);
  });

  favActions.append(pinToggleBtn, favToggleBtn);

  if (isFavorited) {
    const editTagsBtn = document.createElement("button");
    editTagsBtn.type = "button";
    editTagsBtn.className = "button header-fav-btn edit-tags-btn ui-button ui-button--secondary ui-button--compact";
    editTagsBtn.innerHTML = `🏷️ Tags`;
    editTagsBtn.title = "Edit tags and custom notes";
    editTagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = header.querySelector<HTMLElement>(".tags-edit-panel");
      if (panel) {
        const isHidden = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !isHidden);
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

    const optionsList: { label: string; command: string }[] = [];
    const adapter = session ? getAdapter(session.source) : undefined;
    const defaultCommand = adapter?.buildResumeCommand?.(session);
    if (defaultCommand) {
      optionsList.push({ label: "Default", command: defaultCommand });
      const unsafeCommand = adapter?.buildResumeCommand?.(session, { unsafe: true });
      if (unsafeCommand && unsafeCommand !== defaultCommand) {
        optionsList.push({ label: "Unsafe", command: unsafeCommand });
      }
    }

    if (optionsList.length > 0) {
      const copyBtn = createCopyResumeButton(optionsList, "Resume");
      actions.append(copyBtn);
    }

    const exportContainer = document.createElement("div");
    exportContainer.className = "custom-dropdown-container export-dropdown-container ui-menu-root";

    const exportBtn = document.createElement("button");
    exportBtn.className = "button secondary custom-dropdown-trigger ui-button ui-button--secondary ui-menu-trigger";
    exportBtn.type = "button";
    exportBtn.innerHTML = `
      <span class="trigger-label">Export</span>
      <span class="trigger-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </span>
    `;

    const exportMenu = document.createElement("div");
    exportMenu.className = "custom-dropdown-menu ui-menu hidden";

    const jsonBtn = document.createElement("button");
    jsonBtn.type = "button";
    jsonBtn.className = "custom-dropdown-item ui-menu-item";
    jsonBtn.textContent = "JSON";
    jsonBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.add("hidden");
      exportBtn.classList.remove("open");
      options.onExport(session, "json");
    });

    const mdBtn = document.createElement("button");
    mdBtn.type = "button";
    mdBtn.className = "custom-dropdown-item ui-menu-item";
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

    const clickOutsideHandler = (e: MouseEvent) => {
      const isConnected = exportContainer.isConnected !== false;
      if (!isConnected) {
        document.removeEventListener("click", clickOutsideHandler);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!exportContainer.contains(target)) {
        exportMenu.classList.add("hidden");
        exportBtn.classList.remove("open");
      }
    };
    document.addEventListener("click", clickOutsideHandler);

    exportContainer.append(exportBtn, exportMenu);
    actions.append(exportContainer);

    titleRow.append(actions);
  }

  const tagsPanel = document.createElement("div");
  tagsPanel.className = "tags-edit-panel ui-panel hidden";
  tagsPanel.innerHTML = `
    <div class="tags-panel-inner">
      <h3>🏷️ Edit Session Tags & Annotations</h3>
      <div class="tags-form-field">
        <label for="tags-input-field">Tags (comma separated)</label>
        <input type="text" id="tags-input-field" class="text-input ui-input tags-input" placeholder="e.g. bugfix, auth, template" value="${escapeHtml(favMeta.tags.join(", "))}">
      </div>
      <div class="tags-form-field">
        <label for="notes-input-field">Private Notes / Annotations</label>
        <textarea id="notes-input-field" class="text-input ui-input ui-textarea textarea-input notes-input" placeholder="Enter private summary, context or annotations here...">${escapeHtml(favMeta.notes)}</textarea>
      </div>
      <div class="tags-panel-actions">
        <button type="button" class="button btn-save-tags ui-button ui-button--primary">Save Changes</button>
        <button type="button" class="button link btn-cancel-tags ui-button ui-button--ghost">Cancel</button>
      </div>
    </div>
  `;

  tagsPanel.querySelector(".btn-cancel-tags")?.addEventListener("click", () => {
    tagsPanel.classList.add("hidden");
  });

  tagsPanel.querySelector(".btn-save-tags")?.addEventListener("click", () => {
    const tagsInput = tagsPanel.querySelector<HTMLInputElement>(".tags-input");
    const notesInput = tagsPanel.querySelector<HTMLTextAreaElement>(".notes-input");
    const parsedTags = (tagsInput?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    options.onUpdateMetadata(descriptor.key, parsedTags, notesInput?.value || "");
    tagsPanel.classList.add("hidden");
  });

  main.append(titleRow, tagsPanel);

  // Render tag pills and notes in header if favorited
  if (isFavorited && (favMeta.tags.length > 0 || favMeta.notes.trim())) {
    const summaryWrapper = document.createElement("div");
    summaryWrapper.className = "header-bookmark-summary";

    const tagPills = favMeta.tags.map((t) => `<span class="tag-pill ui-badge">${escapeHtml(t)}</span>`).join("");
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
      cwdSpan.className = "chat-meta-copyable";
      const dirName = session.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? session.cwd;
      cwdSpan.textContent = dirName;
      cwdSpan.title = `${session.cwd} (Double-click to copy full path)`;
      
      cwdSpan.addEventListener("dblclick", async () => {
        try {
          await copyText(session.cwd!);
          const originalText = cwdSpan.textContent;
          cwdSpan.textContent = "Copied!";
          cwdSpan.classList.add("copied");
          setTimeout(() => {
            cwdSpan.textContent = originalText;
            cwdSpan.classList.remove("copied");
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

    const parentThreadId = descriptor.metadata?.parentThreadId || session?.metadata?.parentThreadId;
    const hasHistory = options.previousKeys && options.previousKeys.length > 0;

    if (parentThreadId || hasHistory) {
      const backLink = document.createElement("a");
      backLink.className = "parent-session-backlink md-link";

      if (parentThreadId) {
        backLink.href = `session://${parentThreadId}`;
        backLink.title = "Go back to parent session";
        backLink.textContent = "← Parent Session";
      } else {
        backLink.classList.add("history-back-link");
        backLink.href = "#";
        backLink.title = "Go back to previous session";
        backLink.textContent = "← Back";
        backLink.addEventListener("click", (e) => {
          e.preventDefault();
          options.onGoBack?.();
        });
      }

      const separator = document.createElement("span");
      separator.className = "parent-link-separator";
      separator.innerHTML = "|";

      filterRow.append(backLink, separator);
    }

    const chipRow = document.createElement("div");
    chipRow.className = "filter-chip-row";

    for (const filter of FILTER_OPTIONS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `filter-chip ui-chip${filter.key === options.filter ? " active" : ""}`;
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

export function createCopyResumeButton(
  commandOrOptions: string | (() => string) | { label: string; command: string }[],
  label: string
): HTMLElement {
  if (typeof commandOrOptions === "string" || typeof commandOrOptions === "function") {
    const button = document.createElement("button");
    let resetTimer = 0;

    button.className = "button secondary copy-command-button icon-button ui-button ui-button--secondary";
    button.type = "button";
    button.innerHTML = clipboardIcon();

    const getCommand = typeof commandOrOptions === "function" ? commandOrOptions : () => commandOrOptions;
    button.title = getCommand();
    button.setAttribute("aria-label", label);

    button.addEventListener("click", async () => {
      window.clearTimeout(resetTimer);
      button.disabled = true;
      button.dataset.state = "loading";
      button.innerHTML = spinnerIcon();

      try {
        await copyText(getCommand());
        button.dataset.state = "success";
        button.innerHTML = successIcon();
      } catch {
        button.dataset.state = "error";
        button.innerHTML = errorIcon();
      }

      resetTimer = window.setTimeout(() => {
        button.disabled = false;
        delete button.dataset.state;
        button.innerHTML = clipboardIcon();
      }, 1600);
    });

    return button;
  }

  // Handle options list
  if (commandOrOptions.length === 1) {
    const button = document.createElement("button");
    let resetTimer = 0;

    button.className = "button secondary copy-command-button ui-button ui-button--secondary";
    button.type = "button";
    
    const opt = commandOrOptions[0];
    const defaultInner = renderCopyButtonContent(clipboardIcon(), label);
    button.innerHTML = defaultInner;
    button.title = opt.command;

    button.addEventListener("click", async () => {
      window.clearTimeout(resetTimer);
      button.disabled = true;
      button.dataset.state = "loading";
      button.innerHTML = renderCopyButtonContent(spinnerIcon(), "Copying...");

      try {
        await copyText(opt.command);
        button.dataset.state = "success";
        button.innerHTML = renderCopyButtonContent(successIcon(), "Copied!");
      } catch {
        button.dataset.state = "error";
        button.innerHTML = renderCopyButtonContent(errorIcon(), "Error!");
      }

      resetTimer = window.setTimeout(() => {
        button.disabled = false;
        delete button.dataset.state;
        button.innerHTML = defaultInner;
      }, 1600);
    });

    return button;
  }

  // Multiple options: act as a dropdown
  const container = document.createElement("div");
  container.className = "custom-dropdown-container copy-command-dropdown-container ui-menu-root";

  const triggerBtn = document.createElement("button");
  triggerBtn.className = "button secondary custom-dropdown-trigger copy-command-dropdown-trigger ui-button ui-button--secondary ui-menu-trigger";
  triggerBtn.type = "button";
  
  const defaultInner = renderCopyButtonContent(clipboardIcon(), label, true);
  triggerBtn.innerHTML = defaultInner;

  const menu = document.createElement("div");
  menu.className = "custom-dropdown-menu ui-menu hidden";

  let resetTimer = 0;

  for (const opt of commandOrOptions) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-dropdown-item ui-menu-item";
    item.textContent = opt.label;
    item.title = opt.command;

    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.classList.add("hidden");
      triggerBtn.classList.remove("open");

      window.clearTimeout(resetTimer);
      triggerBtn.disabled = true;
      triggerBtn.dataset.state = "loading";
      triggerBtn.innerHTML = renderCopyButtonContent(spinnerIcon(), "Copying...", true);

      try {
        await copyText(opt.command);
        triggerBtn.dataset.state = "success";
        triggerBtn.innerHTML = renderCopyButtonContent(successIcon(), "Copied!", true);
      } catch {
        triggerBtn.dataset.state = "error";
        triggerBtn.innerHTML = renderCopyButtonContent(errorIcon(), "Error!", true);
      }

      resetTimer = window.setTimeout(() => {
        triggerBtn.disabled = false;
        delete triggerBtn.dataset.state;
        triggerBtn.innerHTML = defaultInner;
      }, 1600);
    });

    menu.append(item);
  }

  triggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.contains("hidden");

    // Close other dropdowns
    document.querySelectorAll(".custom-dropdown-menu").forEach((m) => {
      if (m !== menu) {
        m.classList.add("hidden");
        m.parentElement?.querySelector(".custom-dropdown-trigger")?.classList.remove("open");
      }
    });

    menu.classList.toggle("hidden", !isHidden);
    triggerBtn.classList.toggle("open", isHidden);
  });

  const clickOutsideHandler = (e: MouseEvent) => {
    const isConnected = container.isConnected !== false;
    if (!isConnected) {
      document.removeEventListener("click", clickOutsideHandler);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (!container.contains(target)) {
      menu.classList.add("hidden");
      triggerBtn.classList.remove("open");
    }
  };
  document.addEventListener("click", clickOutsideHandler);

  container.append(triggerBtn, menu);
  return container;
}

function renderCopyButtonContent(icon: string, label: string, showArrow = false): string {
  return `
    <span class="trigger-icon">${icon}</span>
    <span class="trigger-label">${label}</span>
    ${showArrow ? `
      <span class="trigger-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </span>
    ` : ""}
  `;
}

function renderCommentaryGroup(
  block: { type: "commentary-group"; messages: Array<{ message: Message; index: number }> },
  options: {
    showToolBlocks: boolean;
    session?: Session;
  }
): HTMLElement {
  const groupElement = document.createElement("article");
  groupElement.className = "log-entry collapsed-commentary-group ui-panel";

  const trigger = document.createElement("div");
  trigger.className = "commentary-collapse-trigger";

  const icon = document.createElement("span");
  icon.className = "commentary-icon";
  icon.textContent = "🤖";

  const label = document.createElement("span");
  label.className = "commentary-label";
  label.textContent = `Thinking / Commentary (${block.messages.length} steps)`;

  const firstMsg = block.messages[0].message;
  const citationRegex = /<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>/i;
  const previewTextContent = firstMsg.text.replace(citationRegex, "").trim();
  const preview = document.createElement("span");
  preview.className = "commentary-preview";
  preview.textContent = previewText(previewTextContent, 70);

  const arrow = document.createElement("span");
  arrow.className = "commentary-arrow";
  arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

  trigger.append(icon, label, preview, arrow);
  groupElement.append(trigger);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "commentary-content-wrapper hidden";

  block.messages.forEach(({ message, index }) => {
    const msgElement = renderMessage(message, {
      anchorId: buildAnchorId(message, index),
      showToolBlocks: options.showToolBlocks,
      session: options.session,
      collapsed: false
    });
    msgElement.classList.add("commentary-group-inner-item");
    contentWrapper.append(msgElement);
  });

  groupElement.append(contentWrapper);

  trigger.addEventListener("click", () => {
    const isHidden = contentWrapper.classList.contains("hidden");
    contentWrapper.classList.toggle("hidden", !isHidden);
    trigger.classList.toggle("expanded", isHidden);
  });

  return groupElement;
}

function renderChatLayout(options: {
  messages: Message[];
  showToolBlocks: boolean;
  isPureMode?: boolean;
  timelinePinned: boolean;
  timelineOpen: boolean;
  onTimelineToggleOpen: () => void;
  onTimelineTogglePin: () => void;
  onRenderComplete?: () => void;
  session?: Session;
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

  const isPureMode = options.isPureMode ?? false;
  const finalAssistantIds = isPureMode ? getFinalAssistantMessageIds(options.messages) : new Set<string>();

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
  timelineToggle.className = "rail-button ui-icon-button";
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
  timelinePin.className = `panel-icon-button ui-icon-button${options.timelinePinned ? " active" : ""}`;
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

  const blocks = partitionMessages(options.messages, isPureMode, finalAssistantIds);
  const totalBlocks = blocks.length;
  let currentIndex = 0;
  const chunkSize = 10;

  function renderNextChunk() {
    // If the messageList has been disconnected, the user has navigated away, so stop rendering.
    if (currentIndex > 0 && !messageList.isConnected) {
      return;
    }

    const end = Math.min(currentIndex + chunkSize, totalBlocks);
    for (let i = currentIndex; i < end; i++) {
      const block = blocks[i];
      if (block.type === "message") {
        const message = block.message;
        const anchorId = buildAnchorId(message, block.index);
        const messageElement = renderMessage(message, {
          anchorId,
          showToolBlocks: options.showToolBlocks,
          session: options.session
        });
        const timelineButton = renderTimelineButton(message, block.index, anchorId);

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
      } else {
        const groupElement = renderCommentaryGroup(block, {
          showToolBlocks: options.showToolBlocks,
          session: options.session
        });
        messageList.append(groupElement);

        block.messages.forEach(({ message, index }) => {
          const anchorId = buildAnchorId(message, index);
          const timelineButton = renderTimelineButton(message, index, anchorId);

          timelineButton.addEventListener("click", () => {
            const contentWrapper = groupElement.querySelector(".commentary-content-wrapper");
            if (contentWrapper && contentWrapper.classList.contains("hidden")) {
              contentWrapper.classList.remove("hidden");
              const trigger = groupElement.querySelector(".commentary-collapse-trigger");
              if (trigger) {
                trigger.classList.add("expanded");
              }
            }

            const innerItem = groupElement.querySelector(`#${anchorId}`);
            if (innerItem) {
              innerItem.scrollIntoView({
                behavior: "smooth",
                block: "start"
              });
            }
            setActiveTimelineItem(anchorId);
          });

          timelineButtons.push(timelineButton);
          timelineList.append(timelineButton);
        });
      }
    }

    if (currentIndex === 0 && timelineButtons[0]) {
      timelineButtons[0].classList.add("active");
    }

    currentIndex = end;
    if (currentIndex < totalBlocks) {
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
  btnTop.className = "scroll-btn scroll-btn-top ui-icon-button";
  btnTop.type = "button";
  btnTop.title = "Scroll to top";
  btnTop.setAttribute("aria-label", "Scroll to top");
  btnTop.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;

  const btnBottom = document.createElement("button");
  btnBottom.className = "scroll-btn scroll-btn-bottom ui-icon-button";
  btnBottom.type = "button";
  btnBottom.title = "Scroll to bottom";
  btnBottom.setAttribute("aria-label", "Scroll to bottom");
  btnBottom.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;

  scrollHub.append(btnTop, btnBottom);

  btnTop.addEventListener("click", () => {
    messageList.scrollTo({ top: 0, behavior: "smooth" });
  });

  btnBottom.addEventListener("click", () => {
    const lastMessage = messageList.lastElementChild as HTMLElement;
    if (lastMessage) {
      const lastMessageScrollTop = messageList.scrollTop + (lastMessage.getBoundingClientRect().top - messageList.getBoundingClientRect().top);
      const targetScrollTop = lastMessageScrollTop - 20;

      if (messageList.scrollTop < targetScrollTop - 5) {
        lastMessage.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
      }
    } else {
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    }
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

function createEmpty(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state empty-large";
  element.textContent = message;
  return element;
}
