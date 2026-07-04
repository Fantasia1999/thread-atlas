import { renderMarkdown } from "./markdown.js";
import { renderMermaidDiagrams } from "./mermaidRender.js";
import type { ConnectionManager } from "../store/connection.js";
import { escapeHtml } from "./utils.js";

export interface ParsedFileLink {
  filePath: string;
  lineNumber?: number;
}

export function parseFileLink(href: string): ParsedFileLink {
  let fileUrl = href;
  let lineNumber: number | undefined;

  // Check for hash first, e.g. #L111 or #111
  const hashIdx = fileUrl.indexOf("#");
  if (hashIdx !== -1) {
    const rawPath = fileUrl.slice(0, hashIdx);
    const hashPart = fileUrl.slice(hashIdx + 1);
    const lineMatch = hashPart.match(/^L?(\d+)/i);
    if (lineMatch) {
      lineNumber = parseInt(lineMatch[1], 10);
    }
    return { filePath: rawPath, lineNumber };
  }

  // Check for trailing :line, e.g. :111 or :L111
  // We match from the end to avoid matching drive letters like C:\path
  const trailingLineRegex = /:L?(\d+)$/i;
  const match = fileUrl.match(trailingLineRegex);
  if (match) {
    const rawPath = fileUrl.slice(0, fileUrl.length - match[0].length);
    lineNumber = parseInt(match[1], 10);
    return { filePath: rawPath, lineNumber };
  }

  return { filePath: fileUrl };
}

export function isSupportedPreview(filePath: string, lineNumber?: number): boolean {
  const filename = filePath.split(/[/\\]/).pop() || filePath;
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  // 1. Check if it's .md or .markdown
  if (extension === "md" || extension === "markdown") {
    return true;
  }

  // 2. Check if it's an image
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension);
  if (isImage) {
    return true;
  }

  // 3. If it has a line number, it is supported
  if (typeof lineNumber === "number" && !isNaN(lineNumber)) {
    return true;
  }

  return false;
}

interface FilePreviewModalOptions {
  filePath: string;
  lineNumber?: number;
  connection: ConnectionManager;
  apiBase?: string;
  sessionKey?: string;
  onClose: () => void;
}

export function createFilePreviewModal(options: FilePreviewModalOptions): HTMLElement {
  const { filePath, lineNumber, connection, apiBase, sessionKey } = options;

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

  // Resolve full decoded path for display
  let displayPath = filePath;
  if (displayPath.startsWith("file:///")) {
    try {
      const url = new URL(displayPath);
      displayPath = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:[/\\]/.test(displayPath)) {
        displayPath = displayPath.slice(1);
      }
    } catch {
      displayPath = decodeURIComponent(displayPath.slice(8));
    }
  } else if (displayPath.startsWith("file://")) {
    displayPath = decodeURIComponent(displayPath.slice(7));
  } else {
    displayPath = decodeURIComponent(displayPath);
  }

  const displayTitle = lineNumber !== undefined ? `${displayPath}:${lineNumber}` : displayPath;

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Local File Preview</p>
      <h2 class="preview-title" title="${escapeHtml(filePath)}">${escapeHtml(displayTitle)}</h2>
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
  } else if (cleanPath.startsWith("file://")) {
    cleanPath = decodeURIComponent(cleanPath.slice(7));
  } else {
    cleanPath = decodeURIComponent(cleanPath);
  }

  // Fetch file from backend (supports both local and remote active connections)
  const resolvedApiBase = apiBase || connection.sessionApiBase();
  let fileApiUrl = `${resolvedApiBase}/file?path=${encodeURIComponent(cleanPath)}`;
  if (sessionKey) {
    fileApiUrl += `&sessionKey=${encodeURIComponent(sessionKey)}`;
  }

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
      } else if ((extension === "md" || extension === "markdown") && lineNumber === undefined) {
        const text = await response.text();
        if (isClosed) return;
        const contentContainer = document.createElement("div");
        contentContainer.className = "preview-markdown-content markdown-body";
        contentContainer.append(renderMarkdown(text));
        body.append(contentContainer);

        // Render any Mermaid diagrams inside the markdown preview container
        void renderMermaidDiagrams(contentContainer);
      } else {
        // Fallback to text preview (possibly sliced by line numbers)
        const text = await response.text();
        if (isClosed) return;

        let displayText = text;
        if (typeof lineNumber === "number" && !isNaN(lineNumber)) {
          const lines = text.split(/\r?\n/);
          const target = lineNumber;
          let startLine = Math.max(0, target - 1 - 15);
          let endLine = Math.min(lines.length - 1, target - 1 + 15);
          if (startLine > endLine) {
            startLine = 0;
            endLine = lines.length - 1;
          }
          const slicedLines = lines.slice(startLine, endLine + 1);

          const padLength = String(endLine + 1).length;
          displayText = slicedLines.map((line, idx) => {
            const lineNum = startLine + idx + 1;
            const paddedLineNum = String(lineNum).padStart(padLength, " ");
            return `${paddedLineNum} | ${line}`;
          }).join("\n");
        }

        const pre = document.createElement("pre");
        pre.className = "preview-text-block code-block";
        const code = document.createElement("code");
        code.className = "md-code hljs";
        code.textContent = displayText;
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

