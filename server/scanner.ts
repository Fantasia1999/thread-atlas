import path from "node:path";

import { compareDescriptors } from "../shared/descriptors.js";
import type {
  SessionBundle,
  SessionDescriptor,
  SessionSource
} from "../shared/types.js";
import { isWithinPathRoot } from "../shared/pathUtils.js";
import { SCAN_ROOT_FIELDS } from "./platformRoots.js";
import { resolveEffectiveScanRoots } from "./scanRoots.js";
import { CONFIGURABLE_SOURCES } from "./scanConfig.js";
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
  const roots = await resolveEffectiveScanRoots();
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
        : adapter.scanRoots(roots).map((root) =>
            scanDefaultFileTree({
              root: root.path,
              source: adapter.id,
              archiveLabel: root.archiveLabel
            })
          )
    ),
    scanDefaultFileTree({
      root: REMOTE_SYNC_ROOT,
      origin: "remote",
      precollectedFiles: remoteFiles
    }),
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

  // A configured root can live anywhere (an external drive, a shared mount) and
  // need not follow the product's directory naming, so resolve the owning root
  // from the effective configuration rather than from the path shape.
  const owner = await findOwningScanRoot(absolutePath);

  return await loadDefaultFileBundle(
    absolutePath,
    owner?.source ?? inferSourceFromPath(absolutePath),
    inferDescriptorOrigin(absolutePath, REMOTE_SYNC_ROOT),
    owner?.label
  );
}

/**
 * Maps a session file back to the configured scan root it belongs to, so its
 * source and archive label survive a bundle load. The longest matching root
 * wins, which keeps nested roots (a root inside another root) unambiguous.
 */
async function findOwningScanRoot(
  absolutePath: string
): Promise<{ source: SessionSource; label?: string } | undefined> {
  const roots = await resolveEffectiveScanRoots();

  let best: { source: SessionSource; label?: string; length: number } | undefined;
  for (const field of SCAN_ROOT_FIELDS) {
    const source = CONFIGURABLE_SOURCES.find((entry) => entry.field === field)?.source;
    if (!source) {
      continue;
    }
    for (const root of roots[field]) {
      if (!isWithinPathRoot(absolutePath, root.path)) {
        continue;
      }
      if (!best || root.path.length > best.length) {
        best = { source, label: root.label, length: root.path.length };
      }
    }
  }

  return best ? { source: best.source, label: best.label } : undefined;
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
