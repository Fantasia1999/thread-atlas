import { collectText, normalizeRole, previewText } from "../parserUtils.js";

export function extractUserRequest(text: string): string {
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match) {
    return match[1].trim();
  }
  if (text.includes("<USER_REQUEST>")) {
    return text.replace(/<USER_REQUEST>/gi, "").replace(/<\/USER_REQUEST>/gi, "").trim();
  }
  return text.trim();
}

export function extractAntigravityPreviewTitle(content: string): string | undefined {
  let start = 0;
  while (start < content.length) {
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
      const row = JSON.parse(line) as Record<string, unknown>;
      if (!row || typeof row !== "object") {
        continue;
      }
      const recordType = String(row.record_type ?? "");
      const stepType = String(row.type ?? "");
      const role = String(row.role ?? "");

      const isUser =
        stepType === "USER_INPUT" ||
        (recordType === "message" && normalizeRole(role) === "user");

      if (isUser) {
        const rawContent = collectText(row.content);
        const text = extractUserRequest(rawContent);
        if (text.trim()) {
          return previewText(text, 80);
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}
