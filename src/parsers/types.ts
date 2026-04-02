export type SessionSource =
  | "codex"
  | "claude"
  | "opencode"
  | "gemini"
  | "antigravity"
  | "copilot"
  | "unknown";
export type SessionRole = "user" | "assistant" | "system" | "developer" | "tool";
export type SessionOrigin = "local" | "remote" | "imported";
export type SessionTransport = "local-scan" | "ssh-sync" | "browser-file";
export type MetadataValue = string | number | boolean | null;

export interface SessionFile {
  path: string;
  content: string;
}

export interface SessionDescriptor {
  key: string;
  source: SessionSource;
  title: string;
  primaryPath: string;
  relatedPaths: string[];
  transport: SessionTransport;
  origin: SessionOrigin;
  fileCount: number;
  size: number;
  mtimeMs: number;
  metadata: Record<string, MetadataValue>;
}

export interface SessionBundle extends SessionDescriptor {
  files: SessionFile[];
}

export interface ToolCall {
  id: string;
  toolName: string;
  kind: string;
  status: "pending" | "completed" | "error" | "unknown";
  args?: string;
  output?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Message {
  id: string;
  role: SessionRole;
  text: string;
  createdAt?: string;
  rawType?: string;
  toolCalls?: ToolCall[];
}

export interface Session {
  id: string;
  source: SessionSource;
  title: string;
  summary: string;
  cwd?: string;
  startedAt?: string;
  updatedAt?: string;
  primaryPath: string;
  messageCount: number;
  messages: Message[];
  metadata: Record<string, MetadataValue>;
  rawFiles: string[];
}
