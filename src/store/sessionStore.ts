import { parseSessionBundle } from "../parsers/detect.js";
import type {
  Session,
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../parsers/types.js";
import { ConnectionManager, type ScanTarget } from "./connection.js";

export interface StoreState {
  descriptors: SessionDescriptor[];
  sessions: Map<string, Session>;
  selectedKey?: string;
  sourceFilter: SessionSource | "all";
  search: string;
  loadingScan: boolean;
  loadingSession: boolean;
  status: string;
  pinnedKeys: Set<string>;
  favoriteKeys: Set<string>;
  favoriteMetadata: Map<string, { tags: string[]; notes: string }>;
  hiddenProjects: Set<string>;
}

const CACHED_DESCRIPTORS_KEY = "thread-atlas-cached-descriptors";
const CACHED_DESCRIPTORS_VERSION = 1;

interface CachedDescriptorsPayload {
  version: number;
  descriptors: SessionDescriptor[];
}



type Listener = (state: StoreState) => void;

export class SessionStore {
  private listeners = new Set<Listener>();
  private importedBundles = new Map<string, SessionBundle>();
  private cachedKeysOrder: string[] = [];
  private state: StoreState = {
    descriptors: (() => {
      try {
        const val = localStorage.getItem(CACHED_DESCRIPTORS_KEY);
        if (!val) return [];
        const parsed = JSON.parse(val) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as CachedDescriptorsPayload).version === CACHED_DESCRIPTORS_VERSION &&
          Array.isArray((parsed as CachedDescriptorsPayload).descriptors)
        ) {
          return (parsed as CachedDescriptorsPayload).descriptors;
        }
      } catch {
        // ignore
      }
      return [];
    })(),
    selectedKey: (() => {
      try {
        return localStorage.getItem("thread-atlas-selected-session-key") ?? undefined;
      } catch {
        return undefined;
      }
    })(),
    sessions: new Map(),
    sourceFilter: (() => {
      const val = localStorage.getItem("thread-atlas-source-filter");
      if (
        val === "all" ||
        val === "codex" ||
        val === "claude" ||
        val === "opencode" ||
        val === "gemini" ||
        val === "antigravity" ||
        val === "copilot" ||
        val === "unknown"
      ) {
        return val;
      }
      return "all";
    })(),
    search: "",
    loadingScan: false,
    loadingSession: false,
    status: "Ready.",
    pinnedKeys: (() => {
      try {
        const val = localStorage.getItem("thread-atlas-pinned-sessions");
        return val ? new Set<string>(JSON.parse(val)) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    })(),
    favoriteKeys: (() => {
      try {
        const val = localStorage.getItem("thread-atlas-favorite-sessions");
        return val ? new Set<string>(JSON.parse(val)) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    })(),
    favoriteMetadata: (() => {
      try {
        const val = localStorage.getItem("thread-atlas-favorite-metadata");
        if (val) {
          const parsed = JSON.parse(val) as Record<string, { tags: string[]; notes: string }>;
          const map = new Map<string, { tags: string[]; notes: string }>();
          for (const [k, v] of Object.entries(parsed)) {
            map.set(k, v);
          }
          return map;
        }
      } catch {
        // ignore
      }
      return new Map<string, { tags: string[]; notes: string }>();
    })(),
    hiddenProjects: (() => {
      try {
        const val = localStorage.getItem("thread-atlas-hidden-projects");
        return val ? new Set<string>(JSON.parse(val)) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    })()
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  constructor(private readonly connection: ConnectionManager = new ConnectionManager()) {}

  getConnection(): ConnectionManager {
    return this.connection;
  }

  getState(): StoreState {
    return {
      ...this.state,
      descriptors: [...this.state.descriptors],
      sessions: new Map(this.state.sessions),
      pinnedKeys: new Set(this.state.pinnedKeys),
      favoriteKeys: new Set(this.state.favoriteKeys),
      favoriteMetadata: new Map(this.state.favoriteMetadata),
      hiddenProjects: new Set(this.state.hiddenProjects)
    };
  }

  getVisibleDescriptors(): SessionDescriptor[] {
    const query = this.state.search.trim().toLowerCase();

    // Parse special filters
    const showOnlyStarred = query.includes("is:starred") || query.includes("is:favorite");
    
    let cleanQuery = query
      .replace(/\bis:starred\b/gi, "")
      .replace(/\bis:favorite\b/gi, "")
      .trim();

    // Extract tags like "#tag1" or "#tag2"
    const tagMatches = cleanQuery.match(/#\S+/g) || [];
    const targetTags = tagMatches.map(t => t.slice(1).toLowerCase());

    // Strip out the tags from the text search query
    for (const match of tagMatches) {
      cleanQuery = cleanQuery.replace(match, "");
    }
    cleanQuery = cleanQuery.trim().replace(/\s+/g, " ");

    const filtered = this.state.descriptors.filter((descriptor) => {
      const workspacePath = getWorkspaceFullPath(descriptor);
      if (workspacePath && this.state.hiddenProjects.has(workspacePath)) {
        return false;
      }

      if (this.state.sourceFilter !== "all" && descriptor.source !== this.state.sourceFilter) {
        return false;
      }

      // Check favorites-only filter
      if (showOnlyStarred && !this.state.favoriteKeys.has(descriptor.key)) {
        return false;
      }

      // Check hashtag filters
      if (targetTags.length > 0) {
        const meta = this.state.favoriteMetadata.get(descriptor.key);
        if (!meta) {
          return false;
        }
        const sessionTags = meta.tags.map(t => t.toLowerCase());
        const hasAllTags = targetTags.every(t => sessionTags.includes(t));
        if (!hasAllTags) {
          return false;
        }
      }

      if (!cleanQuery) {
        return true;
      }

      // Fetch metadata to match notes and tags in plain text search
      const meta = this.state.favoriteMetadata.get(descriptor.key);
      const notesMatch = meta?.notes?.toLowerCase().includes(cleanQuery) || false;
      const tagsMatch = meta?.tags?.some(t => t.toLowerCase().includes(cleanQuery)) || false;

      return (
        descriptor.title.toLowerCase().includes(cleanQuery) ||
        descriptor.primaryPath.toLowerCase().includes(cleanQuery) ||
        notesMatch ||
        tagsMatch
      );
    });

    // Pinned sorting logic
    const pinnedGroup: SessionDescriptor[] = [];
    const normalGroup: SessionDescriptor[] = [];

    for (const desc of filtered) {
      if (this.state.pinnedKeys.has(desc.key)) {
        pinnedGroup.push(desc);
      } else {
        normalGroup.push(desc);
      }
    }

    pinnedGroup.sort(compareDescriptors);
    normalGroup.sort(compareDescriptors);

    return [...pinnedGroup, ...normalGroup];
  }

  setSearch(search: string): void {
    this.updateState({ search });
  }

  setSourceFilter(sourceFilter: SessionSource | "all"): void {
    localStorage.setItem("thread-atlas-source-filter", sourceFilter);
    this.updateState({ sourceFilter });
  }

  togglePin(key: string): void {
    const nextPinned = new Set(this.state.pinnedKeys);
    if (nextPinned.has(key)) {
      nextPinned.delete(key);
    } else {
      nextPinned.add(key);
    }
    localStorage.setItem("thread-atlas-pinned-sessions", JSON.stringify([...nextPinned]));
    this.updateState({ pinnedKeys: nextPinned });
  }

  toggleFavorite(key: string): void {
    const nextFavorite = new Set(this.state.favoriteKeys);
    if (nextFavorite.has(key)) {
      nextFavorite.delete(key);
    } else {
      nextFavorite.add(key);
    }
    localStorage.setItem("thread-atlas-favorite-sessions", JSON.stringify([...nextFavorite]));
    this.updateState({ favoriteKeys: nextFavorite });
  }

  updateFavoriteMetadata(key: string, metadata: { tags: string[]; notes: string }): void {
    const nextMeta = new Map(this.state.favoriteMetadata);
    nextMeta.set(key, metadata);

    // Save to localStorage
    const obj: Record<string, { tags: string[]; notes: string }> = {};
    for (const [k, v] of nextMeta.entries()) {
      obj[k] = v;
    }
    localStorage.setItem("thread-atlas-favorite-metadata", JSON.stringify(obj));

    this.updateState({ favoriteMetadata: nextMeta });
  }

  async refreshLocalScan(): Promise<void> {
    this.updateState({
      loadingScan: true,
      status: "Scanning session directories across connections..."
    });

    const targets = this.connection.getScanTargets();
    const collected: SessionDescriptor[] = [];
    const errors: string[] = [];
    const machineCount = targets.length;
    let completedCount = 0;

    const updatePartialResults = (isDone: boolean) => {
      const merged = mergeDescriptors(this.importedBundles, collected);
      const selectedKey = resolveSelectedKey(merged, this.state.selectedKey);
      const status = isDone
        ? (errors.length > 0
            ? `Loaded ${merged.length} sessions from ${machineCount - errors.length}/${machineCount} connections. ${errors.join("; ")}`
            : `Loaded ${merged.length} sessions from ${machineCount} connection${machineCount === 1 ? "" : "s"}.`)
        : `Scanning connections (${completedCount}/${machineCount})... loaded ${merged.length} sessions.`;

      this.updateState({
        descriptors: merged,
        selectedKey: selectedKey ?? this.state.selectedKey,
        loadingScan: !isDone,
        status
      });

      if (isDone && merged.length > 0) {
        try {
          const payload: CachedDescriptorsPayload = {
            version: CACHED_DESCRIPTORS_VERSION,
            descriptors: merged.slice(0, 300)
          };
          localStorage.setItem(CACHED_DESCRIPTORS_KEY, JSON.stringify(payload));
        } catch {
          // Ignore storage errors
        }
      }

      return selectedKey;
    };

    await Promise.all(
      targets.map(async (target) => {
        try {
          const response = await this.connection.fetch(`${target.base}/scan`);
          const payload = (await response.json()) as {
            ok: boolean;
            files?: SessionDescriptor[];
            error?: string;
          };

          if (!response.ok || !payload.ok || !payload.files) {
            throw new Error(payload.error ?? "Scan failed.");
          }

          for (const descriptor of payload.files) {
            collected.push(tagDescriptor(descriptor, target));
          }
        } catch (error) {
          errors.push(`${target.label}: ${error instanceof Error ? error.message : "scan failed"}`);
        } finally {
          completedCount++;
          updatePartialResults(completedCount === machineCount);
        }
      })
    );

    const merged = mergeDescriptors(this.importedBundles, collected);
    const finalSelectedKey = resolveSelectedKey(merged, this.state.selectedKey);
    const selectPromise = (finalSelectedKey && !this.state.sessions.has(finalSelectedKey))
      ? this.selectSession(finalSelectedKey)
      : Promise.resolve();

    updatePartialResults(true);
    await selectPromise;
  }

  async selectSession(key: string): Promise<void> {
    try {
      localStorage.setItem("thread-atlas-selected-session-key", key);
    } catch (e) {
      // Ignore storage errors in restricted environments
    }
    this.updateState({
      selectedKey: key,
      loadingSession: true,
      status: "Loading session..."
    });

    try {
      if (this.state.sessions.has(key)) {
        // Move key to the end of the order to mark it as recently used
        const index = this.cachedKeysOrder.indexOf(key);
        if (index >= 0) {
          this.cachedKeysOrder.splice(index, 1);
        }
        this.cachedKeysOrder.push(key);

        this.updateState({
          loadingSession: false,
          status: "Session loaded."
        });
        return;
      }

      const bundle = this.importedBundles.get(key) ?? (await this.fetchBundle(key));
      const session = parseSessionBundle(bundle);
      const nextSessions = new Map(this.state.sessions);
      nextSessions.set(key, session);
      this.cachedKeysOrder.push(key);

      // Enforce the LRU cache limit of 3 sessions
      if (nextSessions.size > 3) {
        const oldestKey = this.cachedKeysOrder.shift();
        if (oldestKey && oldestKey !== key) {
          nextSessions.delete(oldestKey);
        }
      }

      this.updateState({
        sessions: nextSessions,
        loadingSession: false,
        status: `Viewing ${session.title}.`
      });


    } catch (error) {
      this.updateState({
        loadingSession: false,
        status: error instanceof Error ? error.message : "Failed to load session."
      });
    }
  }

  importBundles(bundles: SessionBundle[]): void {
    const nextImported = new Map(this.importedBundles);
    const nextSessions = new Map(this.state.sessions);

    for (const bundle of bundles) {
      const session = parseSessionBundle(bundle);
      bundle.source = session.source;
      bundle.title = session.title || bundle.title;
      bundle.metadata = {
        ...bundle.metadata,
        ...session.metadata
      };
      
      nextImported.set(bundle.key, bundle);
      nextSessions.set(bundle.key, session);

      const index = this.cachedKeysOrder.indexOf(bundle.key);
      if (index >= 0) {
        this.cachedKeysOrder.splice(index, 1);
      }
      this.cachedKeysOrder.push(bundle.key);
    }

    this.importedBundles = nextImported;
    const existingLocalDescriptors = this.state.descriptors.filter(
      (descriptor) => !descriptor.key.startsWith("import::")
    );
    const descriptors = mergeDescriptors(nextImported, existingLocalDescriptors);

    // Enforce the LRU cache limit of 3 sessions on imports
    while (nextSessions.size > 3) {
      const oldestKey = this.cachedKeysOrder.shift();
      if (oldestKey) {
        nextSessions.delete(oldestKey);
      }
    }

    this.updateState({
      descriptors,
      sessions: nextSessions,
      selectedKey: bundles[0]?.key ?? this.state.selectedKey,
      status: `Imported ${bundles.length} file${bundles.length === 1 ? "" : "s"}.`
    });
  }

  getSelectedDescriptor(): SessionDescriptor | undefined {
    return this.state.descriptors.find((descriptor) => descriptor.key === this.state.selectedKey);
  }

  getSelectedSession(): Session | undefined {
    if (!this.state.selectedKey) {
      return undefined;
    }
    return this.state.sessions.get(this.state.selectedKey);
  }

  hideProject(projectPath: string): void {
    if (!projectPath) return;
    const nextHidden = new Set(this.state.hiddenProjects);
    nextHidden.add(projectPath);
    localStorage.setItem("thread-atlas-hidden-projects", JSON.stringify([...nextHidden]));

    this.state = {
      ...this.state,
      hiddenProjects: nextHidden
    };

    let selectedKey = this.state.selectedKey;
    if (selectedKey) {
      const desc = this.state.descriptors.find(d => d.key === selectedKey);
      if (desc) {
        const wsPath = getWorkspaceFullPath(desc);
        if (wsPath && nextHidden.has(wsPath)) {
          const visible = this.getVisibleDescriptors();
          selectedKey = visible[0]?.key;
        }
      }
    }

    this.updateState({ selectedKey });
    if (selectedKey && !this.state.sessions.has(selectedKey)) {
      void this.selectSession(selectedKey);
    }
  }

  showProject(projectPath: string): void {
    const nextHidden = new Set(this.state.hiddenProjects);
    nextHidden.delete(projectPath);
    localStorage.setItem("thread-atlas-hidden-projects", JSON.stringify([...nextHidden]));
    this.updateState({ hiddenProjects: nextHidden });
  }

  clearHiddenProjects(): void {
    const nextHidden = new Set<string>();
    localStorage.setItem("thread-atlas-hidden-projects", JSON.stringify([]));
    this.updateState({ hiddenProjects: nextHidden });
  }

  private async fetchBundle(key: string): Promise<SessionBundle> {
    const { base, backendKey } = this.connection.routeForKey(key);
    const response = await this.connection.fetch(
      `${base}/session?key=${encodeURIComponent(backendKey)}`
    );
    const payload = (await response.json()) as {
      ok: boolean;
      bundle?: SessionBundle;
      error?: string;
    };

    if (!response.ok || !payload.ok || !payload.bundle) {
      throw new Error(payload.error ?? "Failed to load session bundle.");
    }

    return payload.bundle;
  }

  private updateState(partial: Partial<StoreState>): void {
    this.state = {
      ...this.state,
      ...partial
    };

    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
}

function toDescriptor(bundle: SessionBundle): SessionDescriptor {
  const { files: _files, ...descriptor } = bundle;
  return descriptor;
}

/**
 * Stamps a scanned descriptor with its originating connection so sessions from
 * multiple machines can coexist in one list. Remote descriptors get a
 * namespaced key (to avoid path collisions across hosts), a "remote" origin,
 * and the connection label for display.
 */
function tagDescriptor(descriptor: SessionDescriptor, target: ScanTarget): SessionDescriptor {
  if (target.mode === "local") {
    return {
      ...descriptor,
      connectionId: target.id,
      connectionLabel: target.label
    };
  }
  return {
    ...descriptor,
    key: ConnectionManager.namespaceKey(target, descriptor.key),
    origin: "remote",
    connectionId: target.id,
    connectionLabel: target.label,
    connectionDetail: target.detail
  };
}

function mergeDescriptors(
  importedBundles: ReadonlyMap<string, SessionBundle>,
  localDescriptors: SessionDescriptor[]
): SessionDescriptor[] {
  const merged = new Map<string, SessionDescriptor>();

  for (const bundle of importedBundles.values()) {
    merged.set(bundle.key, toDescriptor(bundle));
  }

  for (const descriptor of localDescriptors) {
    merged.set(descriptor.key, descriptor);
  }

  return [...merged.values()].sort(compareDescriptors);
}

function resolveSelectedKey(
  descriptors: SessionDescriptor[],
  currentSelectedKey?: string
): string | undefined {
  if (currentSelectedKey && descriptors.some((descriptor) => descriptor.key === currentSelectedKey)) {
    return currentSelectedKey;
  }

  try {
    const storedKey = localStorage.getItem("thread-atlas-selected-session-key");
    if (storedKey && descriptors.some((descriptor) => descriptor.key === storedKey)) {
      return storedKey;
    }
  } catch (e) {
    // Ignore storage errors
  }

  return descriptors[0]?.key;
}

function compareDescriptors(left: SessionDescriptor, right: SessionDescriptor): number {
  const timeDelta = right.mtimeMs - left.mtimeMs;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.title.localeCompare(right.title);
}

export function getWorkspaceFullPath(descriptor: SessionDescriptor): string {
  const rawWorkspace = 
    descriptor.metadata?.primaryWorkspace || 
    descriptor.metadata?.cwd || 
    descriptor.metadata?.directory;

  if (typeof rawWorkspace === "string" && rawWorkspace.trim()) {
    return rawWorkspace.trim();
  }

  // Claude inference from path
  const pathStr = descriptor.primaryPath || "";
  const claudeMatch = pathStr.match(/[\\/]\.claude[\\/]projects[\\/]([^\\/]+)/i);
  if (claudeMatch && claudeMatch[1]) {
    const rawFolder = claudeMatch[1];
    if (rawFolder.startsWith("-")) {
      return "/" + rawFolder.slice(1).replace(/-/g, "/");
    }
    return rawFolder.replace(/-/g, "/");
  }

  return "";
}

export function getWorkspaceLabel(descriptor: SessionDescriptor): string {
  const fullPath = getWorkspaceFullPath(descriptor);
  if (!fullPath) {
    return "";
  }

  // If it's a path, extract the last folder/directory name
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  const lastPart = parts.at(-1);
  return lastPart ?? fullPath;
}
