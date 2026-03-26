import type { SessionSource } from "../parsers/types.js";
import { escapeHtml, formatLocalDateTime } from "./utils.js";

interface RemoteSessionEntry {
  path: string;
  source: SessionSource;
  size?: number;
  mtimeMs?: number;
}

interface SshModalOptions {
  onClose: () => void;
  onSynced: () => Promise<void> | void;
}

export function createSshModal(options: SshModalOptions): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card modal-wide";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">SSH Sync</p>
      <h2>Scan remote session files</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

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

  testButton.addEventListener("click", async () => {
    status.textContent = "Testing SSH connection...";
    try {
      const payload = await postJson("/api/ssh/test", readCredentials(form));
      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Connection test failed."));
      }
      status.textContent = "SSH connection succeeded.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Connection test failed.";
    }
  });

  scanButton.addEventListener("click", async () => {
    status.textContent = "Scanning remote session paths...";
    try {
      const payload = await postJson("/api/ssh/scan", readCredentials(form));
      if (!payload.ok || !Array.isArray(payload.files)) {
        throw new Error(asErrorMessage(payload.error, "Remote scan failed."));
      }

      files = payload.files as RemoteSessionEntry[];
      selected.clear();
      for (const file of files) {
        selected.add(file.path);
      }

      syncButton.disabled = files.length === 0;
      renderResults();
      status.textContent = `Found ${files.length} remote files.`;
    } catch (error) {
      results.className = "remote-results empty-state";
      results.textContent = "Remote scan failed.";
      syncButton.disabled = true;
      status.textContent = error instanceof Error ? error.message : "Remote scan failed.";
    }
  });

  syncButton.addEventListener("click", async () => {
    const selectedFiles = files.filter((file) => selected.has(file.path));
    if (selectedFiles.length === 0) {
      status.textContent = "Select at least one file to sync.";
      return;
    }

    status.textContent = "Downloading selected files...";
    try {
      const payload = await postJson("/api/ssh/sync", {
        ...readCredentials(form),
        files: selectedFiles
      });

      if (!payload.ok) {
        throw new Error(asErrorMessage(payload.error, "Remote sync failed."));
      }

      status.textContent = `Downloaded ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}.`;
      await options.onSynced();
      options.onClose();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Remote sync failed.";
    }
  });

  card.append(header, form, status, controls, results);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  return overlay;

  function renderResults(): void {
    results.className = "remote-results";
    results.replaceChildren();

    if (files.length === 0) {
      results.className = "remote-results empty-state";
      results.textContent = "No files found in known remote session paths.";
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
            <span>${file.mtimeMs ? formatLocalDateTime(file.mtimeMs) : ""}</span>
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
}

function button(label: string, variant: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = `button ${variant}`.trim();
  element.type = "button";
  element.textContent = label;
  return element;
}

function readCredentials(container: HTMLElement): Record<string, string | number> {
  const host = valueOf(container, "host");
  const port = Number(valueOf(container, "port") || 22);
  const username = valueOf(container, "username");
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

function asErrorMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
