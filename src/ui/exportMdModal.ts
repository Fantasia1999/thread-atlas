import type { Message, Session } from "../parsers/types.js";
import { renderMarkdown } from "./markdown.js";
import { escapeHtml } from "./utils.js";
import { type MessageViewFilter, filterMessagesForView } from "./chatView.js";

interface ExportMdModalOptions {
  session: Session;
  onClose: () => void;
  onExport: (filename: string, markdownContent: string) => void;
}

export function createExportMdModal(options: ExportMdModalOptions): HTMLElement {
  const { session } = options;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card modal-wide";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Export Markdown</p>
      <h2>Select messages to export</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

  const body = document.createElement("div");
  body.className = "modal-body";

  // Setup state
  let currentFilter: MessageViewFilter = "default";
  // Store checked state by message ID
  const checkedIds = new Set<string>(session.messages.map((m) => m.id));

  // 1. Filter Row
  const filterRow = document.createElement("div");
  filterRow.className = "export-filter-row";

  const filterChips = document.createElement("div");
  filterChips.className = "export-filter-chips";

  const filters: Array<{ key: MessageViewFilter; label: string }> = [
    { key: "default", label: "default" },
    { key: "not-tool", label: "not tool" },
    { key: "user", label: "user" },
    { key: "answer", label: "answer" }
  ];

  const chipButtons: HTMLButtonElement[] = [];

  const updateFiltersUI = () => {
    for (const btn of chipButtons) {
      btn.classList.toggle("active", btn.dataset.filter === currentFilter);
    }
  };

  filters.forEach((f) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "export-filter-chip";
    chip.textContent = f.label;
    chip.dataset.filter = f.key;
    if (f.key === currentFilter) {
      chip.classList.add("active");
    }
    chip.addEventListener("click", () => {
      currentFilter = f.key;
      updateFiltersUI();
      renderMessageList();
    });
    filterChips.append(chip);
    chipButtons.push(chip);
  });

  const bulkActions = document.createElement("div");
  bulkActions.className = "export-bulk-actions";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.className = "button secondary";
  selectAllBtn.textContent = "Select All";
  selectAllBtn.addEventListener("click", () => {
    const filtered = filterMessagesForView(session.messages, currentFilter);
    filtered.forEach((m) => checkedIds.add(m.id));
    renderMessageList();
  });

  const deselectAllBtn = document.createElement("button");
  deselectAllBtn.type = "button";
  deselectAllBtn.className = "button secondary";
  deselectAllBtn.textContent = "Deselect All";
  deselectAllBtn.addEventListener("click", () => {
    const filtered = filterMessagesForView(session.messages, currentFilter);
    filtered.forEach((m) => checkedIds.delete(m.id));
    renderMessageList();
  });

  bulkActions.append(selectAllBtn, deselectAllBtn);
  filterRow.append(filterChips, bulkActions);

  // 2. Scrollable Selector List
  const messageListContainer = document.createElement("div");
  messageListContainer.className = "export-message-list";

  const renderMessageList = () => {
    messageListContainer.replaceChildren();
    const filtered = filterMessagesForView(session.messages, currentFilter);

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No messages match this filter.";
      messageListContainer.append(empty);
      return;
    }

    filtered.forEach((message, index) => {
      const originalIndex = session.messages.findIndex((m) => m.id === message.id);
      const isChecked = checkedIds.has(message.id);

      const item = document.createElement("div");
      item.className = "export-message-item";

      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "export-message-checkbox-label";
      checkboxLabel.style.display = "flex";
      checkboxLabel.style.alignItems = "center";
      checkboxLabel.style.gap = "8px";
      checkboxLabel.style.cursor = "pointer";
      checkboxLabel.style.userSelect = "none";
      checkboxLabel.style.marginTop = "2px";
      checkboxLabel.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "export-message-checkbox";
      checkbox.checked = isChecked;
      checkbox.style.margin = "0";
      checkbox.style.cursor = "pointer";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          checkedIds.add(message.id);
        } else {
          checkedIds.delete(message.id);
        }
      });

      const idxSpan = document.createElement("span");
      idxSpan.className = "export-message-index";
      idxSpan.textContent = String(originalIndex + 1).padStart(2, "0");

      checkboxLabel.append(checkbox, idxSpan);
      item.append(checkboxLabel);

      const contentWrapper = document.createElement("div");
      contentWrapper.className = "export-message-content-wrapper";

      const itemHeader = document.createElement("div");
      itemHeader.className = "export-message-header";

      const roleBadge = document.createElement("span");
      roleBadge.className = `export-message-role-badge ${message.role}`;
      roleBadge.textContent = `${getRoleEmoji(message.role)} ${message.role}`;

      const previewSpan = document.createElement("strong");
      previewSpan.className = "export-message-preview";
      previewSpan.textContent = buildTimelinePreview(message);

      const chevron = document.createElement("span");
      chevron.className = "export-message-chevron";
      chevron.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><polyline points="6 9 12 15 18 9"></polyline></svg>
      `;

      itemHeader.append(roleBadge, previewSpan, chevron);

      const detailsDiv = document.createElement("div");
      detailsDiv.className = "export-message-details markdown-theme";
      
      if (message.text.trim()) {
        detailsDiv.append(renderMarkdown(message.text));
      } else if (message.toolCalls && message.toolCalls.length > 0) {
        const toolCallsDiv = document.createElement("div");
        toolCallsDiv.style.fontFamily = "var(--font-mono)";
        toolCallsDiv.style.fontSize = "11px";
        toolCallsDiv.innerHTML = message.toolCalls.map(t => 
          `<div>🛠️ <strong>${escapeHtml(t.toolName)}</strong> (${escapeHtml(t.status)})</div>`
        ).join("");
        detailsDiv.append(toolCallsDiv);
      } else {
        detailsDiv.textContent = "Empty message";
      }

      contentWrapper.append(itemHeader, detailsDiv);

      contentWrapper.addEventListener("click", () => {
        item.classList.toggle("expanded");
      });

      item.append(contentWrapper);
      messageListContainer.append(item);
    });
  };

  // 3. Filename row
  const filenameRow = document.createElement("div");
  filenameRow.className = "export-filename-row";

  const filenameLabel = document.createElement("label");
  filenameLabel.textContent = "Export Filename Preview";

  const filenamePreview = document.createElement("div");
  filenamePreview.className = "export-filename-preview";

  const workspaceName = getWorkspaceName(session);
  const hashId = getSessionHashId(session);
  
  // Format current time for filename
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${year}${month}${day}-${hours}${minutes}${seconds}`;

  const safeWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeWorkspaceName}_${hashId}_${timeStr}.md`;
  
  filenamePreview.textContent = filename;

  filenameRow.append(filenameLabel, filenamePreview);

  body.append(filterRow, messageListContainer, filenameRow);

  // 4. Footer
  const footer = document.createElement("div");
  footer.className = "export-modal-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", options.onClose);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "button primary";
  exportBtn.textContent = "Export MD";
  exportBtn.addEventListener("click", () => {
    // Generate Markdown for the checked messages matching the current filter scope
    const filtered = filterMessagesForView(session.messages, currentFilter);
    const selected = filtered.filter((m) => checkedIds.has(m.id));
    if (selected.length === 0) {
      alert("Please select at least one message to export.");
      return;
    }
    const mdContent = generateMarkdown(session, selected, currentFilter);
    options.onExport(filename, mdContent);
  });

  footer.append(cancelBtn, exportBtn);

  card.append(header, body, footer);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  // Initial render
  renderMessageList();

  return overlay;
}

// Helpers
function getRoleEmoji(role: Message["role"]): string {
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
  return firstLine.trim().slice(0, 80) || "Empty message";
}

function getWorkspaceName(session: Session): string {
  const rawWorkspace = 
    session.metadata?.cwd || 
    session.cwd ||
    session.metadata?.directory ||
    session.metadata?.primaryWorkspace;

  if (typeof rawWorkspace === "string" && rawWorkspace.trim()) {
    const fullPath = rawWorkspace.trim();
    const parts = fullPath.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? fullPath;
  }

  const pathStr = session.primaryPath || "";
  const claudeMatch = pathStr.match(/[\\/]\.claude[\\/]projects[\\/]([^\\/]+)/i);
  if (claudeMatch && claudeMatch[1]) {
    return claudeMatch[1];
  }

  return "workspace";
}

function getSessionHashId(session: Session): string {
  const pathStr = session.primaryPath || "";
  const idStr = session.id || "";
  
  const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  const pathUuidMatch = pathStr.match(uuidRegex);
  if (pathUuidMatch) {
    return pathUuidMatch[0];
  }
  const idUuidMatch = idStr.match(uuidRegex);
  if (idUuidMatch) {
    return idUuidMatch[0];
  }

  const filename = pathStr.split(/[\\/]/).filter(Boolean).at(-1) || idStr;
  return filename.replace(/\.[^.]+$/, "");
}

function generateMarkdown(session: Session, selectedMessages: Message[], filter: MessageViewFilter): string {
  let md = `# ${session.title}\n\n`;
  
  if (session.summary?.trim()) {
    md += `> ${session.summary.trim()}\n\n`;
  }
  
  md += `## Metadata\n`;
  md += `- **Source**: ${session.source}\n`;
  if (session.cwd) {
    md += `- **Workspace CWD**: \`${session.cwd}\`\n`;
  }
  if (session.startedAt) {
    md += `- **Started At**: ${session.startedAt}\n`;
  }
  if (session.updatedAt) {
    md += `- **Updated At**: ${session.updatedAt}\n`;
  }
  md += `\n---\n\n`;
  
  md += `## Messages\n\n`;
  
  for (const msg of selectedMessages) {
    const roleUpper = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    const timeStr = msg.createdAt ? ` - ${new Date(msg.createdAt).toLocaleString()}` : "";
    md += `### 💬 ${roleUpper}${timeStr}\n\n`;
    
    if (msg.text.trim()) {
      md += `${msg.text.trim()}\n\n`;
    }
    
    // Standalone tool calls are only exported if the filter is "default"
    if (filter === "default" && msg.toolCalls && msg.toolCalls.length > 0) {
      md += `#### 🛠️ Tool Calls\n\n`;
      for (const tool of msg.toolCalls) {
        md += `##### **${tool.toolName}** \`[${tool.status}]\`\n`;
        if (tool.args?.trim()) {
          md += `* **Input**:\n\`\`\`json\n${tool.args.trim()}\n\`\`\`\n`;
        }
        if (tool.output?.trim()) {
          md += `* **Output**:\n\`\`\`\n${tool.output.trim()}\n\`\`\`\n`;
        }
        md += `\n`;
      }
    }
    
    md += `\n---\n\n`;
  }
  
  return md;
}
