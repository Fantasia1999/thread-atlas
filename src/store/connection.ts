export interface RemoteAgentConnection {
  id: string;
  label: string;
  host: string;
  username: string;
}

export interface SavedConnectionProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
}

export interface ActiveConnection {
  mode: "local" | "remote";
  remoteId?: string;
}

export interface ScanTarget {
  /** "local" for the local agent, or a remote agent id. */
  id: string;
  label: string;
  /** Secondary detail (e.g. username@host) shown on hover for remote targets. */
  detail?: string;
  /** API base used to scan and load bundles for this target. */
  base: string;
  mode: "local" | "remote";
}

const REMOTE_KEY_PREFIX = "remote:";
const REMOTE_KEY_SEPARATOR = "::";

const TOKEN_STORAGE_KEY = "thread-atlas-agent-token";
const REMOTES_STORAGE_KEY = "thread-atlas-remote-connections";
const ACTIVE_STORAGE_KEY = "thread-atlas-active-connection";
const PROFILES_STORAGE_KEY = "thread-atlas-connection-profiles";

type Listener = (manager: ConnectionManager) => void;

/**
 * Holds the client-side view of which agent the UI is talking to. The browser
 * always speaks same-origin to the local agent; remote agents are reached
 * through the local agent's proxy under `/api/remote/<id>`. The optional token
 * authenticates the browser to the local agent when it runs with `--token`.
 */
export class ConnectionManager {
  private listeners = new Set<Listener>();
  private token: string;
  private remotes: RemoteAgentConnection[];
  private active: ActiveConnection;
  private profiles: SavedConnectionProfile[];

  constructor() {
    this.token = readString(TOKEN_STORAGE_KEY);
    this.remotes = readRemotes();
    this.active = readActive(this.remotes);
    this.profiles = readProfiles();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this);
    return () => this.listeners.delete(listener);
  }

  getToken(): string {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token.trim();
    persist(TOKEN_STORAGE_KEY, this.token);
    this.emit();
  }

  getRemotes(): RemoteAgentConnection[] {
    return [...this.remotes];
  }

  getActive(): ActiveConnection {
    return { ...this.active };
  }

  getActiveLabel(): string {
    if (this.active.mode === "local") {
      return "Local";
    }
    const remote = this.remotes.find((entry) => entry.id === this.active.remoteId);
    return remote ? remote.label : "Remote";
  }

  upsertRemote(remote: RemoteAgentConnection): void {
    const next = this.remotes.filter((entry) => entry.id !== remote.id);
    next.push(remote);
    this.remotes = next;
    persist(REMOTES_STORAGE_KEY, JSON.stringify(this.remotes));
    this.emit();
  }

  removeRemote(id: string): void {
    this.remotes = this.remotes.filter((entry) => entry.id !== id);
    persist(REMOTES_STORAGE_KEY, JSON.stringify(this.remotes));
    if (this.active.mode === "remote" && this.active.remoteId === id) {
      this.useLocal();
      return;
    }
    this.emit();
  }

  /**
   * Drops persisted remotes whose backend agent is no longer live (e.g. after a
   * page refresh, since the agent registry is in-memory). Because agent ids are
   * stable per host, a later reconnect to the same host restores the same id —
   * and therefore the same namespaced session keys, favorites and pins.
   */
  async reconcileRemotes(): Promise<void> {
    if (this.remotes.length === 0) {
      return;
    }
    let liveIds: Set<string>;
    try {
      const response = await this.fetch("/api/remote/list");
      const payload = (await response.json()) as {
        ok: boolean;
        agents?: Array<{ id: string }>;
      };
      if (!response.ok || !payload.ok || !payload.agents) {
        return;
      }
      liveIds = new Set(payload.agents.map((agent) => agent.id));
    } catch {
      return;
    }

    const next = this.remotes.filter((entry) => liveIds.has(entry.id));
    if (next.length === this.remotes.length) {
      return;
    }
    this.remotes = next;
    persist(REMOTES_STORAGE_KEY, JSON.stringify(this.remotes));
    if (this.active.mode === "remote" && this.active.remoteId && !liveIds.has(this.active.remoteId)) {
      this.useLocal();
      return;
    }
    this.emit();
  }

  getProfiles(): SavedConnectionProfile[] {
    return this.profiles.map((entry) => ({ ...entry }));
  }

  /**
   * Saves (or updates) a reusable connection profile so the user does not have
   * to re-enter host/credentials after a failed attempt or a page refresh.
   * Credentials live only in this browser's localStorage; they are never sent
   * anywhere except to the local agent at connect time.
   */
  upsertProfile(profile: SavedConnectionProfile): void {
    const next = this.profiles.filter((entry) => entry.id !== profile.id);
    next.push({ ...profile });
    this.profiles = next;
    persist(PROFILES_STORAGE_KEY, JSON.stringify(this.profiles));
    this.emit();
  }

  removeProfile(id: string): void {
    this.profiles = this.profiles.filter((entry) => entry.id !== id);
    persist(PROFILES_STORAGE_KEY, JSON.stringify(this.profiles));
    this.emit();
  }

  useLocal(): void {
    this.active = { mode: "local" };
    persist(ACTIVE_STORAGE_KEY, JSON.stringify(this.active));
    this.emit();
  }

  useRemote(id: string): void {
    if (!this.remotes.some((entry) => entry.id === id)) {
      return;
    }
    this.active = { mode: "remote", remoteId: id };
    persist(ACTIVE_STORAGE_KEY, JSON.stringify(this.active));
    this.emit();
  }

  /** API base for descriptor scan and bundle loading on the active connection. */
  sessionApiBase(): string {
    if (this.active.mode === "remote" && this.active.remoteId) {
      return `/api/remote/${encodeURIComponent(this.active.remoteId)}`;
    }
    return "/api/local";
  }

  /**
   * Every connection whose sessions should be aggregated into one list: the
   * local agent plus all connected remote agents. Used to scan all machines at
   * once and show their sessions together.
   */
  getScanTargets(): ScanTarget[] {
    const targets: ScanTarget[] = [
      { id: "local", label: "Local", base: "/api/local", mode: "local" }
    ];
    for (const remote of this.remotes) {
      targets.push({
        id: remote.id,
        label: remote.label,
        detail: `${remote.username}@${remote.host}`,
        base: `/api/remote/${encodeURIComponent(remote.id)}`,
        mode: "remote"
      });
    }
    return targets;
  }

  /** Namespaces a backend descriptor key so it stays unique per connection. */
  static namespaceKey(target: ScanTarget, key: string): string {
    if (target.mode === "local") {
      return key;
    }
    return `${REMOTE_KEY_PREFIX}${target.id}${REMOTE_KEY_SEPARATOR}${key}`;
  }

  /** Resolves the API base and original backend key for a (possibly namespaced) key. */
  routeForKey(key: string): { base: string; backendKey: string } {
    if (key.startsWith(REMOTE_KEY_PREFIX)) {
      const separatorIndex = key.indexOf(REMOTE_KEY_SEPARATOR, REMOTE_KEY_PREFIX.length);
      if (separatorIndex !== -1) {
        const id = key.slice(REMOTE_KEY_PREFIX.length, separatorIndex);
        const backendKey = key.slice(separatorIndex + REMOTE_KEY_SEPARATOR.length);
        return { base: `/api/remote/${encodeURIComponent(id)}`, backendKey };
      }
    }
    return { base: "/api/local", backendKey: key };
  }

  /** Authorization headers for the local agent (none when no token is set). */
  authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    return fetch(input, { ...init, headers });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this);
    }
  }
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function readRemotes(): RemoteAgentConnection[] {
  try {
    const raw = localStorage.getItem(REMOTES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is RemoteAgentConnection => {
        return (
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as RemoteAgentConnection).id === "string" &&
          typeof (entry as RemoteAgentConnection).label === "string"
        );
      })
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        host: entry.host ?? "",
        username: entry.username ?? ""
      }));
  } catch {
    return [];
  }
}

function readProfiles(): SavedConnectionProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is SavedConnectionProfile =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as SavedConnectionProfile).id === "string" &&
          typeof (entry as SavedConnectionProfile).host === "string"
      )
      .map((entry) => {
        const port = Number((entry as SavedConnectionProfile).port);
        return {
          id: entry.id,
          label: typeof entry.label === "string" ? entry.label : entry.host,
          host: entry.host,
          port: Number.isInteger(port) && port > 0 ? port : 22,
          username: typeof entry.username === "string" ? entry.username : "",
          password: typeof entry.password === "string" ? entry.password : "",
          privateKey: typeof entry.privateKey === "string" ? entry.privateKey : "",
          passphrase: typeof entry.passphrase === "string" ? entry.passphrase : ""
        };
      });
  } catch {
    return [];
  }
}

function readActive(remotes: RemoteAgentConnection[]): ActiveConnection {
  try {
    const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
    if (!raw) {
      return { mode: "local" };
    }
    const parsed = JSON.parse(raw) as ActiveConnection;
    if (
      parsed.mode === "remote" &&
      parsed.remoteId &&
      remotes.some((entry) => entry.id === parsed.remoteId)
    ) {
      return { mode: "remote", remoteId: parsed.remoteId };
    }
    return { mode: "local" };
  } catch {
    return { mode: "local" };
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; ignore persistence failures.
  }
}
