import { detectSessionSource } from "../parsers/detect.js";
import type { SessionBundle } from "../../shared/types.js";

interface ImportModalOptions {
  onClose: () => void;
  onImport: (bundles: SessionBundle[]) => void;
}

export function createImportModal(options: ImportModalOptions): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Import</p>
      <h2>Load local files</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", options.onClose);
  header.append(closeButton);

  const status = document.createElement("div");
  status.className = "status-inline";
  status.textContent = "Drop JSON / JSONL files or choose files from disk.";

  const dropzone = document.createElement("label");
  dropzone.className = "dropzone";
  dropzone.innerHTML = `
    <input class="dropzone-input" type="file" multiple />
    <strong>Drop files here</strong>
    <span>One file becomes one browser-side session bundle.</span>
  `;

  const input = dropzone.querySelector("input") as HTMLInputElement;
  input.addEventListener("change", async () => {
    if (!input.files?.length) {
      return;
    }
    await handleFiles(input.files);
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragging");
  });

  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    if (!event.dataTransfer?.files?.length) {
      return;
    }
    await handleFiles(event.dataTransfer.files);
  });

  card.append(header, status, dropzone);
  overlay.append(card);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });

  return overlay;

  async function handleFiles(fileList: FileList): Promise<void> {
    status.textContent = "Reading files...";
    const bundles = await Promise.all(
      [...fileList].map(async (file, index) => {
        const content = await file.text();
        const key = `import::${Date.now()}:${index}:${file.name}`;
        const bundle: SessionBundle = {
          key,
          source: "unknown",
          title: file.name,
          primaryPath: file.name,
          relatedPaths: [],
          transport: "browser-file",
          origin: "imported",
          fileCount: 1,
          size: file.size,
          mtimeMs: Date.now(),
          metadata: {},
          files: [
            {
              path: file.webkitRelativePath || file.name,
              content
            }
          ]
        };
        bundle.source = detectSessionSource(bundle);
        return bundle;
      })
    );

    options.onImport(bundles);
    options.onClose();
  }
}
