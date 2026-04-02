import type { Message, Session, SessionDescriptor } from "../parsers/types.js";
import { renderMarkdown } from "./markdown.js";
import {
  copyText,
  escapeHtml,
  formatDateTime,
  formatDateTimeTitle,
  formatDisplayTime
} from "./utils.js";

export type MessageViewFilter = "default" | "not-tool" | "user" | "answer";

interface ChatViewOptions {
  descriptor?: SessionDescriptor;
  session?: Session;
  loading: boolean;
  messageFilter: MessageViewFilter;
  onFilterChange: (filter: MessageViewFilter) => void;
  onExport: (session: Session) => void;
}

const FILTER_OPTIONS: Array<{ key: MessageViewFilter; label: string }> = [
  { key: "default", label: "default" },
  { key: "not-tool", label: "not tool" },
  { key: "user", label: "user" },
  { key: "answer", label: "answer" }
];

export function renderChatView(options: ChatViewOptions): HTMLElement {
  const container = document.createElement("section");
  container.className = "main-panel";

  if (!options.descriptor) {
    container.append(createEmpty("Select a session or import files to begin."));
    return container;
  }

  const descriptor = options.descriptor;
  const session = options.session;

  container.append(renderSessionHeader(descriptor, session, options.onExport));

  if (options.loading && !session) {
    container.append(createEmpty("Loading session..."));
    return container;
  }

  if (!session) {
    container.append(createEmpty("Session metadata loaded. Select again if parsing failed."));
    return container;
  }

  const filteredMessages = filterMessagesForView(session.messages, options.messageFilter);

  container.append(renderInfoStrip(session, filteredMessages.length));
  container.append(
    renderToolbar({
      filter: options.messageFilter,
      onChange: options.onFilterChange
    })
  );
  container.append(renderChatLayout(filteredMessages, options.messageFilter === "default"));

  return container;
}

function renderSessionHeader(
  descriptor: SessionDescriptor,
  session: Session | undefined,
  onExport: (session: Session) => void
): HTMLElement {
  const header = document.createElement("div");
  header.className = "chat-header";

  const heading = document.createElement("div");
  heading.className = "chat-heading";
  heading.innerHTML = `
    <div class="eyebrow">Session Detail</div>
    <h1>${escapeHtml(session?.title ?? descriptor.title)}</h1>
    <div class="chat-meta">
      <span>${descriptor.source}</span>
      <span>${descriptor.origin}</span>
      <span>${descriptor.transport}</span>
      <span>${escapeHtml(descriptor.primaryPath)}</span>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "chat-actions";

  if (session) {
    const resumeCommand = buildCodexResumeCommand(session);
    if (resumeCommand) {
      actions.append(createCopyResumeButton(resumeCommand));
    }

    const exportButton = document.createElement("button");
    exportButton.className = "button secondary";
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", () => {
      onExport(session);
    });
    actions.append(exportButton);
  }

  header.append(heading, actions);
  return header;
}

function buildCodexResumeCommand(session: Session): string | null {
  if (session.source !== "codex") {
    return null;
  }

  const sessionId = session.metadata.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return `codex resume ${sessionId}`;
}

function createCopyResumeButton(command: string): HTMLButtonElement {
  const button = document.createElement("button");
  let resetTimer = 0;

  button.className = "button secondary copy-command-button icon-button";
  button.type = "button";
  button.innerHTML = clipboardIcon();
  button.title = command;
  button.setAttribute("aria-label", "Copy Codex resume command");

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

function renderInfoStrip(session: Session, filteredCount: number): HTMLElement {
  const infoStrip = document.createElement("div");
  infoStrip.className = "info-strip";

  const startedAt = formatDateTime(session.startedAt, "time unavailable");
  infoStrip.innerHTML = `
    <span>${filteredCount}/${session.messageCount} messages</span>
    <span>${escapeHtml(session.cwd ?? "cwd unavailable")}</span>
    <span>${escapeHtml(startedAt)}</span>
  `;

  return infoStrip;
}

function renderChatLayout(messages: Message[], showToolBlocks: boolean): HTMLElement {
  const layout = document.createElement("div");
  layout.className = "chat-layout";

  const messageList = document.createElement("div");
  messageList.className = "chat-messages";

  const timeline = document.createElement("aside");
  timeline.className = "timeline-panel";

  const timelineHeader = document.createElement("div");
  timelineHeader.className = "timeline-header";
  timelineHeader.innerHTML = `
    <div class="eyebrow">Timeline</div>
    <div class="timeline-summary">Click to jump through the session.</div>
  `;

  const timelineList = document.createElement("div");
  timelineList.className = "timeline-list";
  const timelineButtons: HTMLButtonElement[] = [];

  const setActiveTimelineItem = (anchorId?: string | null) => {
    for (const button of timelineButtons) {
      button.classList.toggle("active", button.dataset.target === anchorId);
    }
  };

  for (const [index, message] of messages.entries()) {
    const anchorId = buildAnchorId(message, index);
    const messageElement = renderMessage(message, {
      anchorId,
      showToolBlocks
    });
    const timelineButton = renderTimelineButton(message, index, anchorId);

    timelineButton.addEventListener("click", () => {
      messageElement.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      setActiveTimelineItem(anchorId);
    });

    timelineButtons.push(timelineButton);
    messageList.append(messageElement);
    timelineList.append(timelineButton);
  }

  if (timelineButtons[0]) {
    timelineButtons[0].classList.add("active");
  }

  timeline.append(timelineHeader, timelineList);
  layout.append(messageList, timeline);
  return layout;
}

function renderToolbar(options: {
  filter: MessageViewFilter;
  onChange: (filter: MessageViewFilter) => void;
}): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "chat-toolbar";

  const title = document.createElement("div");
  title.className = "toolbar-title";
  title.textContent = "Message filter";

  const chipRow = document.createElement("div");
  chipRow.className = "filter-chip-row";

  for (const filter of FILTER_OPTIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `filter-chip${filter.key === options.filter ? " active" : ""}`;
    chip.textContent = filter.label;
    chip.addEventListener("click", () => {
      options.onChange(filter.key);
    });
    chipRow.append(chip);
  }

  toolbar.append(title, chipRow);
  return toolbar;
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
  const timelineTimeTitle = formatDateTimeTitle(message.createdAt);
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
  const messageTimeTitle = formatDateTimeTitle(message.createdAt);
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
      const pre = document.createElement("pre");
      pre.textContent = toolCall.args;
      output.append(label, pre);
    }

    if (toolCall.output?.trim()) {
      const label = document.createElement("div");
      label.className = "tool-call-label";
      label.textContent = "output";
      const pre = document.createElement("pre");
      pre.textContent = toolCall.output;
      output.append(label, pre);
    }

    block.append(summary, output);
    entry.append(block);
  }

  return entry;
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
      return messages.filter((message) => !isToolOnlyMessage(message));
    case "user":
      return messages.filter((message) => message.role === "user");
    case "answer":
      return messages.filter(
        (message) => message.role === "assistant" || message.role === "developer"
      );
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
  const source = message.text.trim() || (message.toolCalls?.[0]?.toolName ?? "tool activity");
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
