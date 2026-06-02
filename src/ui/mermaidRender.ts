let mermaidLoaded = false;
let mermaidInstance: any = null;

async function ensureMermaid() {
  if (mermaidLoaded) return;

  try {
    // Check if we are running under Node.js (e.g. in test suite)
    const isNode = typeof process !== "undefined" && process.versions && process.versions.node;
    if (!isNode) {
      // Dynamically import CSS to ensure 100% offline-ready font & styling
      // @ts-ignore: CSS imports are resolved by Vite in the browser
      await import("boxicons/css/boxicons.min.css");
      // @ts-ignore: Stylesheet is resolved by Vite in the browser
      await import("@mostlylucid/mermaid-enhancements/styles.css");
    }
  } catch (e) {
    console.error("Failed to dynamically load boxicons or mermaid styles", e);
  }

  try {
    // Dynamically import mermaid
    const mermaidModule = await import("mermaid");
    mermaidInstance = mermaidModule.default;

    // Import from the minified export which exposes the correct full typings root (dist/index.d.ts)
    const enhancementsModule = await import("@mostlylucid/mermaid-enhancements/min");

    // Determine current theme
    const isDark = document.documentElement.dataset.theme === "dark";

    mermaidInstance.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose",
    });

    // Configure the enhancements toolbar buttons
    enhancementsModule.configure({
      controls: {
        showControls: true,
        fullscreen: true,
        zoomIn: true,
        zoomOut: true,
        reset: true,
        exportPng: true,
        exportSvg: true
      }
    });

    mermaidLoaded = true;
  } catch (e) {
    console.error("Failed to dynamically import Mermaid or Enhancements module", e);
  }
}

/**
 * Parses and renders all `.mermaid` code blocks under a given container element,
 * and activates interactive enhancements (pan, zoom, fullscreen lightbox, export).
 */
export async function renderMermaidDiagrams(root: HTMLElement): Promise<void> {
  const elements = root.querySelectorAll(".mermaid");
  if (elements.length === 0) return;

  await ensureMermaid();
  if (!mermaidInstance) return;

  const isDark = document.documentElement.dataset.theme === "dark";
  mermaidInstance.initialize({
    theme: isDark ? "dark" : "default"
  });

  try {
    const { cleanupMermaidEnhancements } = await import("@mostlylucid/mermaid-enhancements/min");
    cleanupMermaidEnhancements();
  } catch (e) {
    console.error("Failed to cleanup old mermaid enhancements", e);
  }

  try {
    // Run mermaid compiler on all elements of class 'mermaid'
    await mermaidInstance.run({
      nodes: elements
    });
  } catch (e) {
    console.error("Mermaid compiler rendering failed", e);
  }

  try {
    const { enhanceMermaidDiagrams } = await import("@mostlylucid/mermaid-enhancements/min");
    // Activate enhancements for the newly rendered SVGs
    enhanceMermaidDiagrams();

    // UX OPTIMIZATION: Prevent scroll trapping by intercepting the wheel event in the capture phase.
    // Zooming is ONLY triggered when holding the "Ctrl" (or Cmd) key. Otherwise, the page scrolls normally.
    const cards = root.querySelectorAll(".mermaid-diagram-card");
    for (const card of cards) {
      const preview = card.querySelector(".mermaid-preview-content");
      if (!preview) continue;

      preview.addEventListener("wheel", (e: Event) => {
        const wheelEvent = e as WheelEvent;
        if (!wheelEvent.ctrlKey) {
          // Stop event propagation in capturing phase to prevent svg-pan-zoom from intercepting the scroll wheel.
          // This allows the default scroll action to bubble up to the scrollable container.
          wheelEvent.stopPropagation();
        } else {
          // Prevent browser's default full-page zooming behavior when Ctrl+Scroll is performed
          wheelEvent.preventDefault();
        }
      }, { capture: true, passive: false });
    }
  } catch (e) {
    console.error("Failed to apply mermaid enhancements", e);
  }
}

export async function cleanupMermaid(): Promise<void> {
  try {
    const isNode = typeof process !== "undefined" && process.versions && process.versions.node;
    if (isNode) return;

    const { cleanupMermaidEnhancements, enhanceMermaidDiagrams } = await import("@mostlylucid/mermaid-enhancements/min");
    cleanupMermaidEnhancements();
    // Re-enhance all remaining visible diagrams in the document to prevent main session widgets from losing interactive states
    enhanceMermaidDiagrams();
  } catch (e) {
    console.error("Failed to cleanup mermaid enhancements", e);
  }
}
