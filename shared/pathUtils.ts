export function normalizePathForMatch(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

export function isWithinPathRoot(absolutePath: string, rootPath: string): boolean {
  const normalizedPath = normalizePathForMatch(absolutePath);
  const normalizedRoot = normalizePathForMatch(rootPath);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function basenameFromAnyPath(input: string): string {
  const segments = input.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? input;
}

/**
 * Matches the directory name of a Claude history home: the live `.claude`
 * directory plus archived copies such as `claude-backup-pc1` or `.claude.old`.
 * Any suffix must start with a separator so unrelated names like
 * `claudecode-notes` are not treated as history roots.
 */
const CLAUDE_HISTORY_DIR_NAME = /^\.?claude(?:[-_. ].*)?$/i;

export function isClaudeHistoryDirName(name: string): boolean {
  return CLAUDE_HISTORY_DIR_NAME.test(name);
}

/**
 * True for `<claude-history-home>/projects/...` paths, so sessions restored from
 * an archived `.claude` copy are recognized the same way as the live directory.
 */
export function isClaudeProjectsPath(absolutePath: string): boolean {
  const segments = normalizePathForMatch(absolutePath).split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index + 1] === "projects" && isClaudeHistoryDirName(segments[index])) {
      return true;
    }
  }
  return false;
}
