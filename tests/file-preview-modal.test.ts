import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";

// Setup localStorage mock to keep ConnectionManager happy
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = String(value);
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  key: () => null,
  length: 0
};

// Mock URL.createObjectURL and URL.revokeObjectURL for Node environment
let revokedUrl: string | null = null;
globalThis.URL.createObjectURL = () => "blob:http://localhost/mock-object-url";
globalThis.URL.revokeObjectURL = (url: string) => {
  revokedUrl = url;
};

const { ConnectionManager } = await import("../src/store/connection.ts");
const { createFilePreviewModal, parseFileLink, isSupportedPreview } = await import("../src/ui/filePreviewModal.ts");

function freshManager() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  return new ConnectionManager();
}

test("file preview modal renders loading state initially", () => {
  const manager = freshManager();
  // Mock fetch to return a delayed response
  (manager as unknown as { fetch: unknown }).fetch = async () => {
    return new Promise(() => {}); // never resolves to keep it in loading state
  };

  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/.gemini/antigravity-cli/brain/session/report.md",
    connection: manager,
    onClose: () => {}
  });

  const loadingStatus = overlay.querySelector(".loading-status");
  assert.ok(loadingStatus);
  assert.equal(loadingStatus.textContent, "Loading file content...");
});

test("file preview modal renders markdown content correctly upon successful fetch", async () => {
  const manager = freshManager();
  const mockMarkdown = "# Hello World\nThis is a test of the artifact preview.";
  
  (manager as unknown as { fetch: unknown }).fetch = async (url: string) => {
    return {
      ok: true,
      text: async () => mockMarkdown
    } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/.gemini/antigravity-cli/brain/session/report.md",
    connection: manager,
    onClose: () => {}
  });

  // Wait for promise resolution ticks
  await new Promise((resolve) => setTimeout(resolve, 50));

  const mdContent = overlay.querySelector(".preview-markdown-content");
  assert.ok(mdContent);
  assert.ok(mdContent.textContent.includes("Hello World"));
  assert.ok(mdContent.textContent.includes("This is a test"));
});

test("file preview modal renders images correctly as image elements", async () => {
  const manager = freshManager();
  
  (manager as unknown as { fetch: unknown }).fetch = async (url: string) => {
    return {
      ok: true,
      blob: async () => ({ size: 100, type: "image/png" })
    } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/.gemini/antigravity-cli/brain/session/diagram.png",
    connection: manager,
    onClose: () => {}
  });

  // Wait for promise resolution ticks
  await new Promise((resolve) => setTimeout(resolve, 50));

  const img = overlay.querySelector(".preview-image") as any;
  assert.ok(img);
  assert.equal(img.tagName.toUpperCase(), "IMG");
  assert.equal(img.src, "blob:http://localhost/mock-object-url");
  assert.equal(img.alt, "diagram.png");
});

test("file preview modal falls back to text preview for other file extensions", async () => {
  const manager = freshManager();
  const mockText = '{"status": "ok", "count": 10}';
  
  (manager as unknown as { fetch: unknown }).fetch = async (url: string) => {
    return {
      ok: true,
      text: async () => mockText
    } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/.gemini/antigravity-cli/brain/session/data.json",
    connection: manager,
    onClose: () => {}
  });

  // Wait for promise resolution ticks
  await new Promise((resolve) => setTimeout(resolve, 50));

  const codeNode = overlay.querySelector("code");
  assert.ok(codeNode);
  assert.equal(codeNode.textContent, mockText);
});

test("file preview modal renders error message on fetch failure", async () => {
  const manager = freshManager();
  
  (manager as unknown as { fetch: unknown }).fetch = async (url: string) => {
    return {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "Access denied. Path is not inside allowed session roots." })
    } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "/etc/passwd",
    connection: manager,
    onClose: () => {}
  });

  // Wait for promise resolution ticks
  await new Promise((resolve) => setTimeout(resolve, 50));

  const errorStatus = overlay.querySelector(".error-status");
  assert.ok(errorStatus);
  assert.ok(errorStatus.innerHTML.includes("Access denied. Path is not inside allowed"));
});

test("closing the modal triggers onClose callback and revokes object URL", async () => {
  let closed = false;
  revokedUrl = null;

  const manager = freshManager();
  (manager as unknown as { fetch: unknown }).fetch = async () => {
    return {
      ok: true,
      blob: async () => ({ size: 100, type: "image/png" })
    } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/.gemini/antigravity-cli/brain/session/diagram.png",
    connection: manager,
    onClose: () => {
      closed = true;
    }
  });

  // Wait for promise resolution tick to load image and create object URL
  await new Promise((resolve) => setTimeout(resolve, 50));

  const closeButton = overlay.querySelector(".ghost");
  assert.ok(closeButton);
  closeButton.dispatchEvent("click");

  assert.equal(closed, true);
  assert.equal(revokedUrl, "blob:http://localhost/mock-object-url");
});

test("pressing Escape key closes the modal", async () => {
  let closed = false;
  const manager = freshManager();
  (manager as unknown as { fetch: unknown }).fetch = async () => {
    return { ok: true, text: async () => "content" } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "file.txt",
    connection: manager,
    onClose: () => {
      closed = true;
    }
  });

  const escHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      const closeBtn = overlay.querySelector(".ghost") as HTMLButtonElement | null;
      if (closeBtn) {
        closeBtn.click();
      }
    }
  };
  document.addEventListener("keydown", escHandler);

  // Dispatch keydown Escape on document
  document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: () => {} } as any);
  assert.equal(closed, true);

  document.removeEventListener("keydown", escHandler);
});



test("clicking on the backdrop overlay closes the modal", () => {
  let closed = false;
  const manager = freshManager();
  (manager as unknown as { fetch: unknown }).fetch = async () => {
    return { ok: true, text: async () => "content" } as unknown as Response;
  };

  const overlay = createFilePreviewModal({
    filePath: "file.txt",
    connection: manager,
    onClose: () => {
      closed = true;
    }
  });

  // Click on backdrop (overlay itself)
  overlay.dispatchEvent("click", { target: overlay });
  assert.equal(closed, true);
});

test("parseFileLink extracts clean path and line number correctly", () => {
  const result1 = parseFileLink("file:///home/user/main.cpp:111");
  assert.equal(result1.filePath, "file:///home/user/main.cpp");
  assert.equal(result1.lineNumber, 111);

  const result2 = parseFileLink("file:///C:/project/index.ts#L42");
  assert.equal(result2.filePath, "file:///C:/project/index.ts");
  assert.equal(result2.lineNumber, 42);

  const result3 = parseFileLink("file:///home/user/report.md");
  assert.equal(result3.filePath, "file:///home/user/report.md");
  assert.equal(result3.lineNumber, undefined);
});

test("isSupportedPreview correctly identifies previewable files", () => {
  // markdown files are always previewable
  assert.ok(isSupportedPreview("/path/to/readme.md"));
  assert.ok(isSupportedPreview("/path/to/doc.markdown"));

  // images are always previewable
  assert.ok(isSupportedPreview("/path/to/logo.png"));
  assert.ok(isSupportedPreview("/path/to/diagram.svg"));

  // other code files are NOT previewable normally
  assert.ok(!isSupportedPreview("/path/to/main.cpp"));
  assert.ok(!isSupportedPreview("/path/to/script.js"));

  // other code files are previewable IF a line number is specified
  assert.ok(isSupportedPreview("/path/to/main.cpp", 111));
  assert.ok(isSupportedPreview("/path/to/script.js", 42));
});

test("file preview modal slices content when lineNumber is provided", async () => {
  const manager = freshManager();
  
  // Construct a file content with 50 lines
  const linesContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");

  (manager as unknown as { fetch: unknown }).fetch = async (url: string) => {
    return {
      ok: true,
      text: async () => linesContent
    } as unknown as Response;
  };

  // We request line 30, which should slice from line 15 to 45 (0-indexed 14 to 44, 1-indexed)
  const overlay = createFilePreviewModal({
    filePath: "/home/example-user/project/main.cpp",
    lineNumber: 30,
    connection: manager,
    onClose: () => {}
  });

  // Wait for promise resolution ticks
  await new Promise((resolve) => setTimeout(resolve, 50));

  const codeNode = overlay.querySelector("code");
  assert.ok(codeNode);
  
  const content = codeNode.textContent;
  // Should start with line 15 prefixed with '15 | line 15'
  assert.ok(content.includes("15 | line 15"));
  // Should end with line 45 prefixed with '45 | line 45'
  assert.ok(content.includes("45 | line 45"));
  // Should NOT contain line 14
  assert.ok(!content.includes("line 14"));
  // Should NOT contain line 46
  assert.ok(!content.includes("line 46"));

  // Header title should include line number
  const headerNode = overlay.querySelector(".modal-header");
  assert.ok(headerNode);
  assert.ok(headerNode.innerHTML.includes("main.cpp:30"));
});

test("ThreadAtlasApp link click and dblclick triggers copy on unsupported links", async () => {
  globalThis.matchMedia = globalThis.matchMedia || (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  } as any));

  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

  (globalThis.document as any).documentElement = {
    dataset: {}
  };

  let copiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copiedText = text;
        }
      }
    },
    configurable: true,
    writable: true
  });

  const root = document.createElement("div");

  const { SessionStore } = await import("../src/store/sessionStore.ts");
  const store = new SessionStore();

  const { ThreadAtlasApp } = await import("../src/ui/app.ts");
  const app = new ThreadAtlasApp(root, store);

  // Add an unsupported file link inside root
  const link = document.createElement("a");
  link.className = "md-link";
  link.setAttribute("href", "file:///home/user/project/button.tsx");
  link.textContent = "my-button";
  root.append(link);

  // Dispatch mouseover to verify hover tooltip
  root.dispatchEvent("mouseover", { target: link });
  assert.equal(link.getAttribute("title"), "Click to copy text, double-click to copy path");

  // Dispatch click
  root.dispatchEvent("click", { target: link });

  // Wait 300ms for click timer
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(copiedText, "my-button");

  // Reset
  copiedText = "";

  // Dispatch double click
  root.dispatchEvent("click", { target: link });
  root.dispatchEvent("click", { target: link });
  root.dispatchEvent("dblclick", { target: link });

  // Wait 300ms
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(copiedText, "/home/user/project/button.tsx");
});

test("ThreadAtlasApp link click handles absolute path links without file:/// protocol", async () => {
  let copiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copiedText = text;
        }
      }
    },
    configurable: true,
    writable: true
  });

  const root = document.createElement("div");

  const { SessionStore } = await import("../src/store/sessionStore.ts");
  const store = new SessionStore();

  // Mock connection fetch to return a resolved response
  (store.getConnection() as any).fetch = async () => {
    return {
      ok: true,
      text: async () => "some content line 846\n"
    } as any;
  };

  const { ThreadAtlasApp } = await import("../src/ui/app.ts");
  const app = new ThreadAtlasApp(root, store);

  // 1. Test supported absolute path with line number (index.rs:846)
  const linkSupported = document.createElement("a");
  linkSupported.className = "md-link";
  linkSupported.setAttribute("href", "/home/wcl/workspace/sourceCode/lance/rust/lance/src/index.rs:846");
  linkSupported.textContent = "rust/lance/src/index.rs";
  root.append(linkSupported);

  root.dispatchEvent("click", { target: linkSupported });

  // Pushed modal should be created
  const overlay = root.querySelector(".modal-overlay");
  assert.ok(overlay);
  
  // Clean up modal
  overlay.remove();

  // 2. Test unsupported absolute path without line number (index.rs)
  const linkUnsupported = document.createElement("a");
  linkUnsupported.className = "md-link";
  linkUnsupported.setAttribute("href", "/home/wcl/workspace/sourceCode/lance/rust/lance/src/index.rs");
  linkUnsupported.textContent = "rust/lance/src/index.rs";
  root.append(linkUnsupported);

  // Single click
  root.dispatchEvent("click", { target: linkUnsupported });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(copiedText, "rust/lance/src/index.rs");

  // Reset
  copiedText = "";

  // Double click
  root.dispatchEvent("click", { target: linkUnsupported });
  root.dispatchEvent("click", { target: linkUnsupported });
  root.dispatchEvent("dblclick", { target: linkUnsupported });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(copiedText, "/home/wcl/workspace/sourceCode/lance/rust/lance/src/index.rs");
});

