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
const { createFilePreviewModal } = await import("../src/ui/filePreviewModal.ts");

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
