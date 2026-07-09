import path from "node:path";

import { compareDescriptors } from "../shared/descriptors.js";
import type {
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../shared/types.js";
import { resolveLocalScanRoots } from "./platformRoots.js";
import {
  collectFiles,
  exists,
  inferDescriptorOrigin,
  loadDefaultFileBundle,
  scanDefaultFileTree
} from "./sources/fsScan.js";
import {
  inferRegisteredSource,
  SERVER_SOURCE_ADAPTERS
} from "./sources/registry.js";
import type { ScanContext } from "./sources/types.js";

const REMOTE_SYNC_ROOT = path.resolve(process.cwd(), "data", "remote");
const FILE_KEY_PREFIX = "file::";

export async function scanLocalSessions(): Promise<SessionDescriptor[]> {
  const roots = resolveLocalScanRoots();
  const remoteFiles = (await exists(REMOTE_SYNC_ROOT))
    ? await collectFiles(REMOTE_SYNC_ROOT, 0)
    : [];
  const context: ScanContext = {
    roots,
    remoteRoot: REMOTE_SYNC_ROOT,
    remoteFiles
  };

  const scanPromises: Array<Promise<SessionDescriptor[]>> = [
    ...SERVER_SOURCE_ADAPTERS.flatMap((adapter) =>
      adapter.scan
        ? []
        : adapter.scanRoots(roots).map((root) => scanDefaultFileTree(root, adapter.id))
    ),
    scanDefaultFileTree(REMOTE_SYNC_ROOT, undefined, "remote", remoteFiles),
    ...SERVER_SOURCE_ADAPTERS.flatMap((adapter) =>
      adapter.scan ? [adapter.scan(context)] : []
    )
  ];

  const descriptorGroups = await Promise.all(scanPromises);
  return dedupeAndSortDescriptors(descriptorGroups.flat());
}

export async function loadLocalSessionBundle(key: string): Promise<SessionBundle> {
  for (const adapter of SERVER_SOURCE_ADAPTERS) {
    if (!adapter.loadBundle) {
      continue;
    }

    const bundle = await adapter.loadBundle(key);
    if (bundle) {
      return bundle;
    }
  }

  if (!key.startsWith(FILE_KEY_PREFIX)) {
    throw new Error("Unsupported session key.");
  }

  const absolutePath = key.slice(FILE_KEY_PREFIX.length);
  return await loadDefaultFileBundle(
    absolutePath,
    inferSourceFromPath(absolutePath),
    inferDescriptorOrigin(absolutePath, REMOTE_SYNC_ROOT)
  );
}

export function inferSourceFromPath(absolutePath: string): SessionSource {
  return inferRegisteredSource(absolutePath);
}

function dedupeAndSortDescriptors(descriptors: SessionDescriptor[]): SessionDescriptor[] {
  const deduped = new Map<string, SessionDescriptor>();
  for (const descriptor of descriptors) {
    deduped.set(descriptor.key, descriptor);
  }

  return [...deduped.values()].sort(compareDescriptors);
}
