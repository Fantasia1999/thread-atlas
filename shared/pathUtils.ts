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
