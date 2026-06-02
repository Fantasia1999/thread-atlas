import { renderMarkdown } from "./markdown.js";
import { renderMermaidDiagrams } from "./mermaidRender.js";
import type { ConnectionManager } from "../store/connection.js";
import { escapeHtml } from "./utils.js";

interface FilePreviewModalOptions {
  filePath: string;
  connection: ConnectionManager;
  apiBase?: string;
  onClose: () => void;
}

export function createFilePreviewModal(options: FilePreviewModalOptions): HTMLElement {
  const { filePath, connection, apiBase } = options;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  if (apiBase) {
    overlay.setAttribute("data-api-base", apiBase);
  }

  const card = document.createElement("div");
  card.className = "modal-card modal-preview-card";

  // Parse filename from path
  const filename = filePath.split(/[/\\]/).pop() || filePath;
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Local File Preview</p>
      <h2 class="preview-title" title="${escapeHtml(filePath)}">${escapeHtml(filename)}</h2>
    </div>
  `;

  const closeButton = document.createElement("button");
  closeButton.className = "button ghost";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  header.append(closeButton);

  const body = document.createElement("div");
  body.className = "modal-body modal-preview-body";

  const status = document.createElement("div");
  status.className = "status-inline loading-status";
  status.textContent = "Loading file content...";
  body.append(status);

  card.append(header, body);
  overlay.append(card);

  let objectUrl: string | null = null;
  let isClosed = false;
  const controller = new AbortController();

  const cleanupAndClose = () => {
    isClosed = true;
    controller.abort();

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    // Clean up mermaid enhancements to free memory and event listeners
    try {
      import("./mermaidRender.js").then((m) => {
        void m.cleanupMermaid();
      });
    } catch {
      // ignore
    }

    options.onClose();
  };

  closeButton.addEventListener("click", cleanupAndClose);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      cleanupAndClose();
    }
  });

  // Determine file fetching strategy
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension);

  // Resolve file URL path
  let cleanPath = filePath;
  if (cleanPath.startsWith("file:///")) {
    try {
      const url = new URL(filePath);
      const decodedPath = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:[/\\]/.test(decodedPath)) {
        cleanPath = decodedPath.slice(1); // Windows drive path
      } else {
        cleanPath = decodedPath; // Unix path /home/example-user/...
      }
    } catch {
      const afterProtocol = filePath.slice(8);
      if (/^[a-zA-Z]:[/\\]/.test(afterProtocol)) {
        cleanPath = decodeURIComponent(afterProtocol);
      } else {
        cleanPath = decodeURIComponent(filePath.slice(7));
      }
    }
  } else {
    cleanPath = decodeURIComponent(cleanPath);
  }

  // Fetch file from backend (supports both local and remote active connections)
  const resolvedApiBase = apiBase || connection.sessionApiBase();
  const fileApiUrl = `${resolvedApiBase}/file?path=${encodeURIComponent(cleanPath)}`;

  connection
    .fetch(fileApiUrl, { signal: controller.signal })
    .then(async (response) => {
      if (isClosed) return;
      if (!response.ok) {
        let errMsg = `Failed to load file (${response.status} ${response.statusText})`;
        try {
          const errPayload = await response.json() as { error?: string };
          if (errPayload && errPayload.error) {
            errMsg = errPayload.error;
          }
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      body.replaceChildren();

      if (isImage) {
        const blob = await response.blob();
        if (isClosed) return;
        objectUrl = URL.createObjectURL(blob);

        const imgContainer = document.createElement("div");
        imgContainer.className = "preview-image-container";

        const img = document.createElement("img");
        img.className = "preview-image";
        img.src = objectUrl;
        img.alt = filename;

        imgContainer.append(img);
        body.append(imgContainer);
      } else if (extension === "md" || extension === "markdown") {
        const text = await response.text();
        if (isClosed) return;
        const contentContainer = document.createElement("div");
        contentContainer.className = "preview-markdown-content markdown-body";
        contentContainer.append(renderMarkdown(text));
        body.append(contentContainer);

        // Render any Mermaid diagrams inside the markdown preview container
        void renderMermaidDiagrams(contentContainer);
      } else {
        // Fallback to text preview
        const text = await response.text();
        if (isClosed) return;
        const pre = document.createElement("pre");
        pre.className = "preview-text-block code-block";
        const code = document.createElement("code");
        code.className = "md-code hljs";
        code.textContent = text;
        pre.append(code);
        body.append(pre);
      }
    })
    .catch((error: Error) => {
      if (isClosed || error.name === "AbortError" || (error.name === "DOMException" && error.message.includes("abort"))) {
        return;
      }
      body.replaceChildren();
      const errEl = document.createElement("div");
      errEl.className = "status-inline error-status";
      errEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>Error: ${escapeHtml(error.message)}</span>
      `;
      body.append(errEl);
    });

  return overlay;
}
