import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  emptyScanRootsConfig,
  readScanRootsConfig,
  sanitizeScanRootsConfig,
  writeScanRootsConfig,
  CONFIGURABLE_SOURCES,
  scanRootFieldForSource
} from "../server/scanConfig.ts";
import { describeScanRoots, resolveEffectiveScanRoots } from "../server/scanRoots.ts";
import { browseDirectory, inspectScanRootCandidate, resolveUserPath } from "../server/pathBrowser.ts";

async function makeDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "atlas-scan-config-"));
}

async function writeClaudeSession(projectsDir: string, name: string): Promise<string> {
  const dir = path.join(projectsDir, "demo");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(
    filePath,
    `${JSON.stringify({
      type: "user",
      cwd: "/workspace/demo",
      message: { role: "user", content: [{ type: "text", text: `Prompt from ${name}` }] }
    })}\n`,
    "utf8"
  );
  return filePath;
}

test("every configurable source maps to a root field", () => {
  for (const entry of CONFIGURABLE_SOURCES) {
    assert.equal(scanRootFieldForSource(entry.source), entry.field, entry.source);
  }
  assert.equal(scanRootFieldForSource("unknown"), undefined);
});

test("sanitizeScanRootsConfig drops malformed entries and dedupes roots", () => {
  const config = sanitizeScanRootsConfig({
    version: 1,
    customRoots: [
      { id: "a", source: "codex", path: "/data/codex", enabled: true },
      // Unknown source is dropped.
      { id: "b", source: "nonsense", path: "/data/other" },
      // Blank path is dropped.
      { id: "c", source: "claude", path: "   " },
      // Duplicate of the first entry is dropped.
      { id: "d", source: "codex", path: "/data/codex/" },
      // Same path under a different source is kept.
      { id: "e", source: "claude", path: "/data/codex" },
      "not an object"
    ],
    disabledDefaults: ["/Home/Alice/.codex/sessions/", "", "/home/bob/.claude/projects"]
  });

  assert.deepEqual(
    config.customRoots.map((root) => [root.source, root.path]),
    [
      ["codex", "/data/codex"],
      ["claude", "/data/codex"]
    ]
  );
  assert.deepEqual(config.disabledDefaults, [
    "/home/alice/.codex/sessions",
    "/home/bob/.claude/projects"
  ]);
});

test("sanitizeScanRootsConfig assigns ids when they are missing or duplicated", () => {
  const config = sanitizeScanRootsConfig({
    customRoots: [
      { source: "codex", path: "/a" },
      { id: "dup", source: "codex", path: "/b" },
      { id: "dup", source: "codex", path: "/c" }
    ]
  });

  const ids = config.customRoots.map((root) => root.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

test("scan roots config round-trips through disk and tolerates a missing file", async () => {
  const dir = await makeDir();
  try {
    const configPath = path.join(dir, "scan-roots.json");

    // Missing file reads as an empty config rather than throwing.
    assert.deepEqual(await readScanRootsConfig(configPath), emptyScanRootsConfig());

    await writeScanRootsConfig(
      {
        version: 1,
        customRoots: [
          { id: "one", source: "claude", path: "/data/pc1", label: "pc1", enabled: true }
        ],
        disabledDefaults: ["/home/a/.codex/sessions"]
      },
      configPath
    );

    const reread = await readScanRootsConfig(configPath);
    assert.deepEqual(reread.customRoots, [
      { id: "one", source: "claude", path: "/data/pc1", label: "pc1", enabled: true }
    ]);
    assert.deepEqual(reread.disabledDefaults, ["/home/a/.codex/sessions"]);

    // A corrupted file degrades to an empty config instead of breaking scans.
    await fs.writeFile(configPath, "{not json", "utf8");
    assert.deepEqual(await readScanRootsConfig(configPath), emptyScanRootsConfig());
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("custom roots are added per source and disabled defaults are removed", async () => {
  const home = await makeDir();
  const extra = await makeDir();
  try {
    const roots = await resolveEffectiveScanRoots({
      platform: "linux",
      home,
      env: {},
      config: {
        version: 1,
        customRoots: [
          { id: "c1", source: "codex", path: `${extra}/codex-archive`, enabled: true },
          { id: "c2", source: "antigravity", path: `${extra}/ag-archive`, enabled: true },
          // Disabled entries never reach the scanner.
          { id: "c3", source: "gemini", path: `${extra}/gemini-off`, enabled: false }
        ],
        disabledDefaults: [`${home}/.claude/projects`.toLowerCase()]
      }
    });

    assert.deepEqual(
      roots.codexSessions.map((root) => root.path),
      [`${home}/.codex/sessions`, `${extra}/codex-archive`]
    );
    assert.equal(roots.antigravityRoots.length, 3);
    assert.equal(roots.antigravityRoots.at(-1)?.path, `${extra}/ag-archive`);
    assert.deepEqual(roots.geminiTmp.map((root) => root.path), [`${home}/.gemini/tmp`]);

    // The disabled Claude default is gone.
    assert.deepEqual(roots.claudeProjects, []);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(extra, { recursive: true, force: true });
  }
});

test("custom roots derive a badge label from the directory name", async () => {
  const home = await makeDir();
  try {
    const roots = await resolveEffectiveScanRoots({
      platform: "linux",
      home,
      env: {},
      config: {
        version: 1,
        customRoots: [
          { id: "c1", source: "codex", path: "/mnt/backup/pc1-codex", enabled: true },
          { id: "c2", source: "claude", path: "/mnt/backup/pc2", label: "Laptop", enabled: true },
          { id: "c3", source: "opencode", path: "/mnt/backup/pc3/opencode.db", enabled: true }
        ],
        disabledDefaults: []
      }
    });

    assert.equal(roots.codexSessions.at(-1)?.label, "pc1-codex");
    assert.equal(roots.claudeProjects.at(-1)?.label, "Laptop");
    // For a file root the label falls back to the containing folder.
    assert.equal(roots.openCodeDb.at(-1)?.label, "pc3");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("describeScanRoots reports kind, enabled state and existence", async () => {
  const home = await makeDir();
  try {
    await fs.mkdir(path.join(home, ".codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(home, "claude-backup-pc1", "projects"), { recursive: true });

    const described = await describeScanRoots({
      platform: "linux",
      home,
      env: {},
      config: {
        version: 1,
        customRoots: [
          { id: "c1", source: "codex", path: path.join(home, "missing-dir"), enabled: false }
        ],
        disabledDefaults: [path.join(home, ".gemini", "tmp").toLowerCase()]
      }
    });

    const codexDefault = described.find(
      (root) => root.path === path.join(home, ".codex", "sessions")
    );
    assert.equal(codexDefault?.kind, "default");
    assert.equal(codexDefault?.enabled, true);
    assert.equal(codexDefault?.exists, true);

    const discovered = described.find((root) => root.kind === "discovered");
    assert.equal(discovered?.source, "claude");
    assert.equal(discovered?.label, "claude-backup-pc1");

    const custom = described.find((root) => root.kind === "custom");
    assert.equal(custom?.enabled, false);
    assert.equal(custom?.exists, false);

    const geminiDefault = described.find(
      (root) => root.path === path.join(home, ".gemini", "tmp")
    );
    assert.equal(geminiDefault?.enabled, false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("configured roots produce labeled descriptors end to end", async () => {
  const home = await makeDir();
  const archive = await makeDir();
  try {
    await writeClaudeSession(path.join(home, ".claude", "projects"), "live.jsonl");
    await writeClaudeSession(path.join(archive, "pc1", "projects"), "archived.jsonl");

    const roots = await resolveEffectiveScanRoots({
      platform: "linux",
      home,
      env: {},
      config: {
        version: 1,
        customRoots: [
          {
            id: "c1",
            source: "claude",
            path: path.join(archive, "pc1", "projects"),
            label: "pc1",
            enabled: true
          }
        ],
        disabledDefaults: []
      }
    });

    const { SERVER_SOURCE_ADAPTERS } = await import("../server/sources/registry.ts");
    const { scanDefaultFileTree } = await import("../server/sources/fsScan.ts");
    const claudeAdapter = SERVER_SOURCE_ADAPTERS.find((adapter) => adapter.id === "claude");
    assert.ok(claudeAdapter);

    const descriptors = (
      await Promise.all(
        claudeAdapter.scanRoots(roots).map((root) =>
          scanDefaultFileTree({ root: root.path, source: "claude", archiveLabel: root.archiveLabel })
        )
      )
    ).flat();

    assert.equal(descriptors.length, 2);
    const live = descriptors.find((d) => d.primaryPath.includes("live.jsonl"));
    const archived = descriptors.find((d) => d.primaryPath.includes("archived.jsonl"));
    assert.equal(live?.archiveLabel, undefined);
    assert.equal(archived?.archiveLabel, "pc1");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(archive, { recursive: true, force: true });
  }
});

test("resolveUserPath expands ~ and resolves relative input", () => {
  assert.equal(resolveUserPath("~"), os.homedir());
  assert.equal(resolveUserPath("~/demo"), path.join(os.homedir(), "demo"));
  assert.equal(resolveUserPath(""), os.homedir());
  assert.equal(path.isAbsolute(resolveUserPath("relative/dir")), true);
});

test("browseDirectory lists directories and files without contents", async () => {
  const dir = await makeDir();
  try {
    await fs.mkdir(path.join(dir, "alpha"));
    await fs.mkdir(path.join(dir, "beta"));
    await fs.writeFile(path.join(dir, "notes.txt"), "secret", "utf8");

    const listing = await browseDirectory(dir);

    assert.equal(listing.path, dir);
    assert.ok(listing.parent);
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      ["alpha", "beta", "notes.txt"]
    );
    assert.equal(listing.entries[0].isDirectory, true);
    assert.equal(listing.entries[2].isDirectory, false);
    // Listings never carry file contents.
    assert.equal(JSON.stringify(listing).includes("secret"), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("browseDirectory rejects a missing path", async () => {
  await assert.rejects(
    () => browseDirectory(path.join(os.tmpdir(), "atlas-missing-browse-target")),
    /Directory not found/
  );
});

test("inspectScanRootCandidate reports session counts and detected sources", async () => {
  const dir = await makeDir();
  try {
    const projects = path.join(dir, "claude-backup-pc1", "projects");
    await writeClaudeSession(projects, "one.jsonl");
    await writeClaudeSession(projects, "two.jsonl");

    const found = await inspectScanRootCandidate(projects, "claude");
    assert.equal(found.exists, true);
    assert.equal(found.isDirectory, true);
    assert.equal(found.sessionFileCount, 2);
    assert.equal(found.detectedSource, "claude");
    assert.match(found.message, /2 session files/);

    // Pointing at an empty directory is allowed but reported.
    const empty = path.join(dir, "empty");
    await fs.mkdir(empty);
    const emptyResult = await inspectScanRootCandidate(empty, "codex");
    assert.equal(emptyResult.exists, true);
    assert.equal(emptyResult.sessionFileCount, 0);
    assert.match(emptyResult.message, /No session files/);

    // A mismatch between the picked source and the detected one is called out.
    const mismatch = await inspectScanRootCandidate(projects, "codex");
    assert.match(mismatch.message, /looks like a claude history/);

    const missing = await inspectScanRootCandidate(path.join(dir, "nope"), "claude");
    assert.equal(missing.exists, false);
    assert.match(missing.message, /not found/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("inspectScanRootCandidate recognizes an opencode database file", async () => {
  const dir = await makeDir();
  try {
    const dbPath = path.join(dir, "opencode.db");
    await fs.writeFile(dbPath, "", "utf8");

    const result = await inspectScanRootCandidate(dbPath, "opencode");
    assert.equal(result.exists, true);
    assert.equal(result.isDirectory, false);
    assert.equal(result.detectedSource, "opencode");
    assert.match(result.message, /OpenCode database/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("labels prefer the machine folder over a generic container directory", async () => {
  const home = await makeDir();
  try {
    const roots = await resolveEffectiveScanRoots({
      platform: "linux",
      home,
      env: {},
      config: {
        version: 1,
        customRoots: [
          // The leaf directory is the same for every machine, so the label has
          // to come from the parent to stay meaningful.
          { id: "c1", source: "codex", path: "/backup/pc2-codex/sessions", enabled: true },
          { id: "c2", source: "claude", path: "/backup/pc3/projects", enabled: true },
          { id: "c3", source: "copilot", path: "/backup/pc4/session-state", enabled: true },
          { id: "c4", source: "antigravity", path: "/backup/pc5/conversations", enabled: true },
          // A non-generic directory name is used as-is.
          { id: "c5", source: "gemini", path: "/backup/laptop-gemini", enabled: true }
        ],
        disabledDefaults: []
      }
    });

    assert.equal(roots.codexSessions.at(-1)?.label, "pc2-codex");
    assert.equal(roots.claudeProjects.at(-1)?.label, "pc3");
    assert.equal(roots.copilotSessionState.at(-1)?.label, "pc4");
    assert.equal(roots.antigravityRoots.at(-1)?.label, "pc5");
    assert.equal(roots.geminiTmp.at(-1)?.label, "laptop-gemini");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("inspection sniffs content when the directory name gives no hint", async () => {
  const dir = await makeDir();
  try {
    // An archive named after the machine, not the agent: only the file contents
    // reveal which source it belongs to.
    const claudeDir = path.join(dir, "workstation-backup", "projects");
    await writeClaudeSession(claudeDir, "session.jsonl");
    const claudeResult = await inspectScanRootCandidate(claudeDir, "claude");
    assert.equal(claudeResult.detectedSource, "claude");

    const codexDir = path.join(dir, "old-laptop", "sessions");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, "rollout-2026-01-01-abc.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { id: "s1" } })}\n`,
      "utf8"
    );
    const codexResult = await inspectScanRootCandidate(codexDir, "codex");
    assert.equal(codexResult.detectedSource, "codex");

    // Detection still drives the mismatch warning for oddly named archives.
    const mismatch = await inspectScanRootCandidate(codexDir, "claude");
    assert.match(mismatch.message, /looks like a codex history/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
