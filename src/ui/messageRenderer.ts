import type { Message, Session, ToolCall } from "../../shared/types.js";
import { renderMarkdown } from "./markdown.js";
import { previewText } from "./timeline.js";
import { clipboardIcon, errorIcon, successIcon } from "./icons.js";
import { ansiToHtml, copyRichText, copyText, escapeHtml, formatDateTimeLong, formatDisplayTime } from "./utils.js";

export function renderMessage(
  message: Message,
  options: {
    anchorId: string;
    showToolBlocks: boolean;
    collapsed?: boolean;
    session?: Session;
  }
): HTMLElement {
  const entry = document.createElement("article");
  entry.className = "log-entry ui-panel";
  entry.id = options.anchorId;
  entry.setAttribute("data-message-anchor", options.anchorId);

  if (message.subagentNotification) {
    entry.classList.add("subagent-notification-entry");
    
    const notify = message.subagentNotification;
    
    // Header
    const cardHeader = document.createElement("div");
    cardHeader.className = "subagent-notification-header";
    
    const badge = document.createElement("span");
    badge.className = "subagent-badge ui-badge";
    badge.innerHTML = `<span>Subagent Event</span>`;
    
    const statusPill = document.createElement("span");
    statusPill.className = `subagent-status-pill ui-badge ${notify.status}`;
    statusPill.textContent = notify.status;
    
    cardHeader.append(badge);
    entry.append(cardHeader);

    // Meta/Info Row
    const infoRow = document.createElement("div");
    infoRow.className = "subagent-info-row";
    
    const idLabel = document.createElement("span");
    idLabel.className = "subagent-id-label";
    idLabel.innerHTML = `ID: <code>${escapeHtml(notify.agentPath)}</code>`;
    
    const link = document.createElement("a");
    link.className = "subagent-session-link md-link";
    link.href = `session://${notify.agentPath}`;
    link.innerHTML = `View Session`;
    
    infoRow.append(idLabel, link);
    entry.append(infoRow);
    
    // Content / Report
    if (notify.content?.trim()) {
      const contentBox = document.createElement("div");
      contentBox.className = "subagent-notification-content log-content markdown-theme";
      contentBox.append(renderMarkdown(notify.content));
      entry.append(contentBox);
      cardHeader.append(createMessageCopyActions(notify.content, contentBox));
    }
    cardHeader.append(statusPill);
    
    // Add timestamps
    const footer = document.createElement("div");
    footer.className = "subagent-notification-footer";
    const messageTime = formatDisplayTime(message.createdAt);
    const messageTimeTitle = formatDateTimeLong(message.createdAt);
    footer.innerHTML = `
      <span class="message-time" title="${escapeHtml(messageTimeTitle)}">${escapeHtml(messageTime)}</span>
    `;
    entry.append(footer);
    
    return entry;
  }

  const text = message.text.trim();
  const citationRegex = /<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>/i;
  const citationMatch = text.match(citationRegex);

  let displayHTML: DocumentFragment | null = null;
  let citationElement: HTMLElement | null = null;
  let markdownSource = message.text;

  if (citationMatch) {
    const mainText = text.replace(citationRegex, "").trim();
    markdownSource = mainText;
    if (mainText) {
      displayHTML = renderMarkdown(mainText);
    }

    const citationContent = citationMatch[1];
    const entriesMatch = citationContent.match(/<citation_entries>([\s\S]*?)<\/citation_entries>/i);
    const idsMatch = citationContent.match(/<rollout_ids>([\s\S]*?)<\/rollout_ids>/i);

    const entries: Array<{ file: string; note: string }> = [];
    if (entriesMatch) {
      const lines = entriesMatch[1].split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const partMatch = line.match(/^([^|]+)(?:\|note=\[(.*)\])?$/);
        if (partMatch) {
          entries.push({
            file: partMatch[1].trim(),
            note: (partMatch[2] || "").trim()
          });
        }
      }
    }

    const rolloutIds = idsMatch
      ? idsMatch[1].split("\n").map(id => id.trim()).filter(Boolean)
      : [];

    if (entries.length > 0 || rolloutIds.length > 0) {
      citationElement = document.createElement("details");
      citationElement.className = "citation-block";
      citationElement.setAttribute("open", "");

      const summary = document.createElement("summary");
      summary.className = "citation-header";

      const iconSpan = document.createElement("span");
      iconSpan.className = "citation-icon";
      iconSpan.textContent = "🏷️";

      const titleSpan = document.createElement("span");
      titleSpan.className = "citation-title";
      titleSpan.textContent = `Memory Citations (${entries.length})`;

      summary.append(iconSpan, titleSpan);

      const body = document.createElement("div");
      body.className = "citation-body";

      if (entries.length > 0) {
        const list = document.createElement("ul");
        list.className = "citation-entries-list";
        for (const entryItem of entries) {
          const li = document.createElement("li");

          let fileHref = "";
          const lineMatch = entryItem.file.match(/^([^:]+)(?::(\d+)(?:-(\d+))?)?$/);
          if (lineMatch) {
            const rawFile = lineMatch[1];
            const startLine = lineMatch[2];
            const endLine = lineMatch[3];
            let pathPart = rawFile;
            if (options.session && options.session.source === "codex") {
              pathPart = `~/.codex/memories/${rawFile}`;
            } else if (options.session && options.session.cwd) {
              const cleanCwd = options.session.cwd.replace(/[/\\]+$/, "");
              const cleanFile = rawFile.replace(/^[/\\]+/, "");
              pathPart = `${cleanCwd}/${cleanFile}`;
            }
            let normalizedPath = pathPart.replace(/\\/g, "/");
            if (!normalizedPath.startsWith("/") && !normalizedPath.startsWith("~")) {
              normalizedPath = "/" + normalizedPath;
            }
            fileHref = `file://${normalizedPath}`;
            if (startLine) {
              if (endLine) {
                fileHref += `#L${startLine}-L${endLine}`;
              } else {
                fileHref += `#L${startLine}`;
              }
            }
          }

          const fileLink = document.createElement("a");
          fileLink.className = "md-link citation-file";
          fileLink.href = fileHref || "#";
          fileLink.textContent = entryItem.file;
          li.append(fileLink);

          if (entryItem.note) {
            const noteSpan = document.createElement("span");
            noteSpan.className = "citation-note";
            noteSpan.textContent = entryItem.note;
            li.append(noteSpan);
          }
          list.append(li);
        }
        body.append(list);
      }

      if (rolloutIds.length > 0) {
        const rolloutsDiv = document.createElement("div");
        rolloutsDiv.className = "citation-rollouts";
        const label = document.createElement("span");
        label.className = "rollouts-label";
        label.textContent = "Rollout IDs: ";
        rolloutsDiv.append(label);

        const code = document.createElement("code");
        code.textContent = rolloutIds.join(", ");
        rolloutsDiv.append(code);
        body.append(rolloutsDiv);
      }

      citationElement.append(summary, body);
    }
  } else if (text) {
    displayHTML = renderMarkdown(text);
  }

  if (options.collapsed) {
    entry.classList.add("collapsed-commentary-entry");

    const trigger = document.createElement("div");
    trigger.className = "commentary-collapse-trigger";

    const icon = document.createElement("span");
    icon.className = "commentary-icon";
    icon.textContent = "🤖";

    const label = document.createElement("span");
    label.className = "commentary-label";
    label.textContent = "Thinking / Commentary";

    const previewTextContent = text.replace(citationRegex, "").trim();
    const preview = document.createElement("span");
    preview.className = "commentary-preview";
    preview.textContent = previewText(previewTextContent, 70);

    const arrow = document.createElement("span");
    arrow.className = "commentary-arrow";
    arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    trigger.append(icon, label, preview, arrow);
    entry.append(trigger);

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "commentary-content-wrapper hidden";

    const header = document.createElement("div");
    header.className = "log-entry-header";
    const messageTime = formatDisplayTime(message.createdAt);
    const messageTimeTitle = formatDateTimeLong(message.createdAt);
    header.innerHTML = `
      <span class="log-role-badge ui-badge ${message.role}">${escapeHtml(message.role)}</span>
      <span class="message-type">${escapeHtml(message.rawType ?? "message")}</span>
      <span class="message-time" title="${escapeHtml(messageTimeTitle)}">${escapeHtml(messageTime)}</span>
    `;
    contentWrapper.append(header);

    if (displayHTML) {
      const body = document.createElement("div");
      body.className = "log-content markdown-theme";
      body.append(displayHTML);
      contentWrapper.append(body);
      header.append(createMessageCopyActions(markdownSource, body));
    }

    if (citationElement) {
      contentWrapper.append(citationElement);
    }
    entry.append(contentWrapper);

    trigger.addEventListener("click", () => {
      const isHidden = contentWrapper.classList.contains("hidden");
      contentWrapper.classList.toggle("hidden", !isHidden);
      trigger.classList.toggle("expanded", isHidden);
    });

    return entry;
  }

  const header = document.createElement("div");
  header.className = "log-entry-header";
  const messageTime = formatDisplayTime(message.createdAt);
  const messageTimeTitle = formatDateTimeLong(message.createdAt);
  header.innerHTML = `
    <span class="log-role-badge ui-badge ${message.role}">${escapeHtml(message.role)}</span>
    <span class="message-type">${escapeHtml(message.rawType ?? "message")}</span>
    <span class="message-time" title="${escapeHtml(messageTimeTitle)}">${escapeHtml(messageTime)}</span>
  `;

  entry.append(header);

  if (displayHTML) {
    const body = document.createElement("div");
    body.className = "log-content markdown-theme";
    body.append(displayHTML);
    entry.append(body);
    header.append(createMessageCopyActions(markdownSource, body));
  }

  if (citationElement) {
    entry.append(citationElement);
  }

  if (!options.showToolBlocks) {
    return entry;
  }

  for (const toolCall of message.toolCalls ?? []) {
    const block = document.createElement("details");
    block.className = "tool-call-block ui-panel";

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

function createMessageCopyActions(markdownSource: string, content: HTMLElement): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "message-copy-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Copy message content");

  actions.append(
    createMessageCopyButton("MD", "Copy Markdown source", () => copyText(markdownSource)),
    createMessageCopyButton("Rich", "Copy rendered rich text", () => copyRichText(content))
  );
  return actions;
}

function createMessageCopyButton(label: string, title: string, copy: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  let resetTimer = 0;
  const defaultContent = `${clipboardIcon()}<span>${label}</span>`;

  button.type = "button";
  button.className = "message-copy-button ui-chip";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = defaultContent;

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    window.clearTimeout(resetTimer);
    button.disabled = true;

    try {
      await copy();
      button.dataset.state = "success";
      button.innerHTML = `${successIcon()}<span>${label}</span>`;
    } catch {
      button.dataset.state = "error";
      button.innerHTML = `${errorIcon()}<span>${label}</span>`;
    }

    resetTimer = window.setTimeout(() => {
      button.disabled = false;
      delete button.dataset.state;
      button.innerHTML = defaultContent;
    }, 1600);
  });

  return button;
}

function renderBackgroundTask(toolCall: ToolCall): HTMLElement {
  const container = document.createElement("div");
  container.className = "tool-call-task ui-panel";

  const header = document.createElement("div");
  header.className = "tool-call-task-header";

  const label = document.createElement("span");
  label.className = "tool-call-task-label";
  label.textContent = "background task";

  const status = document.createElement("span");
  status.className = "tool-call-task-status ui-badge";
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
  toggleButton.className = "button secondary message-expand-button ui-button ui-button--secondary ui-button--compact";
  toggleButton.type = "button";
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
