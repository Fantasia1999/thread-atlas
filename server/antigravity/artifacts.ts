import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function artifactRecords(
  cascadeId: string,
  trajectoryId: unknown,
  summary: string | undefined,
  brainDir: string
): Promise<Record<string, unknown>[]> {
  try {
    const stats = await fs.stat(brainDir);
    if (!stats.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const paths = await collectMarkdownFiles(brainDir);
  const records: Record<string, unknown>[] = [];

  for (const absolutePath of paths) {
    const metadataPath = `${absolutePath}.metadata.json`;
    let metadata: unknown;
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    } catch {
      metadata = undefined;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    records.push({
      record_type: "artifact",
      profile: "chat",
      role: "artifact",
      cascade_id: cascadeId,
      trajectory_id: trajectoryId,
      summary,
      artifact_path: absolutePath,
      artifact_path_uri: pathToFileURL(absolutePath).toString(),
      artifact_rel_path: path.relative(brainDir, absolutePath),
      content,
      artifact_metadata: metadata
    });
  }

  return records;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return await collectMarkdownFiles(absolutePath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        return [];
      }

      return [absolutePath];
    })
  );

  return nested.flat().sort((left, right) => left.localeCompare(right));
}
