import type { SessionSource } from "../../shared/types.js";
import { antigravitySource } from "./antigravity.js";
import { copilotSource } from "./copilot.js";
import {
  FILE_SOURCE_ADAPTERS
} from "./fileSources.js";
import { opencodeSource } from "./opencode.js";
import type { ServerSourceAdapter } from "./types.js";

const specialAdapters = new Map<SessionSource, ServerSourceAdapter>([
  [antigravitySource.id, antigravitySource],
  [opencodeSource.id, opencodeSource],
  [copilotSource.id, copilotSource]
]);

export const SERVER_SOURCE_ADAPTERS: readonly ServerSourceAdapter[] =
  FILE_SOURCE_ADAPTERS.map((adapter) => specialAdapters.get(adapter.id) ?? adapter);

export function getServerAdapter(id: SessionSource): ServerSourceAdapter | undefined {
  return SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.id === id);
}

export function inferRegisteredSource(absolutePath: string): SessionSource {
  return SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.matchPath(absolutePath))?.id ?? "unknown";
}
