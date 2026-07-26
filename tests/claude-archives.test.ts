import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  discoverClaudeHistoryRoots,
  resolveScanRootsWithArchives
} from "../server/claudeArchives.ts";
import {
  mergeClaudeHistoryRoots,
  resolveLocalScanRoots
} from "../server/platformRoots.ts";
import { scanDefaultFileTree } from "../server/sources/fsScan.ts";
import { SERVER_SOURCE_ADAPTERS } from "../server/sources/registry.ts";
import { isClaudeHistoryDirName, isClaudeProjectsPath } from "../shared/pathUtils.ts";

async function makeHome(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "atlas-claude-archives-"));
}

async function writeSession(
  projectsDir: string,
  projectName: string,
  fileName: string,
  prompt: string
): Promise<string> {
  const dir = path.join(projectsDir, projectName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const rows = [
    JSON.stringify({
      type: "user",
      cwd: "/workspace/demo",
      sessionId: fileName.replace(/\.jsonl$/, ""),
      message: { role: "user", content: [{ type: "text", text: prompt }] }
    })
  ];
  await fs.writeFile(filePath, `${rows.join("\n")}\n`, "utf8");
  return filePath;
}

test("isClaudeHistoryDirName accepts archive copies but rejects unrelated names", () => {
  for (const name of [".claude", "claude", "claude-backup-pc1", ".claude.old", "claude_bak"]) {
    assert.equal(isClaudeHistoryDirName(name), true, name);
  }
  for (const name of ["claudecode-notes", "notclaude", "anthropic", "projects"]) {
    assert.equal(isClaudeHistoryDirName(name), false, name);
  }
});

test("isClaudeProjectsPath recognizes archived history layouts on both separators", () => {
  assert.equal(isClaudeProjectsPath("/home/a/.claude/projects/demo/s.jsonl"), true);
  assert.equal(isClaudeProjectsPath("/home/a/claude-backup-pc1/projects/demo/s.jsonl"), true);
  assert.equal(
    isClaudeProjectsPath("C:\\Users\\a\\claude-backup-pc1\\projects\\demo\\s.jsonl"),
    true
  );
  assert.equal(isClaudeProjectsPath("/home/a/.codex/sessions/rollout-1.jsonl"), false);
  assert.equal(isClaudeProjectsPath("/home/a/claudecode-notes/projects/x.jsonl"), false);
});

test("ATLAS_CLAUDE_ROOTS adds labeled roots and accepts both home and projects paths", () => {
  const roots = resolveLocalScanRoots({
    platform: "linux",
    home: "/home/alice",
    env: { ATLAS_CLAUDE_ROOTS: "/mnt/backup/pc1-claude:/mnt/backup/pc2/projects" }
  });

  assert.deepEqual(roots.claudeProjects, [
    { projectsPath: "/home/alice/.claude/projects" },
    { projectsPath: "/mnt/backup/pc1-claude/projects", label: "pc1-claude" },
    { projectsPath: "/mnt/backup/pc2/projects", label: "pc2" }
  ]);
});

test("ATLAS_CLAUDE_ROOTS splits on semicolons so Windows drive letters survive", () => {
  const roots = resolveLocalScanRoots({
    platform: "win32",
    home: "C:\\Users\\alice",
    env: { ATLAS_CLAUDE_ROOTS: "D:\\backups\\claude-pc1;E:\\claude-pc2" }
  });

  assert.deepEqual(roots.claudeProjects, [
    { projectsPath: "C:\\Users\\alice\\.claude\\projects" },
    { projectsPath: "D:\\backups\\claude-pc1\\projects", label: "claude-pc1" },
    { projectsPath: "E:\\claude-pc2\\projects", label: "claude-pc2" }
  ]);
});

test("mergeClaudeHistoryRoots keeps the first entry for duplicate projects paths", () => {
  const merged = mergeClaudeHistoryRoots(
    [{ projectsPath: "/home/a/.claude/projects" }],
    [
      { projectsPath: "/home/a/.claude/projects", label: ".claude" },
      { projectsPath: "/home/a/claude-backup-pc1/projects", label: "claude-backup-pc1" }
    ]
  );

  assert.deepEqual(merged, [
    { projectsPath: "/home/a/.claude/projects" },
    { projectsPath: "/home/a/claude-backup-pc1/projects", label: "claude-backup-pc1" }
  ]);
});

test("discoverClaudeHistoryRoots finds archive copies next to the live .claude", async () => {
  const home = await makeHome();
  try {
    await fs.mkdir(path.join(home, ".claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(home, "claude-backup-pc1", "projects"), { recursive: true });
    await fs.mkdir(path.join(home, "claude-backup-pc2", "projects"), { recursive: true });
    // Claude-like name but no projects directory: not a history root.
    await fs.mkdir(path.join(home, "claude-notes"), { recursive: true });
    // Has projects but an unrelated name: not a history root.
    await fs.mkdir(path.join(home, "workspace", "projects"), { recursive: true });

    const discovered = await discoverClaudeHistoryRoots({ home });
    const labels = discovered.map((root) => root.label).sort();

    assert.deepEqual(labels, [".claude", "claude-backup-pc1", "claude-backup-pc2"]);
    for (const root of discovered) {
      assert.equal(root.projectsPath, path.join(home, root.label!, "projects"));
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("discoverClaudeHistoryRoots returns nothing when the home is unreadable", async () => {
  const discovered = await discoverClaudeHistoryRoots({
    home: path.join(os.tmpdir(), "atlas-missing-home-does-not-exist")
  });
  assert.deepEqual(discovered, []);
});

test("resolveScanRootsWithArchives keeps the live root unlabeled and first", async () => {
  const home = await makeHome();
  try {
    await fs.mkdir(path.join(home, ".claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(home, "claude-backup-pc1", "projects"), { recursive: true });

    const roots = await resolveScanRootsWithArchives({ platform: "linux", home, env: {} });

    assert.equal(roots.claudeProjects[0].projectsPath, path.join(home, ".claude", "projects"));
    assert.equal(roots.claudeProjects[0].label, undefined);
    assert.deepEqual(
      roots.claudeProjects.slice(1).map((root) => root.label),
      ["claude-backup-pc1"]
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("scanning an archived root tags descriptors with the archive label", async () => {
  const home = await makeHome();
  try {
    const liveProjects = path.join(home, ".claude", "projects");
    const archiveProjects = path.join(home, "claude-backup-pc1", "projects");
    await writeSession(liveProjects, "demo", "live-session.jsonl", "Live machine question");
    await writeSession(archiveProjects, "demo", "archived-session.jsonl", "Backup machine question");

    const roots = await resolveScanRootsWithArchives({ platform: "linux", home, env: {} });
    const claudeAdapter = SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.id === "claude");
    assert.ok(claudeAdapter);

    const scanRoots = claudeAdapter.scanRoots(roots);
    const descriptors = (
      await Promise.all(
        scanRoots.map((root) =>
          scanDefaultFileTree({
            root: root.path,
            source: "claude",
            archiveLabel: root.archiveLabel
          })
        )
      )
    ).flat();

    assert.equal(descriptors.length, 2);

    const live = descriptors.find((d) => d.primaryPath.includes("live-session"));
    const archived = descriptors.find((d) => d.primaryPath.includes("archived-session"));
    assert.ok(live);
    assert.ok(archived);

    // Both parse as claude sessions with titles extracted from their content.
    assert.equal(live.source, "claude");
    assert.equal(archived.source, "claude");
    assert.equal(live.title, "Live machine question");
    assert.equal(archived.title, "Backup machine question");

    // Only the archived one carries a label, so the UI can tell them apart.
    assert.equal(live.archiveLabel, undefined);
    assert.equal(archived.archiveLabel, "claude-backup-pc1");

    // Archived sessions get distinct keys, so they never collide with live ones.
    assert.notEqual(live.key, archived.key);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("archived session paths still infer the claude source", () => {
  const claudeAdapter = SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.id === "claude");
  assert.ok(claudeAdapter);
  assert.equal(
    claudeAdapter.matchPath("/home/a/claude-backup-pc1/projects/demo/s.jsonl"),
    true
  );
  assert.equal(claudeAdapter.matchPath("/home/a/.claude/projects/demo/s.jsonl"), true);
});
