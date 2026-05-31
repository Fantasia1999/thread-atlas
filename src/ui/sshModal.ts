import type { SessionSource } from "../parsers/types.js";
import { escapeHtml, formatLocalDateTime } from "./utils.js";

const SAVED_SSH_SERVERS_STORAGE_KEY = "thread-atlas-saved-ssh-servers";

interface RemoteSessionEntry {
  path: string;
  source: SessionSource;
  kind: "file" | "directory";
  size?: number;
  mtimeMs?: number;
}

interface SshFormValues {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
}

interface SavedSshServer extends SshFormValues {
  id: string;
  updatedAt: number;
}

interface SshModalOptions {
  onClose: () => void;
  onSynced: () => Promise<void> | void;
  authHeaders?: Record<string, string>;
}

export function createSshModal(options: SshModalOptions): HTMLElement {
  const authHeaders = options.authHeaders ?? {};
  let savedServers = loadSavedServers();
  const selectedSavedIds = new Set(savedServers.map((server) => server.id));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card modal-wide";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">SSH Sync</p>
      <h2>Scan remote sessions</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

  // Tab Header
  const tabHeader = document.createElement("div");
  tabHeader.className = "modal-tabs";
  tabHeader.innerHTML = `
    <button class="tab-btn active" data-tab="saved" type="button">📂 Saved Connections</button>
    <button class="tab-btn" data-tab="configure" type="button">⚙️ New Connection</button>
    <button class="tab-btn" data-tab="results" id="tab-results-btn" type="button">📡 Discovered Sessions</button>
  `;

  // Tab 1: Saved Connections panel
  const tabSavedContent = document.createElement("div");
  tabSavedContent.className = "tab-content active";

  const savedSection = document.createElement("section");
  savedSection.className = "saved-server-panel";

  const savedSectionHeader = document.createElement("div");
  savedSectionHeader.className = "section-header";
  savedSectionHeader.innerHTML = `
    <div>
      <h3>Saved servers</h3>
      <p class="section-note">Stored only in this browser. Checked items can be synced together.</p>
    </div>
  `;

  const savedActions = document.createElement("div");
  savedActions.className = "section-actions";

  const saveCurrentButton = button("Save current", "secondary");
  const syncSavedButton = button("Sync checked", "primary");
  savedActions.append(saveCurrentButton, syncSavedButton);

  const savedStatus = document.createElement("div");
  savedStatus.className = "saved-status-inline";
  savedStatus.textContent = "Select saved connections to sync in batch.";

  const savedList = document.createElement("div");
  savedList.className = "saved-server-list";

  savedSection.append(savedSectionHeader, savedActions, savedStatus, savedList);
  tabSavedContent.append(savedSection);

  // Tab 2: New Connection config form
  const tabConfigureContent = document.createElement("div");
  tabConfigureContent.className = "tab-content";

  const form = document.createElement("div");
  form.className = "form-grid";
  form.innerHTML = `
    <div class="auth-mode-selector field-span-2">
      <button class="auth-mode-btn active" data-mode="password" type="button">🔑 Password Auth</button>
      <button class="auth-mode-btn" data-mode="privateKey" type="button">🔒 Private Key Auth</button>
    </div>
    <label>
      <span>Host</span>
      <input class="text-input" name="host" placeholder="example.com" />
    </label>
    <label>
      <span>Port</span>
      <input class="text-input" name="port" type="number" value="22" />
    </label>
    <label>
      <span>Username</span>
      <input class="text-input" name="username" placeholder="root" />
    </label>
    <label>
      <span>Password</span>
      <input class="text-input" name="password" type="password" />
    </label>
    <label class="field-span-2">
      <span>Private key</span>
      <textarea class="text-area" name="privateKey" rows="5" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
    </label>
    <label>
      <span>Passphrase</span>
      <input class="text-input" name="passphrase" type="password" />
    </label>
  `;

  const status = document.createElement("div");
  status.className = "status-inline status-info";
  status.textContent = "Fill host and username, then test or scan.";

  const controls = document.createElement("div");
  controls.className = "button-row";

  const testButton = button("Test connection", "secondary");
  const scanButton = button("Scan remote", "");
  controls.append(testButton, scanButton);

  const formScrollContainer = document.createElement("div");
  formScrollContainer.className = "form-scroll-container";
  formScrollContainer.append(form);

  tabConfigureContent.append(formScrollContainer, status, controls);

  // Tab 3: Discovered Sessions browser
  const tabResultsContent = document.createElement("div");
  tabResultsContent.className = "tab-content";

  const resultsToolbar = document.createElement("div");
  resultsToolbar.className = "results-toolbar";

  const searchInput = document.createElement("input");
  searchInput.className = "text-input search-input";
  searchInput.placeholder = "🔍 Search remote paths...";

  const selectAllLabel = document.createElement("label");
  selectAllLabel.className = "select-all-label";
  selectAllLabel.innerHTML = `
    <input type="checkbox" checked />
    <span>Select All</span>
  `;
  const selectAllCheckbox = selectAllLabel.querySelector("input") as HTMLInputElement;

  const sourceFilterContainer = document.createElement("div");
  sourceFilterContainer.className = "source-filter-pills";

  resultsToolbar.append(searchInput, selectAllLabel, sourceFilterContainer);

  const resultsList = document.createElement("div");
  resultsList.className = "remote-results empty-state";
  resultsList.textContent = "No remote scan results yet.";

  const resultsFooter = document.createElement("div");
  resultsFooter.className = "results-footer";
  
  const resultsStatus = document.createElement("div");
  resultsStatus.className = "results-status-inline";
  resultsStatus.textContent = "Scan remote sessions first.";

  const inlineSyncButton = button("Sync Selected", "primary");
  inlineSyncButton.disabled = true;
  
  resultsFooter.append(resultsStatus, inlineSyncButton);
  tabResultsContent.append(resultsToolbar, resultsList, resultsFooter);

  card.append(header, tabHeader, tabSavedContent, tabConfigureContent, tabResultsContent);
  overlay.append(card);

  // States
  let activeTab: "saved" | "configure" | "results" = "saved";
  let activeAuthMode: "password" | "privateKey" = "password";
  let files: RemoteSessionEntry[] = [];
  const selected = new Set<string>();
  let activeSourceFilter: string | null = null;
  let searchText = "";

  // Functions
  function switchTab(tab: "saved" | "configure" | "results") {
    activeTab = tab;
    tabHeader.querySelectorAll(".tab-btn").forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("active", isTarget);
    });
    tabSavedContent.classList.toggle("active", tab === "saved");
    tabConfigureContent.classList.toggle("active", tab === "configure");
    tabResultsContent.classList.toggle("active", tab === "results");
  }

  function updateAuthFieldsVisibility(mode: "password" | "privateKey") {
    activeAuthMode = mode;
    const passwordLabel = form.querySelector('[name="password"]')?.closest("label") as HTMLElement | null;
    const privateKeyLabel = form.querySelector('[name="privateKey"]')?.closest("label") as HTMLElement | null;
    const passphraseLabel = form.querySelector('[name="passphrase"]')?.closest("label") as HTMLElement | null;

    form.querySelectorAll(".auth-mode-btn").forEach((btn) => {
      const isTarget = btn.getAttribute("data-mode") === mode;
      btn.classList.toggle("active", isTarget);
    });

    if (mode === "password") {
      if (passwordLabel) passwordLabel.style.display = "";
      if (privateKeyLabel) privateKeyLabel.style.display = "none";
      if (passphraseLabel) passphraseLabel.style.display = "none";
    } else {
      if (passwordLabel) passwordLabel.style.display = "none";
      if (privateKeyLabel) privateKeyLabel.style.display = "";
      if (passphraseLabel) passphraseLabel.style.display = "";
    }
  }

  function updateStatus(message: string, type: "info" | "success" | "error" | "loading" = "info") {
    status.className = `status-inline status-${type}`;
    status.innerHTML = "";
    
    let icon = "⚙️";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "❌";
    if (type === "loading") icon = "⏳";
    
    const iconSpan = document.createElement("span");
    iconSpan.className = "status-icon";
    iconSpan.textContent = icon;
    
    const textSpan = document.createElement("span");
    textSpan.textContent = message;
    
    status.append(iconSpan, textSpan);
  }

  const SUPPORTED_SOURCES = ["copilot", "claude", "antigravity", "codex", "gemini", "opencode"];
  function renderSourcePills() {
    sourceFilterContainer.replaceChildren();

    const allPill = document.createElement("button");
    allPill.className = `filter-pill ${activeSourceFilter === null ? "active" : ""}`;
    allPill.textContent = "All";
    allPill.type = "button";
    allPill.addEventListener("click", () => {
      activeSourceFilter = null;
      renderSourcePills();
      renderFilteredResults();
    });
    sourceFilterContainer.append(allPill);

    for (const src of SUPPORTED_SOURCES) {
      const pill = document.createElement("button");
      pill.className = `filter-pill ${activeSourceFilter === src ? "active" : ""} filter-pill-${src}`;
      pill.textContent = src;
      pill.type = "button";
      pill.addEventListener("click", () => {
        activeSourceFilter = src;
        renderSourcePills();
        renderFilteredResults();
      });
      sourceFilterContainer.append(pill);
    }
  }

  function renderFilteredResults(): void {
    resultsList.className = "remote-results";
    resultsList.replaceChildren();

    const filteredFiles = files.filter((file) => {
      const matchSource = !activeSourceFilter || file.source === activeSourceFilter;
      const matchText = !searchText || file.path.toLowerCase().includes(searchText.toLowerCase());
      return matchSource && matchText;
    });

    if (filteredFiles.length === 0) {
      resultsList.className = "remote-results empty-state";
      resultsList.textContent = files.length === 0 
        ? "No sessions found in known remote scan roots."
        : "No results match the current filters.";
      inlineSyncButton.disabled = true;
      return;
    }

    const allFilteredSelected = filteredFiles.every((file) => selected.has(file.path));
    const noneFilteredSelected = filteredFiles.every((file) => !selected.has(file.path));
    
    selectAllCheckbox.checked = allFilteredSelected && filteredFiles.length > 0;
    selectAllCheckbox.indeterminate = !allFilteredSelected && !noneFilteredSelected;

    for (const file of filteredFiles) {
      const row = document.createElement("label");
      row.className = `remote-row ${selected.has(file.path) ? "selected" : ""}`;
      
      const sourceClass = `source-badge ${file.source}`;
      
      row.innerHTML = `
        <input type="checkbox" ${selected.has(file.path) ? "checked" : ""} />
        <div class="remote-row-content">
          <div class="remote-row-top">
            <span class="${sourceClass}">${file.source}</span>
            <span class="kind-badge">${file.kind === "directory" ? "📁 dir" : "📄 file"}</span>
            <span class="mtime-badge">${escapeHtml(formatTimestampLabel(file.mtimeMs))}</span>
          </div>
          <div class="remote-path">${escapeHtml(file.path)}</div>
        </div>
      `;

      const checkbox = row.querySelector("input") as HTMLInputElement;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(file.path);
          row.classList.add("selected");
        } else {
          selected.delete(file.path);
          row.classList.remove("selected");
        }
        
        const allSel = filteredFiles.every((f) => selected.has(f.path));
        const noneSel = filteredFiles.every((f) => !selected.has(f.path));
        selectAllCheckbox.checked = allSel;
        selectAllCheckbox.indeterminate = !allSel && !noneSel;
        
        inlineSyncButton.disabled = selected.size === 0;
      });

      resultsList.append(row);
    }

    inlineSyncButton.disabled = selected.size === 0;
  }

  function resetResults(message: string): void {
    files = [];
    selected.clear();
    inlineSyncButton.disabled = true;
    resultsList.className = "remote-results empty-state";
    resultsList.textContent = message;
  }

  function readCredentialsForm(): SshFormValues {
    const creds = readCredentials(form);
    if (activeAuthMode === "password") {
      creds.privateKey = "";
      creds.passphrase = "";
    } else {
      creds.password = "";
    }
    return creds;
  }

  // Event wiring
  tabHeader.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest(".tab-btn");
    if (!btn) return;
    const tab = btn.getAttribute("data-tab") as "saved" | "configure" | "results";
    if (tab) switchTab(tab);
  });

  form.querySelector(".auth-mode-selector")?.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest(".auth-mode-btn");
    if (!btn) return;
    const mode = btn.getAttribute("data-mode") as "password" | "privateKey";
    if (mode) updateAuthFieldsVisibility(mode);
  });

  // Save current server to localStorage
  saveCurrentButton.addEventListener("click", () => {
    try {
      const server = rememberServer(readCredentialsForm());
      savedStatus.className = "saved-status-inline status-success";
      savedStatus.textContent = `Saved ${formatServerLabel(server)} in this browser.`;
    } catch (error) {
      savedStatus.className = "saved-status-inline status-error";
      savedStatus.textContent = error instanceof Error ? error.message : "Failed to save server.";
    }
  });

  // Batch sync checked servers
  syncSavedButton.addEventListener("click", async () => {
    const servers = savedServers.filter((server) => selectedSavedIds.has(server.id));
    if (servers.length === 0) {
      savedStatus.className = "saved-status-inline status-error";
      savedStatus.textContent = "Select at least one saved server to sync.";
      return;
    }

    syncSavedButton.disabled = true;
    saveCurrentButton.disabled = true;
    savedStatus.className = "saved-status-inline status-loading";

    let checkedServers = 0;
    let emptyServers = 0;
    let syncedServers = 0;
    let totalSelections = 0;
    let totalDownloads = 0;
    const errors: string[] = [];

    for (const server of servers) {
      checkedServers += 1;
      savedStatus.textContent = `Syncing saved server ${checkedServers}/${servers.length}: ${formatServerLabel(server)}...`;

      try {
        const scanPayload = await postJson("/api/ssh/scan", server, authHeaders);
        if (!scanPayload.ok || !Array.isArray(scanPayload.files)) {
          throw new Error(asErrorMessage(scanPayload.error, "Remote scan failed."));
        }

        const remoteFiles = scanPayload.files as RemoteSessionEntry[];
        if (remoteFiles.length === 0) {
          emptyServers += 1;
          rememberServer(server);
          continue;
        }

        const syncPayload = await postJson("/api/ssh/sync", {
          ...server,
          files: remoteFiles
        }, authHeaders);
        if (!syncPayload.ok) {
          throw new Error(asErrorMessage(syncPayload.error, "Remote sync failed."));
        }

        totalSelections += remoteFiles.length;
        totalDownloads += Array.isArray(syncPayload.downloaded) ? syncPayload.downloaded.length : 0;
        syncedServers += 1;
        rememberServer(server);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Remote sync failed.";
        errors.push(`${formatServerLabel(server)}: ${message}`);
      }
    }

    if (totalDownloads > 0) {
      await options.onSynced();
    }

    syncSavedButton.disabled = false;
    saveCurrentButton.disabled = false;

    if (errors.length === 0 && totalDownloads > 0) {
      savedStatus.className = "saved-status-inline status-success";
      savedStatus.textContent =
        `Synced ${syncedServers} saved servers, downloaded ${totalDownloads} files.`;
      
      setTimeout(() => {
        options.onClose();
      }, 1500);
      return;
    }

    if (errors.length === 0) {
      savedStatus.className = "saved-status-inline";
      savedStatus.textContent =
        emptyServers === servers.length
          ? "No sessions found in the selected saved servers."
          : `Checked ${servers.length} saved servers with no downloadable changes.`;
      return;
    }

    savedStatus.className = "saved-status-inline status-error";
    savedStatus.textContent = errors.join(" | ");
  });

  // Test current connection
  testButton.addEventListener("click", async () => {
    updateStatus("Testing SSH connection...", "loading");
    testButton.disabled = true;
    scanButton.disabled = true;
    try {
      const credentials = readCredentialsForm();
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/test", credentials, authHeaders);
      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Connection test failed."));
      }
      rememberServer(credentials);
      updateStatus("SSH connection succeeded.", "success");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Connection test failed.";
      updateStatus(msg, "error");
    } finally {
      testButton.disabled = false;
      scanButton.disabled = false;
    }
  });

  // Scan remote server
  scanButton.addEventListener("click", async () => {
    updateStatus("Scanning remote sessions...", "loading");
    scanButton.disabled = true;
    testButton.disabled = true;
    try {
      const credentials = readCredentialsForm();
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/scan", credentials, authHeaders);
      if (!payload.ok || !Array.isArray(payload.files)) {
        throw new Error(asErrorMessage(payload.error, "Remote scan failed."));
      }

      files = payload.files as RemoteSessionEntry[];
      selected.clear();
      for (const file of files) {
        selected.add(file.path);
      }

      rememberServer(credentials);
      
      activeSourceFilter = null;
      searchText = "";
      searchInput.value = "";
      renderSourcePills();
      renderFilteredResults();
      
      updateStatus(`Found ${files.length} remote session item${files.length === 1 ? "" : "s"}.`, "success");
      resultsStatus.textContent = `Found ${files.length} items. Select which ones to sync.`;
      
      switchTab("results");
    } catch (error) {
      resetResults("Remote scan failed.");
      const msg = error instanceof Error ? error.message : "Remote scan failed.";
      updateStatus(msg, "error");
      resultsStatus.textContent = msg;
    } finally {
      scanButton.disabled = false;
      testButton.disabled = false;
    }
  });

  // Sync selected results
  inlineSyncButton.addEventListener("click", async () => {
    const selectedFiles = files.filter((file) => selected.has(file.path));
    if (selectedFiles.length === 0) {
      resultsStatus.textContent = "Select at least one remote session item to sync.";
      return;
    }

    resultsStatus.textContent = "Downloading selected remote sessions...";
    inlineSyncButton.disabled = true;
    try {
      const credentials = readCredentialsForm();
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/sync", {
        ...credentials,
        files: selectedFiles
      }, authHeaders);

      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Remote sync failed."));
      }

      rememberServer(credentials);
      const downloadedCount = Array.isArray(payload.downloaded) ? payload.downloaded.length : 0;
      
      resultsStatus.textContent = `Downloaded ${downloadedCount} file${downloadedCount === 1 ? "" : "s"} from ${selectedFiles.length} remote selections.`;
      updateStatus(`Successfully synced ${downloadedCount} file${downloadedCount === 1 ? "" : "s"}!`, "success");
      
      await options.onSynced();
      setTimeout(() => {
        options.onClose();
      }, 1500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Remote sync failed.";
      resultsStatus.textContent = msg;
      updateStatus(msg, "error");
      inlineSyncButton.disabled = false;
    }
  });

  // Search input listeners
  searchInput.addEventListener("input", () => {
    searchText = searchInput.value.trim();
    renderFilteredResults();
  });

  // Select all action
  selectAllCheckbox.addEventListener("change", () => {
    const isChecked = selectAllCheckbox.checked;
    const filteredFiles = files.filter((file) => {
      const matchSource = !activeSourceFilter || file.source === activeSourceFilter;
      const matchText = !searchText || file.path.toLowerCase().includes(searchText.toLowerCase());
      return matchSource && matchText;
    });

    for (const file of filteredFiles) {
      if (isChecked) {
        selected.add(file.path);
      } else {
        selected.delete(file.path);
      }
    }
    renderFilteredResults();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  // Initialize visibility & saved servers list
  updateAuthFieldsVisibility("password");
  renderSavedServers();

  return overlay;

  function renderSavedServers(): void {
    savedList.replaceChildren();

    if (savedServers.length === 0) {
      savedList.className = "saved-server-list empty-state";
      savedList.textContent = "No saved servers yet.";
      syncSavedButton.disabled = true;
      return;
    }

    savedList.className = "saved-server-list";

    for (const server of savedServers) {
      const row = document.createElement("div");
      row.className = "saved-server-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedSavedIds.has(server.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedSavedIds.add(server.id);
        } else {
          selectedSavedIds.delete(server.id);
        }
        syncSavedButton.disabled = selectedSavedIds.size === 0;
      });

      const content = document.createElement("div");
      content.className = "saved-server-content";
      content.innerHTML = `
        <div class="saved-server-top">
          <strong class="saved-server-title">${escapeHtml(formatServerLabel(server))}</strong>
          <span>${escapeHtml(formatServerAuth(server))}</span>
          <span>${escapeHtml(formatLocalDateTime(server.updatedAt, "saved recently"))}</span>
        </div>
        <div class="saved-server-meta">${escapeHtml(formatServerSummary(server))}</div>
      `;

      const actions = document.createElement("div");
      actions.className = "saved-server-actions";

      const loadButton = button("Load", "ghost");
      loadButton.addEventListener("click", () => {
        applyCredentials(form, server);
        const mode = server.privateKey?.trim() ? "privateKey" : "password";
        updateAuthFieldsVisibility(mode);
        resetResults("No remote scan results yet.");
        updateStatus(`Loaded ${formatServerLabel(server)}.`, "success");
        switchTab("configure");
      });

      const deleteButton = button("Delete", "ghost");
      deleteButton.addEventListener("click", () => {
        selectedSavedIds.delete(server.id);
        savedServers = savedServers.filter((entry) => entry.id !== server.id);
        writeSavedServers(savedServers);
        renderSavedServers();
        savedStatus.className = "saved-status-inline";
        savedStatus.textContent = `Removed ${formatServerLabel(server)} from saved servers.`;
      });

      actions.append(loadButton, deleteButton);
      row.append(checkbox, content, actions);
      savedList.append(row);
    }

    syncSavedButton.disabled = selectedSavedIds.size === 0;
  }

  function rememberServer(credentials: SshFormValues): SavedSshServer {
    assertCredentials(credentials);

    const normalized = normalizeCredentials(credentials);
    const server: SavedSshServer = {
      ...normalized,
      id: buildServerId(normalized),
      updatedAt: Date.now()
    };

    savedServers = [server, ...savedServers.filter((entry) => entry.id !== server.id)].sort(
      compareSavedServers
    );
    selectedSavedIds.add(server.id);
    writeSavedServers(savedServers);
    renderSavedServers();
    return server;
  }
}

function button(label: string, variant: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = `button ${variant}`.trim();
  element.type = "button";
  element.textContent = label;
  return element;
}

function readCredentials(container: HTMLElement): SshFormValues {
  const host = valueOf(container, "host").trim();
  const rawPort = valueOf(container, "port").trim();
  const port = rawPort ? Number(rawPort) : 22;
  const username = valueOf(container, "username").trim();
  const password = valueOf(container, "password");
  const privateKey = valueOf(container, "privateKey");
  const passphrase = valueOf(container, "passphrase");

  return {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase
  };
}

function applyCredentials(container: HTMLElement, credentials: SshFormValues): void {
  setValue(container, "host", credentials.host);
  setValue(container, "port", String(credentials.port));
  setValue(container, "username", credentials.username);
  setValue(container, "password", credentials.password);
  setValue(container, "privateKey", credentials.privateKey);
  setValue(container, "passphrase", credentials.passphrase);
}

function setValue(container: HTMLElement, name: string, value: string): void {
  const field = container.querySelector(`[name="${name}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (field) {
    field.value = value;
  }
}

function valueOf(container: HTMLElement, name: string): string {
  const field = container.querySelector(`[name="${name}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return field?.value ?? "";
}

async function postJson(
  url: string,
  body: unknown,
  authHeaders: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(body)
  });

  return (await response.json()) as Record<string, unknown>;
}

function assertCredentials(credentials: SshFormValues): void {
  if (!credentials.host || !credentials.username) {
    throw new Error("Host and username are required.");
  }

  if (!Number.isInteger(credentials.port) || credentials.port <= 0) {
    throw new Error("Port must be a positive integer.");
  }
}

function normalizeCredentials(credentials: SshFormValues): SshFormValues {
  return {
    host: credentials.host.trim(),
    port: credentials.port,
    username: credentials.username.trim(),
    password: credentials.password,
    privateKey: credentials.privateKey,
    passphrase: credentials.passphrase
  };
}

function loadSavedServers(): SavedSshServer[] {
  try {
    const raw = localStorage.getItem(SAVED_SSH_SERVERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(readSavedServer)
      .filter((server): server is SavedSshServer => server !== null)
      .sort(compareSavedServers);
  } catch {
    return [];
  }
}

function writeSavedServers(servers: SavedSshServer[]): void {
  try {
    localStorage.setItem(SAVED_SSH_SERVERS_STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // Ignore storage failures and keep the modal usable.
  }
}

function readSavedServer(value: unknown): SavedSshServer | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const host = String(record.host ?? "").trim();
  const username = String(record.username ?? "").trim();
  const port = Number(record.port ?? 22);
  const updatedAt = Number(record.updatedAt ?? 0);

  if (!host || !username || !Number.isInteger(port) || port <= 0) {
    return null;
  }

  const server: SavedSshServer = {
    host,
    port,
    username,
    password: String(record.password ?? ""),
    privateKey: String(record.privateKey ?? ""),
    passphrase: String(record.passphrase ?? ""),
    id: buildServerId({ host, port, username }),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
  };

  server.id = buildServerId(server);
  return server;
}

function compareSavedServers(left: SavedSshServer, right: SavedSshServer): number {
  return right.updatedAt - left.updatedAt;
}

function buildServerId(server: Pick<SshFormValues, "host" | "port" | "username">): string {
  return `${server.username}@${server.host}:${server.port}`;
}

function formatServerLabel(server: Pick<SshFormValues, "host" | "port" | "username">): string {
  return buildServerId(server);
}

function formatServerAuth(server: Pick<SshFormValues, "password" | "privateKey">): string {
  if (server.privateKey.trim()) {
    return "private key";
  }

  if (server.password) {
    return "password";
  }

  return "credentials only";
}

function formatServerSummary(server: Pick<SshFormValues, "host" | "port" | "username">): string {
  return `Host ${server.host} · Port ${server.port} · User ${server.username}`;
}

function formatTimestampLabel(value?: number): string {
  return formatLocalDateTime(value, "");
}

function asErrorMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
