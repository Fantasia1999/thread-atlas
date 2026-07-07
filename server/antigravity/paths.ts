import { createDecipheriv } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ANTIGRAVITY_KEY } from "./shared.js";
import { fileExists, isParseableJsonLinesFile } from "../fsUtils.js";

export function isAntigravityConversationPath(absolutePath: string): boolean {
  const normalized = absolutePath.replaceAll("\\", "/").toLowerCase();
  return (
    (normalized.includes("/.gemini/antigravity/conversations/") ||
      normalized.includes("/.gemini/antigravity-cli/conversations/")) &&
    (normalized.endsWith(".pb") || normalized.endsWith(".db"))
  );
}

export function isAntigravityTranscriptPath(absolutePath: string): boolean {
  const normalized = absolutePath.replaceAll("\\", "/").toLowerCase();
  return (
    (normalized.includes("/.gemini/antigravity/brain/") ||
      normalized.includes("/.gemini/antigravity-cli/brain/")) &&
    normalized.endsWith("/.system_generated/logs/transcript_full.jsonl")
  );
}

export function antigravitySessionIdFromPath(absolutePath: string): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const brainMatch = normalized.match(/\/brain\/([^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/i);
  if (brainMatch?.[1]) {
    return brainMatch[1];
  }

  if (isAntigravityConversationPath(absolutePath)) {
    return path.basename(absolutePath, absolutePath.toLowerCase().endsWith(".db") ? ".db" : ".pb");
  }

  return undefined;
}

export async function resolvePreferredAntigravitySessionPath(
  absolutePath: string
): Promise<string | undefined> {
  if (isAntigravityTranscriptPath(absolutePath)) {
    const fallback = resolveConversationPathFromTranscriptPath(absolutePath);
    if (fallback) {
      const dbFallback = fallback.replace(/\.pb$/, ".db");
      if (await fileExists(dbFallback)) {
        return dbFallback;
      }
    }

    if (await isParseableJsonLinesFile(absolutePath)) {
      return absolutePath;
    }

    if (fallback && (await fileExists(fallback))) {
      return fallback;
    }

    return undefined;
  }

  if (!isAntigravityConversationPath(absolutePath)) {
    return undefined;
  }

  const isDb = absolutePath.toLowerCase().endsWith(".db");
  const dbPath = isDb ? absolutePath : absolutePath.replace(/\.pb$/, ".db");
  if (await fileExists(dbPath)) {
    return dbPath;
  }

  const cascadeId = path.basename(absolutePath, isDb ? ".db" : ".pb");
  const transcriptPath = resolveTranscriptPathFromConversationPath(absolutePath, cascadeId);
  if (transcriptPath && (await isParseableJsonLinesFile(transcriptPath))) {
    return transcriptPath;
  }

  return absolutePath;
}

export async function isScannableAntigravitySessionPath(absolutePath: string): Promise<boolean> {
  if (isAntigravityTranscriptPath(absolutePath)) {
    return await isParseableJsonLinesFile(absolutePath);
  }

  if (!isAntigravityConversationPath(absolutePath)) {
    return false;
  }

  try {
    const isDb = absolutePath.toLowerCase().endsWith(".db");
    if (isDb) {
      const db = new DatabaseSync(absolutePath, { readOnly: true });
      try {
        db.prepare("SELECT 1 FROM steps LIMIT 1;").get();
        return true;
      } finally {
        db.close();
      }
    }

    const encrypted = await fs.readFile(absolutePath);
    if (encrypted.length < 28) {
      return false;
    }
    const nonce = encrypted.subarray(0, 12);
    const ciphertext = encrypted.subarray(12, encrypted.length - 16);
    const tag = encrypted.subarray(encrypted.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", ANTIGRAVITY_KEY, nonce);
    decipher.setAuthTag(tag);
    decipher.update(ciphertext);
    decipher.final();
    return true;
  } catch {
    return false;
  }
}
export function resolveBrainDirFromConversationPath(
  absolutePath: string,
  cascadeId: string
): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const marker = "/conversations/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) {
    return undefined;
  }

  return path.join(normalized.slice(0, index), "brain", cascadeId);
}

export function resolveTranscriptPathFromConversationPath(
  absolutePath: string,
  cascadeId: string
): string | undefined {
  const brainDir = resolveBrainDirFromConversationPath(absolutePath, cascadeId);
  return brainDir
    ? path.join(brainDir, ".system_generated", "logs", "transcript_full.jsonl")
    : undefined;
}

export function resolveConversationPathFromTranscriptPath(absolutePath: string): string | undefined {
  const normalized = absolutePath.replaceAll("\\", "/");
  const match = normalized.match(
    /^(.*)\/brain\/([^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/i
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return path.join(match[1], "conversations", `${match[2]}.pb`);
}
