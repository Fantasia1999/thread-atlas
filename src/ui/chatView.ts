import type { Message, Session, SessionDescriptor } from "../parsers/types.js";
import { renderMarkdown } from "./markdown.js";
import {
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

  const filteredMessages = filterMessages(session.messages, options.messageFilter);

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

function filterMessages(messages: Message[], filter: MessageViewFilter): Message[] {
  switch (filter) {
    case "not-tool":
      return messages.filter((message) => message.role !== "tool");
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
