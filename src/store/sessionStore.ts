import { parseSessionBundle } from "../parsers/detect.js";
import type {
  Session,
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../parsers/types.js";

export interface StoreState {
  descriptors: SessionDescriptor[];
  sessions: Map<string, Session>;
  selectedKey?: string;
  sourceFilter: SessionSource | "all";
  search: string;
  loadingScan: boolean;
  loadingSession: boolean;
  status: string;
}

type Listener = (state: StoreState) => void;

export class SessionStore {
  private listeners = new Set<Listener>();
  private importedBundles = new Map<string, SessionBundle>();
  private cachedKeysOrder: string[] = [];
  private state: StoreState = {
    descriptors: [],
    sessions: new Map(),
    sourceFilter: "all",
    search: "",
    loadingScan: false,
    loadingSession: false,
    status: "Ready."
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): StoreState {
    return {
      ...this.state,
      descriptors: [...this.state.descriptors],
      sessions: new Map(this.state.sessions)
    };
  }

  getVisibleDescriptors(): SessionDescriptor[] {
    const query = this.state.search.trim().toLowerCase();

    return this.state.descriptors.filter((descriptor) => {
      if (this.state.sourceFilter !== "all" && descriptor.source !== this.state.sourceFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        descriptor.title.toLowerCase().includes(query) ||
        descriptor.primaryPath.toLowerCase().includes(query)
      );
    });
  }

  setSearch(search: string): void {
    this.updateState({ search });
  }

  setSourceFilter(sourceFilter: SessionSource | "all"): void {
    this.updateState({ sourceFilter });
  }

  async refreshLocalScan(): Promise<void> {
    this.updateState({
      loadingScan: true,
      status: "Scanning local session directories..."
    });

    try {
      const response = await fetch("/api/local/scan");
      const payload = (await response.json()) as {
        ok: boolean;
        files?: SessionDescriptor[];
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.files) {
        throw new Error(payload.error ?? "Local scan failed.");
      }

      const merged = mergeDescriptors(this.importedBundles, payload.files);
      const selectedKey = resolveSelectedKey(merged, this.state.selectedKey);

      this.updateState({
        descriptors: merged,
        selectedKey,
        loadingScan: false,
        status: `Loaded ${merged.length} sessions.`
      });

      if (selectedKey && !this.state.sessions.has(selectedKey)) {
        await this.selectSession(selectedKey);
      }
    } catch (error) {
      this.updateState({
        loadingScan: false,
        status: error instanceof Error ? error.message : "Local scan failed."
      });
    }
  }

  async selectSession(key: string): Promise<void> {
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

  private async fetchBundle(key: string): Promise<SessionBundle> {
    const response = await fetch(`/api/local/session?key=${encodeURIComponent(key)}`);
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

  return descriptors[0]?.key;
}

function compareDescriptors(left: SessionDescriptor, right: SessionDescriptor): number {
  const timeDelta = right.mtimeMs - left.mtimeMs;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.title.localeCompare(right.title);
}
