import type { SessionSource } from "../../shared/types.js";
import type { ScanRootsClient, ScanRootInspection } from "../store/scanRootsClient.js";
import { escapeHtml } from "./utils.js";

export interface DirectoryPickerOptions {
  client: ScanRootsClient;
  source: SessionSource;
  /** OpenCode stores sessions in a single file, everything else in a folder. */
  selectFiles: boolean;
  startPath: string;
  onPick: (path: string, label?: string) => void;
  onCancel: () => void;
}

/**
 * A browse-and-pick dialog for choosing a scan root. Directories are listed by
 * the agent (names and types only, never contents), and the current selection is
 * checked before it can be added so users get told up front when a path holds no
 * sessions or looks like a different agent's history.
 */
export function createDirectoryPicker(options: DirectoryPickerOptions): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "picker-layer";

  const panel = document.createElement("div");
  panel.className = "picker-panel ui-modal";

  const header = document.createElement("div");
  header.className = "picker-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Choose path</p>
      <h3>${escapeHtml(options.selectFiles ? "Select a file" : "Select a folder")}</h3>
    </div>
  `;

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button ghost ui-button ui-button--ghost picker-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", options.onCancel);
  header.append(cancelButton);

  const pathRow = document.createElement("div");
  pathRow.className = "picker-path-row";

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "button secondary ui-button ui-button--secondary ui-button--compact picker-up";
  upButton.textContent = "↑ Up";

  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "text-input ui-input picker-path-input";
  pathInput.placeholder = "Type or paste an absolute path";
  pathInput.spellcheck = false;

  const goButton = document.createElement("button");
  goButton.type = "button";
  goButton.className = "button secondary ui-button ui-button--secondary ui-button--compact picker-go";
  goButton.textContent = "Go";

  pathRow.append(upButton, pathInput, goButton);

  const listing = document.createElement("div");
  listing.className = "picker-listing";

  const inspection = document.createElement("p");
  inspection.className = "picker-inspection ui-status";

  const labelRow = document.createElement("div");
  labelRow.className = "picker-label-row";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "text-input ui-input picker-label-input";
  labelInput.placeholder = "Badge label (optional, defaults to the folder name)";

  labelRow.append(labelInput);

  const footer = document.createElement("div");
  footer.className = "picker-footer";

  const useButton = document.createElement("button");
  useButton.type = "button";
  useButton.className = "button ui-button ui-button--primary picker-use";
  useButton.textContent = "Use this path";
  useButton.disabled = true;

  footer.append(useButton);

  panel.append(header, pathRow, listing, inspection, labelRow, footer);
  layer.append(panel);

  layer.addEventListener("click", (event) => {
    if (event.target === layer) {
      options.onCancel();
    }
  });

  let currentPath = options.startPath;
  let currentParent: string | undefined;
  let selectedPath = "";
  let inspectToken = 0;

  function setInspectionState(text: string, kind: "info" | "success" | "error"): void {
    inspection.textContent = text;
    inspection.classList.remove("status-success", "status-error", "status-info");
    inspection.classList.add(`status-${kind}`);
  }

  async function inspectSelection(target: string): Promise<void> {
    const token = ++inspectToken;
    setInspectionState("Checking path...", "info");
    useButton.disabled = true;

    let result: ScanRootInspection;
    try {
      result = await options.client.inspect(target, options.source);
    } catch (error) {
      if (token !== inspectToken) {
        return;
      }
      setInspectionState(
        error instanceof Error ? error.message : "Failed to check path.",
        "error"
      );
      return;
    }

    if (token !== inspectToken) {
      return;
    }

    if (!result.exists) {
      setInspectionState(result.message, "error");
      return;
    }

    const wantsFile = options.selectFiles;
    if (wantsFile && result.isDirectory) {
      setInspectionState("Select a file for this source, not a folder.", "error");
      return;
    }
    if (!wantsFile && !result.isDirectory) {
      setInspectionState("Select a folder for this source, not a file.", "error");
      return;
    }

    // A path with no sessions is allowed — it may fill up later — but say so.
    setInspectionState(result.message, result.sessionFileCount > 0 ? "success" : "info");
    useButton.disabled = false;
  }

  function selectPath(target: string): void {
    selectedPath = target;
    pathInput.value = target;
    void inspectSelection(target);
  }

  async function navigate(target: string): Promise<void> {
    listing.replaceChildren(buildMessage("Loading..."));
    try {
      const result = await options.client.browse(target);
      currentPath = result.path;
      currentParent = result.parent;
      pathInput.value = result.path;
      upButton.disabled = !result.parent;
      renderEntries(result.entries, result.truncated);

      // Browsing into a folder makes it the candidate selection.
      if (!options.selectFiles) {
        selectPath(result.path);
      } else {
        selectedPath = "";
        useButton.disabled = true;
        setInspectionState("Pick a file from the list.", "info");
      }
    } catch (error) {
      listing.replaceChildren(
        buildMessage(error instanceof Error ? error.message : "Failed to list directory.")
      );
    }
  }

  function renderEntries(
    entries: ReadonlyArray<{ name: string; path: string; isDirectory: boolean }>,
    truncated: boolean
  ): void {
    listing.replaceChildren();

    const usable = options.selectFiles
      ? entries
      : entries.filter((entry) => entry.isDirectory);

    if (usable.length === 0) {
      listing.append(buildMessage("Nothing to show in this folder."));
      return;
    }

    for (const entry of usable) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `picker-entry${entry.isDirectory ? " is-directory" : " is-file"}`;
      row.dataset.path = entry.path;

      const icon = document.createElement("span");
      icon.className = "picker-entry-icon";
      icon.textContent = entry.isDirectory ? "📁" : "📄";

      const name = document.createElement("span");
      name.className = "picker-entry-name";
      name.textContent = entry.name;

      row.append(icon, name);
      row.addEventListener("click", () => {
        if (entry.isDirectory) {
          void navigate(entry.path);
        } else {
          selectPath(entry.path);
          for (const other of listing.querySelectorAll(".picker-entry")) {
            other.classList.remove("selected");
          }
          row.classList.add("selected");
        }
      });

      listing.append(row);
    }

    if (truncated) {
      listing.append(buildMessage("Showing the first 400 entries."));
    }
  }

  upButton.addEventListener("click", () => {
    if (currentParent) {
      void navigate(currentParent);
    }
  });

  goButton.addEventListener("click", () => {
    void navigate(pathInput.value);
  });

  pathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void navigate(pathInput.value);
    }
  });

  useButton.addEventListener("click", () => {
    const target = selectedPath || pathInput.value.trim();
    if (target) {
      options.onPick(target, labelInput.value);
    }
  });

  void navigate(currentPath);

  return layer;
}

function buildMessage(text: string): HTMLElement {
  const message = document.createElement("p");
  message.className = "picker-message";
  message.textContent = text;
  return message;
}
