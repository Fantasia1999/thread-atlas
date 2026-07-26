export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseJsonLines(text: string): unknown[] {
  const entries: unknown[] = [];
  const length = text.length;
  let start = 0;

  while (start < length) {
    let end = text.indexOf("\n", start);
    if (end === -1) {
      end = length;
    }
    const line = text.slice(start, end).trim();
    if (line) {
      const entry = safeJsonParse(line);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    start = end + 1;
  }

  return entries;
}
