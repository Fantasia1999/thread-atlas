import { promises as fs } from "node:fs";

import { isRecord } from "./antigravity/shared.js";

export async function isParseableJsonLinesFile(absolutePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
      if (bytesRead === 0) return false;
      const text = buffer.toString("utf8", 0, bytesRead);
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          JSON.parse(trimmed);
          return true;
        } catch {
          // check next line in case of chunk split
        }
      }
      return false;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export function parseJsonLines(content: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        result.push(parsed);
      }
    } catch {
      // Keep parsing other lines in the file even if one is malformed
    }
  }
  return result;
}

export function hasJsonLinesParseError(content: string): boolean {
  let start = 0;
  let checked = 0;
  while (start < content.length && checked < 5) {
    let end = content.indexOf("\n", start);
    if (end === -1) {
      end = content.length;
    }
    let line = content.slice(start, end).trim();
    if (line.endsWith("\r")) {
      line = line.slice(0, -1).trim();
    }
    start = end + 1;
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        return true;
      }
    } catch {
      return true;
    }
    checked++;
  }
  return false;
}
