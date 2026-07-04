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

  const closeDropdown = () => {
    const dropdown = overlay.querySelector(".filename-config-dropdown");
    if (dropdown) {
      dropdown.classList.remove("open");
    }
  };

  const handleClose = () => {
    document.removeEventListener("click", closeDropdown);
    options.onClose();
  };

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
  closeButton.addEventListener("click", handleClose);
  header.append(closeButton);

  const body = document.createElement("div");
  body.className = "modal-body";

  // Setup state
  let currentFilter: MessageViewFilter = "pure";
  // Store checked state by message ID
  const checkedIds = new Set<string>(filterMessagesForView(session.messages, currentFilter).map((m) => m.id));

  // 1. Filter Row
  const filterRow = document.createElement("div");
  filterRow.className = "export-filter-row";

  const filterChips = document.createElement("div");
  filterChips.className = "export-filter-chips";

  const filters: Array<{ key: MessageViewFilter; label: string }> = [
    { key: "pure", label: "pure" },
    { key: "raw", label: "raw" },
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
  let filenameConfig = loadFilenameConfig();

  const filenameRow = document.createElement("div");
  filenameRow.className = "export-filename-row";

  // Create preview header container
  const filenamePreviewHeader = document.createElement("div");
  filenamePreviewHeader.className = "filename-preview-header";

  const filenameLabel = document.createElement("label");
  filenameLabel.textContent = "Export Filename Preview";

  // Create dropdown container
  const configContainer = document.createElement("div");
  configContainer.className = "filename-config-container";

  const configTrigger = document.createElement("button");
  configTrigger.type = "button";
  configTrigger.className = "button secondary xs filename-config-trigger";
  configTrigger.textContent = "⚙️ Configure";

  const configDropdown = document.createElement("div");
  configDropdown.className = "filename-config-dropdown";

  const configList = document.createElement("div");
  configList.className = "filename-config-list";

  configDropdown.append(configList);
  configContainer.append(configTrigger, configDropdown);
  filenamePreviewHeader.append(filenameLabel, configContainer);

  const filenamePreview = document.createElement("div");
  filenamePreview.className = "export-filename-preview";

  // Toggle dropdown
  configTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    configDropdown.classList.toggle("open");
  });

  // Prevent dropdown closing when clicking inside it
  configDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("click", closeDropdown);

  // Pre-calculate values
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${year}${month}${day}-${hours}${minutes}${seconds}`;

  const resolvedValues: Record<string, string> = {
    workspace: getWorkspaceName(session),
    agentname: session.source || "unknown",
    title: (session.title || "untitled").slice(0, 40),
    "session-id": getSessionHashId(session),
    timestamp: timeStr
  };

  const getElementLabel = (id: string): string => {
    switch (id) {
      case "workspace": return "Workspace Directory";
      case "agentname": return "Agent Name";
      case "title": return "Title";
      case "session-id": return "Session ID";
      case "timestamp": return "Current Timestamp";
      default: return id;
    }
  };

  let activeFilename = "";
  const updateFilenamePreview = () => {
    const parts = filenameConfig
      .filter(item => item.enabled)
      .map(item => sanitizeSegment(resolvedValues[item.id]))
      .filter(Boolean);
    
    if (parts.length === 0) {
      activeFilename = "session.md";
    } else {
      activeFilename = `${parts.join("_")}.md`;
    }
    filenamePreview.textContent = activeFilename;
  };

  const renderConfigList = () => {
    configList.replaceChildren();
    filenameConfig.forEach((item, index) => {
      const container = document.createElement("div");
      container.className = "filename-config-item";

      const leftSide = document.createElement("div");
      leftSide.className = "filename-config-item-left";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.enabled;
      checkbox.addEventListener("change", () => {
        item.enabled = checkbox.checked;
        saveFilenameConfig(filenameConfig);
        updateFilenamePreview();
      });

      const labelText = document.createElement("span");
      labelText.textContent = getElementLabel(item.id);

      const valPreview = document.createElement("span");
      valPreview.className = "filename-config-item-preview";
      valPreview.textContent = sanitizeSegment(resolvedValues[item.id]) || "(empty)";

      leftSide.append(checkbox, labelText, valPreview);

      const rightSide = document.createElement("div");
      rightSide.className = "filename-config-item-right";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "filename-config-btn";
      upBtn.textContent = "↑";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => {
        if (index > 0) {
          const temp = filenameConfig[index];
          filenameConfig[index] = filenameConfig[index - 1];
          filenameConfig[index - 1] = temp;
          saveFilenameConfig(filenameConfig);
          renderConfigList();
          updateFilenamePreview();
        }
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "filename-config-btn";
      downBtn.textContent = "↓";
      downBtn.disabled = index === filenameConfig.length - 1;
      downBtn.addEventListener("click", () => {
        if (index < filenameConfig.length - 1) {
          const temp = filenameConfig[index];
          filenameConfig[index] = filenameConfig[index + 1];
          filenameConfig[index + 1] = temp;
          saveFilenameConfig(filenameConfig);
          renderConfigList();
          updateFilenamePreview();
        }
      });

      rightSide.append(upBtn, downBtn);
      container.append(leftSide, rightSide);
      configList.append(container);
    });
  };

  renderConfigList();
  updateFilenamePreview();

  filenameRow.append(filenamePreviewHeader, filenamePreview);

  body.append(filterRow, messageListContainer, filenameRow);

  // 4. Footer
  const footer = document.createElement("div");
  footer.className = "export-modal-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", handleClose);

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
    options.onExport(activeFilename, mdContent);
  });

  footer.append(cancelBtn, exportBtn);

  card.append(header, body, footer);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      handleClose();
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
    
    // Standalone tool calls are only exported if the filter is "raw"
    if (filter === "raw" && msg.toolCalls && msg.toolCalls.length > 0) {
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

interface FilenameElementConfig {
  id: "workspace" | "agentname" | "title" | "session-id" | "timestamp";
  enabled: boolean;
}

const STORAGE_KEY = "thread-atlas:export-filename-config";

const DEFAULT_CONFIG: FilenameElementConfig[] = [
  { id: "workspace", enabled: true },
  { id: "agentname", enabled: true },
  { id: "title", enabled: true },
  { id: "session-id", enabled: true },
  { id: "timestamp", enabled: true }
];

function sanitizeSegment(val: string): string {
  if (!val) return "";
  return val
    .replace(/[^\p{L}\p{N}_-]/gu, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function loadFilenameConfig(): FilenameElementConfig[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validIds = new Set(DEFAULT_CONFIG.map(item => item.id));
        const filtered = parsed.filter((item: any) => item && validIds.has(item.id));
        const presentIds = new Set(filtered.map((item: any) => item.id));
        for (const defItem of DEFAULT_CONFIG) {
          if (!presentIds.has(defItem.id)) {
            filtered.push(defItem);
          }
        }
        return filtered;
      }
    }
  } catch (e) {
    console.error("Failed to load filename config", e);
  }
  return [...DEFAULT_CONFIG.map(item => ({ ...item }))];
}

function saveFilenameConfig(config: FilenameElementConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save filename config", e);
  }
}

