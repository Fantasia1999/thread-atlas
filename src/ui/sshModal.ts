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
}

export function createSshModal(options: SshModalOptions): HTMLElement {
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

  const savedList = document.createElement("div");
  savedList.className = "saved-server-list";

  savedSection.append(savedSectionHeader, savedActions, savedList);

  const form = document.createElement("div");
  form.className = "form-grid";
  form.innerHTML = `
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
  status.className = "status-inline";
  status.textContent = "Fill host and username, then test or scan.";

  const controls = document.createElement("div");
  controls.className = "button-row";

  const testButton = button("Test connection", "secondary");
  const scanButton = button("Scan remote", "");
  const syncButton = button("Sync selected", "");
  syncButton.disabled = true;
  controls.append(testButton, scanButton, syncButton);

  const results = document.createElement("div");
  results.className = "remote-results empty-state";
  results.textContent = "No remote scan results yet.";

  let files: RemoteSessionEntry[] = [];
  const selected = new Set<string>();

  saveCurrentButton.addEventListener("click", () => {
    try {
      const server = rememberServer(readCredentials(form));
      status.textContent = `Saved ${formatServerLabel(server)} in this browser.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Failed to save server.";
    }
  });

  syncSavedButton.addEventListener("click", async () => {
    const servers = savedServers.filter((server) => selectedSavedIds.has(server.id));
    if (servers.length === 0) {
      status.textContent = "Select at least one saved server to sync.";
      return;
    }

    let checkedServers = 0;
    let emptyServers = 0;
    let syncedServers = 0;
    let totalSelections = 0;
    let totalDownloads = 0;
    const errors: string[] = [];

    for (const server of servers) {
      checkedServers += 1;
      status.textContent = `Syncing saved server ${checkedServers}/${servers.length}: ${formatServerLabel(server)}...`;

      try {
        const scanPayload = await postJson("/api/ssh/scan", server);
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
        });
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

    if (errors.length === 0 && totalDownloads > 0) {
      status.textContent =
        `Synced ${syncedServers} saved server${syncedServers === 1 ? "" : "s"}, ` +
        `downloaded ${totalDownloads} file${totalDownloads === 1 ? "" : "s"} ` +
        `from ${totalSelections} remote selection${totalSelections === 1 ? "" : "s"}.`;
      options.onClose();
      return;
    }

    if (errors.length === 0) {
      status.textContent =
        emptyServers === servers.length
          ? "No sessions found in the selected saved servers."
          : `Checked ${servers.length} saved server${servers.length === 1 ? "" : "s"} with no downloadable changes.`;
      return;
    }

    status.textContent = errors.join(" | ");
  });

  testButton.addEventListener("click", async () => {
    status.textContent = "Testing SSH connection...";
    try {
      const credentials = readCredentials(form);
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/test", credentials);
      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Connection test failed."));
      }
      rememberServer(credentials);
      status.textContent = "SSH connection succeeded.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Connection test failed.";
    }
  });

  scanButton.addEventListener("click", async () => {
    status.textContent = "Scanning remote sessions...";
    try {
      const credentials = readCredentials(form);
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/scan", credentials);
      if (!payload.ok || !Array.isArray(payload.files)) {
        throw new Error(asErrorMessage(payload.error, "Remote scan failed."));
      }

      files = payload.files as RemoteSessionEntry[];
      selected.clear();
      for (const file of files) {
        selected.add(file.path);
      }

      rememberServer(credentials);
      syncButton.disabled = files.length === 0;
      renderResults();
      status.textContent = `Found ${files.length} remote session item${files.length === 1 ? "" : "s"}.`;
    } catch (error) {
      resetResults("Remote scan failed.");
      status.textContent = error instanceof Error ? error.message : "Remote scan failed.";
    }
  });

  syncButton.addEventListener("click", async () => {
    const selectedFiles = files.filter((file) => selected.has(file.path));
    if (selectedFiles.length === 0) {
      status.textContent = "Select at least one remote session item to sync.";
      return;
    }

    status.textContent = "Downloading selected remote sessions...";
    try {
      const credentials = readCredentials(form);
      assertCredentials(credentials);
      const payload = await postJson("/api/ssh/sync", {
        ...credentials,
        files: selectedFiles
      });

      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Remote sync failed."));
      }

      rememberServer(credentials);
      const downloadedCount = Array.isArray(payload.downloaded) ? payload.downloaded.length : 0;
      status.textContent =
        `Downloaded ${downloadedCount} file${downloadedCount === 1 ? "" : "s"} ` +
        `from ${selectedFiles.length} remote selection${selectedFiles.length === 1 ? "" : "s"}.`;
      await options.onSynced();
      options.onClose();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Remote sync failed.";
    }
  });

  card.append(header, savedSection, form, status, controls, results);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

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
        resetResults("No remote scan results yet.");
        status.textContent = `Loaded ${formatServerLabel(server)}.`;
      });

      const deleteButton = button("Delete", "ghost");
      deleteButton.addEventListener("click", () => {
        selectedSavedIds.delete(server.id);
        savedServers = savedServers.filter((entry) => entry.id !== server.id);
        writeSavedServers(savedServers);
        renderSavedServers();
        status.textContent = `Removed ${formatServerLabel(server)} from saved servers.`;
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

  function renderResults(): void {
    results.className = "remote-results";
    results.replaceChildren();

    if (files.length === 0) {
      results.className = "remote-results empty-state";
      results.textContent = "No sessions found in known remote scan roots.";
      return;
    }

    for (const file of files) {
      const row = document.createElement("label");
      row.className = "remote-row";
      row.innerHTML = `
        <input type="checkbox" ${selected.has(file.path) ? "checked" : ""} />
        <div>
          <div class="remote-row-top">
            <span class="source-badge ${file.source}">${file.source}</span>
            <span>${file.kind === "directory" ? "directory" : "file"}</span>
            <span>${escapeHtml(formatTimestampLabel(file.mtimeMs))}</span>
          </div>
          <div class="remote-path">${escapeHtml(file.path)}</div>
        </div>
      `;

      const checkbox = row.querySelector("input") as HTMLInputElement;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(file.path);
        } else {
          selected.delete(file.path);
        }
      });

      results.append(row);
    }
  }

  function resetResults(message: string): void {
    files = [];
    selected.clear();
    syncButton.disabled = true;
    results.className = "remote-results empty-state";
    results.textContent = message;
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

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
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
