import type { SessionBundle, SessionDescriptor, SessionSource } from "../../shared/types.js";
import type { LocalScanRoots } from "../platformRoots.js";

export interface ScanContext {
  roots: LocalScanRoots;
  remoteRoot: string;
  remoteFiles: readonly string[];
}

/** A directory to scan, plus the archive label its sessions should carry. */
export interface ScanRoot {
  path: string;
  /** Set when the root is an archived history copy rather than the live one. */
  archiveLabel?: string;
}

export interface ServerSourceAdapter {
  id: SessionSource;
  scanRoots(roots: LocalScanRoots): ScanRoot[];
  matchPath(absolutePath: string): boolean;
  scan?(context: ScanContext): Promise<SessionDescriptor[]>;
  loadBundle?(key: string): Promise<SessionBundle | undefined>;
}
