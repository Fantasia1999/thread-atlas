import type { SessionSource } from "../../shared/types.js";
import type { ConnectionManager } from "./connection.js";

export type ScanRootKind = "default" | "discovered" | "custom";

export interface DescribedScanRoot {
  source: SessionSource;
  path: string;
  label?: string;
  kind: ScanRootKind;
  enabled: boolean;
  id?: string;
  exists: boolean;
}

export interface CustomScanRoot {
  id: string;
  source: SessionSource;
  path: string;
  label?: string;
  enabled: boolean;
}

export interface ScanRootsConfig {
  version: number;
  customRoots: CustomScanRoot[];
  disabledDefaults: string[];
}

export interface ConfigurableSource {
  source: SessionSource;
  hint: string;
  kind: "directory" | "file";
}

export interface ScanRootsSnapshot {
  roots: DescribedScanRoot[];
  config: ScanRootsConfig;
  sources: ConfigurableSource[];
  home: string;
  separator: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

export interface ScanRootInspection {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  detectedSource?: SessionSource;
  sessionFileCount: number;
  countCapped: boolean;
  message: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

/**
 * Talks to the local agent's scan-root endpoints. Root configuration is owned by
 * the agent that does the scanning, so this always targets the local agent
 * rather than a remote one.
 */
export class ScanRootsClient {
  constructor(private readonly connection: ConnectionManager) {}

  async load(): Promise<ScanRootsSnapshot> {
    const response = await this.connection.fetch("/api/local/roots");
    return await readJson<ScanRootsSnapshot>(response);
  }

  async save(config: {
    customRoots: CustomScanRoot[];
    disabledDefaults: string[];
  }): Promise<{ config: ScanRootsConfig; roots: DescribedScanRoot[] }> {
    const response = await this.connection.fetch("/api/local/roots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });
    return await readJson<{ config: ScanRootsConfig; roots: DescribedScanRoot[] }>(response);
  }

  async browse(path: string): Promise<DirectoryListing> {
    const response = await this.connection.fetch(
      `/api/local/browse?path=${encodeURIComponent(path)}`
    );
    const payload = await readJson<{ listing: DirectoryListing }>(response);
    return payload.listing;
  }

  async inspect(path: string, source?: SessionSource): Promise<ScanRootInspection> {
    const response = await this.connection.fetch("/api/local/roots/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, source })
    });
    const payload = await readJson<{ result: ScanRootInspection }>(response);
    return payload.result;
  }
}

/** Groups described roots by source, preserving the server's ordering. */
export function groupRootsBySource(
  roots: readonly DescribedScanRoot[]
): Map<SessionSource, DescribedScanRoot[]> {
  const grouped = new Map<SessionSource, DescribedScanRoot[]>();
  for (const root of roots) {
    const existing = grouped.get(root.source);
    if (existing) {
      existing.push(root);
    } else {
      grouped.set(root.source, [root]);
    }
  }
  return grouped;
}

/** Normalizes a path the same way the backend does, for local comparisons. */
export function normalizeRootKey(rootPath: string): string {
  return rootPath.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "");
}
