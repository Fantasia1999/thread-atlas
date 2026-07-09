import type { SessionBundle, SessionDescriptor, SessionSource } from "../../shared/types.js";
import type { LocalScanRoots } from "../platformRoots.js";

export interface ScanContext {
  roots: LocalScanRoots;
  remoteRoot: string;
  remoteFiles: readonly string[];
}

export interface ServerSourceAdapter {
  id: SessionSource;
  scanRoots(roots: LocalScanRoots): string[];
  matchPath(absolutePath: string): boolean;
  scan?(context: ScanContext): Promise<SessionDescriptor[]>;
  loadBundle?(key: string): Promise<SessionBundle | undefined>;
}
