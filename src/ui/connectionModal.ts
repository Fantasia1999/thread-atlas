import type {
  ConnectionManager,
  RemoteAgentConnection,
  SavedConnectionProfile
} from "../store/connection.js";
import { escapeHtml, showToast } from "./utils.js";

interface ConnectionModalOptions {
  connection: ConnectionManager;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

interface RemoteConnectForm {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
}

type FeedbackKind = "info" | "success" | "error";

export function createConnectionModal(options: ConnectionModalOptions): HTMLElement {
  const { connection } = options;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card modal-wide ui-modal";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Connections</p>
      <h2>Agent connections</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost ui-button ui-button--ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

  const body = document.createElement("div");
  body.className = "modal-body";

  const status = document.createElement("p");
  status.className = "connection-status ui-status";

  function renderStatus(): void {
    const targets = connection.getScanTargets();
    const names = targets.map((target) => target.label);
    status.textContent = `Connected machines: ${names.join(", ")}`;
  }

  const localSection = buildLocalSection(connection, () => {
    renderStatus();
    void options.onChanged();
  });

  const remoteSection = document.createElement("div");
  remoteSection.className = "connection-section";

  const formSection = document.createElement("div");
  formSection.className = "connection-section";

  function renderRemotes(): void {
    remoteSection.replaceChildren(
      buildRemoteList(connection, options, renderRemotes, renderStatus)
    );
  }

  function renderForm(prefill?: SavedConnectionProfile): void {
    formSection.replaceChildren(
      buildSavedList(connection, options, renderAll),
      buildRemoteForm(connection, options, renderAll, renderStatus, prefill)
    );
  }

  function renderAll(prefill?: SavedConnectionProfile): void {
    renderStatus();
    renderRemotes();
    renderForm(prefill);
  }

  renderStatus();
  renderRemotes();
  renderForm();

  body.append(status, localSection, remoteSection, formSection);
  card.append(header, body);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  return overlay;
}

function buildLocalSection(
  connection: ConnectionManager,
  onChanged: () => void
): HTMLElement {
  const section = document.createElement("div");
  section.className = "connection-section";

  const title = document.createElement("h3");
  title.textContent = "Local agent";
  section.append(title);

  const row = document.createElement("div");
  row.className = "connection-row";

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "Local agent token (optional)";
  tokenInput.value = connection.getToken();
  tokenInput.className = "input ui-input";

  const saveToken = document.createElement("button");
  saveToken.className = "button ui-button";
  saveToken.type = "button";
  saveToken.textContent = "Save token";
  saveToken.addEventListener("click", () => {
    connection.setToken(tokenInput.value);
    onChanged();
  });

  row.append(tokenInput, saveToken);
  section.append(row);
  return section;
}

function buildRemoteList(
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  rerender: () => void,
  renderStatus: () => void
): HTMLElement {
  const wrapper = document.createElement("div");

  const title = document.createElement("h3");
  title.textContent = "Connected agents";
  wrapper.append(title);

  const remotes = connection.getRemotes();
  if (remotes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "connection-empty";
    empty.textContent =
      "No remote agents. Local sessions are always included; connect a machine below to aggregate its sessions.";
    wrapper.append(empty);
    return wrapper;
  }

  for (const remote of remotes) {
    wrapper.append(buildRemoteRow(remote, connection, options, rerender, renderStatus));
  }
  return wrapper;
}

function buildRemoteRow(
  remote: RemoteAgentConnection,
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  rerender: () => void,
  renderStatus: () => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "connection-row connection-remote";

  const label = document.createElement("span");
  label.className = "connection-remote-label";
  label.textContent = remote.label;
  label.title = `${remote.username}@${remote.host}`;

  const removeButton = document.createElement("button");
  removeButton.className = "button ghost ui-button ui-button--ghost";
  removeButton.type = "button";
  removeButton.textContent = "Disconnect";
  removeButton.addEventListener("click", async () => {
    try {
      await connection.fetch(`/api/remote/${encodeURIComponent(remote.id)}`, {
        method: "DELETE"
      });
    } catch {
      // Best-effort disconnect; still drop the local entry.
    }
    connection.removeRemote(remote.id);
    renderStatus();
    rerender();
    await options.onChanged();
  });

  row.append(label, removeButton);
  return row;
}

function buildSavedList(
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  rerender: (prefill?: SavedConnectionProfile) => void
): HTMLElement {
  const wrapper = document.createElement("div");

  const title = document.createElement("h3");
  title.textContent = "Saved connections";
  wrapper.append(title);

  const profiles = connection.getProfiles();
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "connection-empty";
    empty.textContent = "No saved connections yet. Save one below to reuse it after a refresh.";
    wrapper.append(empty);
    return wrapper;
  }

  for (const profile of profiles) {
    wrapper.append(buildSavedRow(profile, connection, options, rerender));
  }
  return wrapper;
}

function buildSavedRow(
  profile: SavedConnectionProfile,
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  rerender: (prefill?: SavedConnectionProfile) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "connection-row connection-saved";

  const label = document.createElement("span");
  label.className = "connection-remote-label";
  label.textContent = profile.label;

  const connectButton = document.createElement("button");
  connectButton.className = "button primary ui-button ui-button--primary";
  connectButton.type = "button";
  connectButton.textContent = "Connect";

  const feedback = document.createElement("p");
  feedback.className = "connection-feedback ui-status";

  connectButton.addEventListener("click", async () => {
    connectButton.disabled = true;
    await deployAndConnect(
      connection,
      options,
      {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        privateKey: profile.privateKey,
        passphrase: profile.passphrase
      },
      profile.label,
      feedback,
      () => rerender()
    );
    connectButton.disabled = false;
  });

  const editButton = document.createElement("button");
  editButton.className = "button ghost ui-button ui-button--ghost";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => {
    rerender(profile);
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "button ghost ui-button ui-button--ghost";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    connection.removeProfile(profile.id);
    rerender();
  });

  row.append(label, connectButton, editButton, deleteButton, feedback);
  return row;
}

function buildRemoteForm(
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  rerender: (prefill?: SavedConnectionProfile) => void,
  renderStatus: () => void,
  prefill?: SavedConnectionProfile
): HTMLElement {
  const form = document.createElement("form");
  form.className = "connection-form";

  const editingId = prefill?.id ?? "";
  const portValue = prefill?.port && prefill.port !== 22 ? String(prefill.port) : "";

  form.innerHTML = `
    <h3>${editingId ? "Edit connection" : "New connection"}</h3>
    <input class="input ui-input" name="label" placeholder="Name (optional)" autocomplete="off" value="${escapeHtml(prefill?.label ?? "")}" />
    <div class="connection-grid">
      <input class="input ui-input" name="host" placeholder="Host" autocomplete="off" value="${escapeHtml(prefill?.host ?? "")}" />
      <input class="input ui-input" name="port" placeholder="Port (22)" autocomplete="off" value="${escapeHtml(portValue)}" />
      <input class="input ui-input" name="username" placeholder="Username" autocomplete="off" value="${escapeHtml(prefill?.username ?? "")}" />
      <input class="input ui-input" name="password" type="password" placeholder="Password (optional)" autocomplete="off" value="${escapeHtml(prefill?.password ?? "")}" />
    </div>
    <textarea class="input ui-input ui-textarea" name="privateKey" placeholder="Private key (optional)" rows="3">${escapeHtml(prefill?.privateKey ?? "")}</textarea>
    <input class="input ui-input" name="passphrase" type="password" placeholder="Passphrase (optional)" autocomplete="off" value="${escapeHtml(prefill?.passphrase ?? "")}" />
  `;

  const feedback = document.createElement("p");
  feedback.className = "connection-feedback ui-status";

  const actions = document.createElement("div");
  actions.className = "connection-row";

  const saveButton = document.createElement("button");
  saveButton.className = "button ui-button";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const submit = document.createElement("button");
  submit.className = "button primary ui-button ui-button--primary";
  submit.type = "submit";
  submit.textContent = "Save & connect";

  actions.append(saveButton, submit);
  form.append(feedback, actions);

  const collect = (): { values: RemoteConnectForm; label: string } | null => {
    const values = readForm(form);
    if (!values.host || !values.username) {
      setFeedback(feedback, "Host and username are required.", "error");
      return null;
    }
    return { values, label: readLabel(form, values) };
  };

  saveButton.addEventListener("click", () => {
    const collected = collect();
    if (!collected) {
      return;
    }
    saveProfile(connection, editingId, collected.label, collected.values);
    setFeedback(feedback, `Saved "${collected.label}".`, "success");
    rerender();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const collected = collect();
    if (!collected) {
      return;
    }

    // Persist first so a failed connect or a page refresh never loses the input.
    saveProfile(connection, editingId, collected.label, collected.values);

    submit.disabled = true;
    saveButton.disabled = true;
    await deployAndConnect(connection, options, collected.values, collected.label, feedback, () => {
      renderStatus();
      rerender();
    });
    submit.disabled = false;
    saveButton.disabled = false;
  });

  return form;
}

async function deployAndConnect(
  connection: ConnectionManager,
  options: ConnectionModalOptions,
  values: RemoteConnectForm,
  label: string,
  feedback: HTMLElement,
  refresh: () => void
): Promise<void> {
  setFeedback(feedback, "Deploying agent and opening tunnel...", "info");
  try {
    const response = await connection.fetch("/api/remote/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const payload = (await response.json()) as {
      ok: boolean;
      agent?: { id: string; label: string; host: string; username: string };
      error?: string;
    };
    if (!response.ok || !payload.ok || !payload.agent) {
      throw new Error(payload.error ?? "Failed to connect to remote agent.");
    }

    const displayName = label.trim() || payload.agent.label;
    connection.upsertRemote({
      id: payload.agent.id,
      label: displayName,
      host: payload.agent.host,
      username: payload.agent.username
    });
    connection.useRemote(payload.agent.id);
    setFeedback(feedback, `Connected to ${displayName}.`, "success");
    refresh();
    await options.onChanged();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed.";
    setFeedback(feedback, message, "error");
    showToast(message, "error");
  }
}

function setFeedback(element: HTMLElement, message: string, kind: FeedbackKind): void {
  element.className = `connection-feedback ui-status ${kind}`;
  element.textContent = message;
}

function saveProfile(
  connection: ConnectionManager,
  editingId: string,
  label: string,
  values: RemoteConnectForm
): void {
  const existing = connection
    .getProfiles()
    .find(
      (entry) =>
        entry.host === values.host &&
        entry.port === values.port &&
        entry.username === values.username
    );
  const id = editingId || existing?.id || generateId();
  connection.upsertProfile({
    id,
    label,
    host: values.host,
    port: values.port,
    username: values.username,
    password: values.password,
    privateKey: values.privateKey,
    passphrase: values.passphrase
  });
}

function readLabel(form: HTMLFormElement, values: RemoteConnectForm): string {
  const field = form.querySelector(`[name="label"]`) as HTMLInputElement | null;
  const custom = field?.value.trim() ?? "";
  if (custom) {
    return custom;
  }
  const base = `${values.username}@${values.host}`;
  return values.port && values.port !== 22 ? `${base}:${values.port}` : base;
}

function generateId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `conn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readForm(form: HTMLFormElement): RemoteConnectForm {
  const value = (name: string): string => {
    const field = form.querySelector(`[name="${name}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    return field?.value.trim() ?? "";
  };

  const portRaw = value("port");
  const port = portRaw ? Number(portRaw) : 22;

  return {
    host: value("host"),
    port: Number.isInteger(port) && port > 0 ? port : 22,
    username: value("username"),
    password: value("password"),
    privateKey: value("privateKey"),
    passphrase: value("passphrase")
  };
}
