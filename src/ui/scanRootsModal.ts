import type { SessionSource } from "../../shared/types.js";
import { getSourceLabel } from "../sources/registry.js";
import {
  groupRootsBySource,
  normalizeRootKey,
  ScanRootsClient,
  type ConfigurableSource,
  type CustomScanRoot,
  type DescribedScanRoot,
  type ScanRootsSnapshot
} from "../store/scanRootsClient.js";
import { createDirectoryPicker } from "./directoryPicker.js";
import { escapeHtml, showToast } from "./utils.js";

export interface ScanRootsModalOptions {
  client: ScanRootsClient;
  onClose: () => void;
  /** Called after a successful save so the caller can rescan. */
  onSaved: () => Promise<void> | void;
}

interface DraftState {
  customRoots: CustomScanRoot[];
  disabledDefaults: Set<string>;
}

export function createScanRootsModal(options: ScanRootsModalOptions): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay scan-roots-overlay";

  const card = document.createElement("div");
  card.className = "modal-card modal-wide ui-modal scan-roots-modal";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Scan paths</p>
      <h2>Session directories</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost ui-button ui-button--ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

  const body = document.createElement("div");
  body.className = "modal-body scan-roots-body";

  const status = document.createElement("p");
  status.className = "scan-roots-status ui-status";
  status.textContent = "Loading scan paths...";

  const sourcesContainer = document.createElement("div");
  sourcesContainer.className = "scan-roots-sources";

  const footer = document.createElement("div");
  footer.className = "scan-roots-footer";

  const saveButton = document.createElement("button");
  saveButton.className = "button ui-button ui-button--primary scan-roots-save";
  saveButton.type = "button";
  saveButton.textContent = "Save and rescan";
  saveButton.disabled = true;

  const revertButton = document.createElement("button");
  revertButton.className = "button link ui-button ui-button--ghost scan-roots-revert";
  revertButton.type = "button";
  revertButton.textContent = "Discard changes";
  revertButton.disabled = true;

  footer.append(saveButton, revertButton);
  body.append(status, sourcesContainer, footer);
  card.append(header, body);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  let snapshot: ScanRootsSnapshot | undefined;
  let draft: DraftState = { customRoots: [], disabledDefaults: new Set() };

  function resetDraftFromSnapshot(): void {
    if (!snapshot) {
      return;
    }
    draft = {
      customRoots: snapshot.config.customRoots.map((root) => ({ ...root })),
      disabledDefaults: new Set(snapshot.config.disabledDefaults)
    };
  }

  function isDirty(): boolean {
    if (!snapshot) {
      return false;
    }
    const savedCustom = JSON.stringify(snapshot.config.customRoots);
    const draftCustom = JSON.stringify(draft.customRoots);
    const savedDisabled = [...snapshot.config.disabledDefaults].sort().join("|");
    const draftDisabled = [...draft.disabledDefaults].sort().join("|");
    return savedCustom !== draftCustom || savedDisabled !== draftDisabled;
  }

  function syncFooter(): void {
    const dirty = isDirty();
    saveButton.disabled = !dirty;
    revertButton.disabled = !dirty;
  }

  /**
   * Applies the pending draft on top of the server-described roots so the list
   * reflects unsaved edits without a round trip.
   */
  function effectiveRootsForSource(source: SessionSource): DescribedScanRoot[] {
    if (!snapshot) {
      return [];
    }
    const described = groupRootsBySource(snapshot.roots).get(source) ?? [];
    const builtIn = described
      .filter((root) => root.kind !== "custom")
      .map((root) => ({
        ...root,
        enabled: !draft.disabledDefaults.has(normalizeRootKey(root.path))
      }));

    const custom = draft.customRoots
      .filter((root) => root.source === source)
      .map((root): DescribedScanRoot => {
        const known = described.find((entry) => entry.id === root.id);
        return {
          source,
          path: root.path,
          label: root.label,
          kind: "custom",
          enabled: root.enabled,
          id: root.id,
          // A freshly added root has not been checked by the server yet; the
          // picker only offers paths that exist, so assume it does.
          exists: known?.exists ?? true
        };
      });

    return [...builtIn, ...custom];
  }

  function render(): void {
    if (!snapshot) {
      return;
    }

    sourcesContainer.replaceChildren();
    for (const configurable of snapshot.sources) {
      sourcesContainer.append(renderSourceSection(configurable));
    }
    syncFooter();
  }

  function renderSourceSection(configurable: ConfigurableSource): HTMLElement {
    const section = document.createElement("div");
    section.className = "scan-roots-source ui-panel";
    section.dataset.source = configurable.source;

    const sectionHeader = document.createElement("div");
    sectionHeader.className = "scan-roots-source-header";

    const title = document.createElement("h3");
    title.className = "scan-roots-source-title";
    title.innerHTML = `
      <span class="source-badge ui-badge ${escapeHtml(configurable.source)}">${escapeHtml(configurable.source)}</span>
      <span>${escapeHtml(getSourceLabel(configurable.source))}</span>
    `;

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "button secondary ui-button ui-button--secondary ui-button--compact scan-roots-add";
    addButton.textContent = configurable.kind === "file" ? "Add file" : "Add folder";
    addButton.addEventListener("click", () => {
      openPicker(configurable);
    });

    sectionHeader.append(title, addButton);
    section.append(sectionHeader);

    const hint = document.createElement("p");
    hint.className = "scan-roots-hint";
    hint.textContent = `Point at ${configurable.hint}.`;
    section.append(hint);

    const list = document.createElement("div");
    list.className = "scan-roots-list";

    const roots = effectiveRootsForSource(configurable.source);
    if (roots.length === 0) {
      const empty = document.createElement("p");
      empty.className = "scan-roots-empty";
      empty.textContent = "No paths configured for this source.";
      list.append(empty);
    } else {
      for (const root of roots) {
        list.append(renderRootRow(root));
      }
    }

    section.append(list);
    return section;
  }

  function renderRootRow(root: DescribedScanRoot): HTMLElement {
    const row = document.createElement("div");
    row.className = `scan-root-row${root.enabled ? "" : " disabled"}`;
    row.dataset.path = root.path;

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "scan-root-toggle";
    toggle.checked = root.enabled;
    toggle.title = root.enabled ? "Scanning this path" : "Not scanning this path";
    toggle.addEventListener("change", () => {
      setRootEnabled(root, toggle.checked);
    });

    const info = document.createElement("div");
    info.className = "scan-root-info";

    const pathLine = document.createElement("div");
    pathLine.className = "scan-root-path-line";

    const pathEl = document.createElement("code");
    pathEl.className = "scan-root-path";
    pathEl.textContent = root.path;
    pathLine.append(pathEl);

    const kindBadge = document.createElement("span");
    kindBadge.className = `scan-root-kind ui-badge kind-${root.kind}`;
    kindBadge.textContent =
      root.kind === "default" ? "built-in" : root.kind === "discovered" ? "found" : "custom";
    kindBadge.title =
      root.kind === "default"
        ? "Built-in default path for this source"
        : root.kind === "discovered"
          ? "Archived history found next to your home directory"
          : "Path you added";
    pathLine.append(kindBadge);

    if (root.label) {
      const labelBadge = document.createElement("span");
      labelBadge.className = "archive-badge ui-badge";
      labelBadge.textContent = root.label;
      labelBadge.title = `Sessions from this path are badged "${root.label}"`;
      pathLine.append(labelBadge);
    }

    if (!root.exists) {
      const missing = document.createElement("span");
      missing.className = "scan-root-missing ui-badge";
      missing.textContent = "missing";
      missing.title = "This path does not exist right now; it is skipped when scanning.";
      pathLine.append(missing);
    }

    info.append(pathLine);
    row.append(toggle, info);

    if (root.kind === "custom" && root.id) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "button link ui-button ui-button--ghost ui-button--compact scan-root-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        draft.customRoots = draft.customRoots.filter((entry) => entry.id !== root.id);
        render();
      });
      row.append(removeButton);
    }

    return row;
  }

  function setRootEnabled(root: DescribedScanRoot, enabled: boolean): void {
    if (root.kind === "custom" && root.id) {
      draft.customRoots = draft.customRoots.map((entry) =>
        entry.id === root.id ? { ...entry, enabled } : entry
      );
    } else {
      const key = normalizeRootKey(root.path);
      if (enabled) {
        draft.disabledDefaults.delete(key);
      } else {
        draft.disabledDefaults.add(key);
      }
    }
    render();
  }

  function openPicker(configurable: ConfigurableSource): void {
    const picker = createDirectoryPicker({
      client: options.client,
      source: configurable.source,
      selectFiles: configurable.kind === "file",
      startPath: snapshot?.home ?? "",
      onCancel: () => {
        picker.remove();
      },
      onPick: (pickedPath, label) => {
        picker.remove();
        addCustomRoot(configurable.source, pickedPath, label);
      }
    });
    overlay.append(picker);
  }

  function addCustomRoot(source: SessionSource, rootPath: string, label?: string): void {
    const key = normalizeRootKey(rootPath);
    const duplicate = draft.customRoots.some(
      (entry) => entry.source === source && normalizeRootKey(entry.path) === key
    );
    const builtInDuplicate = (snapshot?.roots ?? []).some(
      (entry) => entry.source === source && normalizeRootKey(entry.path) === key
    );

    if (duplicate || builtInDuplicate) {
      showToast("That path is already configured for this source.", "error");
      return;
    }

    draft.customRoots.push({
      id: `custom-${Date.now()}-${draft.customRoots.length}`,
      source,
      path: rootPath,
      label: label?.trim() || undefined,
      enabled: true
    });
    render();
  }

  saveButton.addEventListener("click", async () => {
    if (!snapshot) {
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
      const saved = await options.client.save({
        customRoots: draft.customRoots,
        disabledDefaults: [...draft.disabledDefaults]
      });
      snapshot = { ...snapshot, config: saved.config, roots: saved.roots };
      resetDraftFromSnapshot();
      render();
      status.textContent = describeSnapshot(snapshot);
      showToast("Scan paths saved. Rescanning...", "success");
      await options.onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save scan paths.", "error");
      syncFooter();
    } finally {
      saveButton.textContent = "Save and rescan";
    }
  });

  revertButton.addEventListener("click", () => {
    resetDraftFromSnapshot();
    render();
  });

  void (async () => {
    try {
      snapshot = await options.client.load();
      resetDraftFromSnapshot();
      status.textContent = describeSnapshot(snapshot);
      render();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Failed to load scan paths.";
      status.classList.add("status-error");
    }
  })();

  return overlay;
}

function describeSnapshot(snapshot: ScanRootsSnapshot): string {
  const active = snapshot.roots.filter((root) => root.enabled && root.exists).length;
  const total = snapshot.roots.length;
  return `${active} of ${total} configured paths are active. Disabled or missing paths are skipped.`;
}
