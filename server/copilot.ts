export const COPILOT_EVENTS_FILE = "events.jsonl";

export const COPILOT_OPTIONAL_BUNDLE_FILES = [
  "workspace.yaml",
  "vscode.metadata.json",
  "plan.md",
  "checkpoints/index.md"
] as const;

export const COPILOT_BUNDLE_FILES = [
  COPILOT_EVENTS_FILE,
  ...COPILOT_OPTIONAL_BUNDLE_FILES
] as const;
