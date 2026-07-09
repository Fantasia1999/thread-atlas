import type { SessionSource } from "../../shared/types.js";
import {
  antigravityFileSource,
  claudeFileSource,
  codexFileSource,
  copilotFileSource,
  geminiFileSource,
  opencodeFileSource
} from "./fileSources.js";
import type { ServerSourceAdapter } from "./types.js";

export const SERVER_SOURCE_ADAPTERS: readonly ServerSourceAdapter[] = [
  antigravityFileSource,
  codexFileSource,
  claudeFileSource,
  opencodeFileSource,
  copilotFileSource,
  geminiFileSource
];

export function getServerAdapter(id: SessionSource): ServerSourceAdapter | undefined {
  return SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.id === id);
}

export function inferRegisteredSource(absolutePath: string): SessionSource {
  return SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.matchPath(absolutePath))?.id ?? "unknown";
}
