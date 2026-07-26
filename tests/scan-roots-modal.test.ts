import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";
import { createScanRootsModal } from "../src/ui/scanRootsModal.ts";
import { createDirectoryPicker } from "../src/ui/directoryPicker.ts";
import type {
  DescribedScanRoot,
  DirectoryListing,
  ScanRootInspection,
  ScanRootsSnapshot
} from "../src/store/scanRootsClient.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSnapshot(overrides: Partial<ScanRootsSnapshot> = {}): ScanRootsSnapshot {
  const roots: DescribedScanRoot[] = [
    {
      source: "codex",
      path: "/home/u/.codex/sessions",
      kind: "default",
      enabled: true,
      exists: true
    },
    {
      source: "claude",
      path: "/home/u/.claude/projects",
      kind: "default",
      enabled: true,
      exists: true
    },
    {
      source: "claude",
      path: "/home/u/claude-backup-pc1/projects",
      label: "claude-backup-pc1",
      kind: "discovered",
      enabled: true,
      exists: true
    },
    {
      source: "antigravity",
      path: "/mnt/ag",
      label: "ag",
      kind: "custom",
      enabled: true,
      exists: false,
      id: "custom-ag"
    }
  ];

  return {
    roots,
    config: {
      version: 1,
      customRoots: [
        { id: "custom-ag", source: "antigravity", path: "/mnt/ag", label: "ag", enabled: true }
      ],
      disabledDefaults: []
    },
    sources: [
      { source: "codex", hint: "a Codex `sessions` directory", kind: "directory" },
      { source: "claude", hint: "a Claude `projects` directory", kind: "directory" },
      { source: "antigravity", hint: "an Antigravity root", kind: "directory" },
      { source: "opencode", hint: "an `opencode.db` file", kind: "file" }
    ],
    home: "/home/u",
    separator: "/",
    ...overrides
  };
}

function makeClient(snapshot: ScanRootsSnapshot, calls: any[] = []) {
  return {
    calls,
    load: async () => snapshot,
    save: async (config: any) => {
      calls.push(["save", config]);
      return { config: { version: 1, ...config }, roots: snapshot.roots };
    },
    browse: async (path: string): Promise<DirectoryListing> => {
      calls.push(["browse", path]);
      return {
        path: path || "/home/u",
        parent: "/home",
        entries: [
          { name: "archive-a", path: "/home/u/archive-a", isDirectory: true },
          { name: "notes.txt", path: "/home/u/notes.txt", isDirectory: false }
        ],
        truncated: false
      };
    },
    inspect: async (path: string): Promise<ScanRootInspection> => {
      calls.push(["inspect", path]);
      return {
        path,
        exists: true,
        isDirectory: true,
        detectedSource: "claude",
        sessionFileCount: 4,
        countCapped: false,
        message: "Found 4 session files (looks like claude)."
      };
    }
  } as any;
}

test("scan roots modal lists every configurable source with its roots", async () => {
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot()),
    onClose: () => {},
    onSaved: () => {}
  });
  await flush();

  const sections = modal.querySelectorAll(".scan-roots-source");
  assert.equal(sections.length, 4);
  assert.deepEqual(
    sections.map((section: any) => section.dataset.source),
    ["codex", "claude", "antigravity", "opencode"]
  );

  // Claude shows both its built-in root and the discovered archive.
  const claudeSection = sections.find((s: any) => s.dataset.source === "claude");
  const claudeRows = claudeSection.querySelectorAll(".scan-root-row");
  assert.equal(claudeRows.length, 2);
  assert.equal(
    claudeSection.querySelectorAll(".archive-badge")[0].textContent,
    "claude-backup-pc1"
  );

  // A source with no roots renders an empty state rather than nothing.
  const opencodeSection = sections.find((s: any) => s.dataset.source === "opencode");
  assert.ok(opencodeSection.querySelector(".scan-roots-empty"));

  // A configured-but-absent path is flagged.
  const agSection = sections.find((s: any) => s.dataset.source === "antigravity");
  assert.ok(agSection.querySelector(".scan-root-missing"));
});

test("toggling a built-in root marks it disabled and enables saving", async () => {
  const calls: any[] = [];
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot(), calls),
    onClose: () => {},
    onSaved: () => {}
  });
  await flush();

  const saveButton = modal.querySelector(".scan-roots-save");
  assert.equal(saveButton.disabled, true);

  const codexSection = modal
    .querySelectorAll(".scan-roots-source")
    .find((s: any) => s.dataset.source === "codex");
  const toggle = codexSection.querySelector(".scan-root-toggle");
  toggle.checked = false;
  toggle.dispatchEvent("change");
  await flush();

  assert.equal(modal.querySelector(".scan-roots-save").disabled, false);

  modal.querySelector(".scan-roots-save").dispatchEvent("click");
  await flush();

  const saveCall = calls.find((call) => call[0] === "save");
  assert.ok(saveCall);
  assert.deepEqual(saveCall[1].disabledDefaults, ["/home/u/.codex/sessions"]);
});

test("removing a custom root drops it from the saved payload", async () => {
  const calls: any[] = [];
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot(), calls),
    onClose: () => {},
    onSaved: () => {}
  });
  await flush();

  const agSection = modal
    .querySelectorAll(".scan-roots-source")
    .find((s: any) => s.dataset.source === "antigravity");
  agSection.querySelector(".scan-root-remove").dispatchEvent("click");
  await flush();

  modal.querySelector(".scan-roots-save").dispatchEvent("click");
  await flush();

  const saveCall = calls.find((call) => call[0] === "save");
  assert.deepEqual(saveCall[1].customRoots, []);
});

test("discarding changes restores the saved configuration", async () => {
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot()),
    onClose: () => {},
    onSaved: () => {}
  });
  await flush();

  const agSection = () =>
    modal.querySelectorAll(".scan-roots-source").find((s: any) => s.dataset.source === "antigravity");
  agSection().querySelector(".scan-root-remove").dispatchEvent("click");
  await flush();
  assert.equal(agSection().querySelectorAll(".scan-root-row").length, 0);

  modal.querySelector(".scan-roots-revert").dispatchEvent("click");
  await flush();

  assert.equal(agSection().querySelectorAll(".scan-root-row").length, 1);
  assert.equal(modal.querySelector(".scan-roots-save").disabled, true);
});

test("adding a folder opens the picker and appends the picked root", async () => {
  const calls: any[] = [];
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot(), calls),
    onClose: () => {},
    onSaved: () => {}
  });
  await flush();

  const claudeSection = () =>
    modal.querySelectorAll(".scan-roots-source").find((s: any) => s.dataset.source === "claude");
  claudeSection().querySelector(".scan-roots-add").dispatchEvent("click");
  await flush();

  const picker = modal.querySelector(".picker-layer");
  assert.ok(picker);
  assert.ok(calls.some((call) => call[0] === "browse"));

  // Navigating into a directory selects it, then "Use this path" adds it.
  picker.querySelectorAll(".picker-entry")[0].dispatchEvent("click");
  await flush();
  picker.querySelector(".picker-use").dispatchEvent("click");
  await flush();

  assert.equal(modal.querySelector(".picker-layer"), null);
  const rows = claudeSection().querySelectorAll(".scan-root-row");
  assert.equal(rows.length, 3);

  modal.querySelector(".scan-roots-save").dispatchEvent("click");
  await flush();

  const saveCall = calls.find((call) => call[0] === "save");
  assert.equal(saveCall[1].customRoots.length, 2);
  assert.equal(saveCall[1].customRoots[1].source, "claude");
  assert.equal(saveCall[1].customRoots[1].path, "/home/u/archive-a");
});

test("saving triggers a rescan through onSaved", async () => {
  let rescans = 0;
  const modal = createScanRootsModal({
    client: makeClient(makeSnapshot()),
    onClose: () => {},
    onSaved: () => {
      rescans += 1;
    }
  });
  await flush();

  const toggle = modal.querySelector(".scan-root-toggle");
  toggle.checked = false;
  toggle.dispatchEvent("change");
  await flush();
  modal.querySelector(".scan-roots-save").dispatchEvent("click");
  await flush();

  assert.equal(rescans, 1);
});

test("directory picker lists folders, hides files for folder mode, and validates", async () => {
  const calls: any[] = [];
  let picked: [string, string | undefined] | undefined;
  const picker = createDirectoryPicker({
    client: makeClient(makeSnapshot(), calls),
    source: "claude",
    selectFiles: false,
    startPath: "/home/u",
    onPick: (path, label) => {
      picked = [path, label];
    },
    onCancel: () => {}
  });
  await flush();

  // Folder mode filters out plain files.
  const entries = picker.querySelectorAll(".picker-entry");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].querySelector(".picker-entry-name").textContent, "archive-a");

  // Browsing a folder validates it and reports the session count.
  assert.match(picker.querySelector(".picker-inspection").textContent, /Found 4 session files/);
  assert.equal(picker.querySelector(".picker-use").disabled, false);

  const labelInput = picker.querySelector(".picker-label-input");
  labelInput.value = "PC1";
  picker.querySelector(".picker-use").dispatchEvent("click");
  await flush();

  assert.deepEqual(picked, ["/home/u", "PC1"]);
});

test("directory picker shows files when the source stores one database file", async () => {
  const picker = createDirectoryPicker({
    client: makeClient(makeSnapshot()),
    source: "opencode",
    selectFiles: true,
    startPath: "/home/u",
    onPick: () => {},
    onCancel: () => {}
  });
  await flush();

  const entries = picker.querySelectorAll(".picker-entry");
  assert.equal(entries.length, 2);
  // Nothing is selected until the user picks a file.
  assert.equal(picker.querySelector(".picker-use").disabled, true);
});
