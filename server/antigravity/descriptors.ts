import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { BUNDLED_ANTIGRAVITY_DESCRIPTORS } from "./descriptorSnapshot.js";
import { bufferFieldValue, protobufFieldsDict } from "./protoUtils.js";

const EXTENSION_DESCRIPTOR_REGEX = /fileDesc\)\("([A-Za-z0-9+/=]+)"/g;
let bundledDescriptorFiles: Map<string, Buffer> | undefined;
let extensionDescriptorFileMapPromise: Promise<Map<string, Buffer> | null> | undefined;
export function loadBundledDescriptorFiles(): Map<string, Buffer> {
  if (!bundledDescriptorFiles) {
    bundledDescriptorFiles = descriptorMapFromBase64(BUNDLED_ANTIGRAVITY_DESCRIPTORS);
  }

  return bundledDescriptorFiles;
}

export async function loadExtensionDescriptorFiles(): Promise<Map<string, Buffer> | null> {
  if (!extensionDescriptorFileMapPromise) {
    extensionDescriptorFileMapPromise = (async () => {
      try {
        const extensionPath = await discoverExtensionBundle();
        const extensionSource = await fs.readFile(extensionPath, "utf8");
        return descriptorMapFromExtensionSource(extensionSource);
      } catch {
        return null;
      }
    })();
  }

  return await extensionDescriptorFileMapPromise;
}

export async function discoverExtensionBundle(): Promise<string> {
  const baseDir = path.join(os.homedir(), ".antigravity-server", "bin");
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const extensionPath = path.join(
          baseDir,
          entry.name,
          "extensions",
          "antigravity",
          "dist",
          "extension.js"
        );
        try {
          const stats = await fs.stat(extensionPath);
          return {
            path: extensionPath,
            mtimeMs: stats.mtimeMs
          };
        } catch {
          return undefined;
        }
      })
  );

  const latest = candidates
    .filter((candidate): candidate is { path: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) {
    throw new Error(`Antigravity extension bundle not found under ${baseDir}`);
  }

  return latest.path;
}

export function descriptorMapFromBase64(source: Record<string, string>): Map<string, Buffer> {
  const descriptors = new Map<string, Buffer>();
  for (const [fileName, base64] of Object.entries(source)) {
    descriptors.set(fileName, Buffer.from(base64, "base64"));
  }
  return descriptors;
}

export function descriptorMapFromExtensionSource(source: string): Map<string, Buffer> {
  const descriptors = new Map<string, Buffer>();

  for (const match of source.matchAll(EXTENSION_DESCRIPTOR_REGEX)) {
    const buffer = Buffer.from(match[1], "base64");
    const fileName = extractDescriptorFileName(buffer);
    if (fileName) {
      descriptors.set(fileName, buffer);
    }
  }

  if (descriptors.size === 0) {
    throw new Error("No protobuf descriptors found in Antigravity extension bundle.");
  }

  return descriptors;
}

export function extractDescriptorFileName(buffer: Buffer): string | undefined {
  const fields = protobufFieldsDict(buffer);
  return bufferFieldValue(fields, 1)?.toString("utf8");
}
