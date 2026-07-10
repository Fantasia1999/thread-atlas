import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

import { findAvailablePort, waitForHttpServer } from "./screenshotRuntime.js";

const mockDescriptors = [
  {
    key: "file::/home/user/projects/markdown-viewer/src/renderer.ts",
    source: "antigravity",
    title: "Implement custom markdown renderer with syntax highlighting",
    primaryPath: "/home/user/projects/markdown-viewer/src/renderer.ts",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 24500,
    mtimeMs: 1779973000000,
    metadata: {
      primaryWorkspace: "/workspace/markdown-viewer"
    }
  },
  {
    key: "file::/home/user/projects/web-app/session-12.jsonl",
    source: "claude",
    title: "Refactor global state using native Context API",
    primaryPath: "/home/user/projects/web-app/session-12.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 15400,
    mtimeMs: 1779972000000,
    metadata: {
      cwd: "/workspace/web-app"
    }
  },
  {
    key: "file::/home/user/projects/parser/rollout-5.jsonl",
    source: "codex",
    title: "Write unit tests for AST node parsing",
    primaryPath: "/home/user/projects/parser/rollout-5.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 9200,
    mtimeMs: 1779971000000,
    metadata: {
      cwd: "/workspace/ast-parser"
    }
  },
  {
    key: "file::/home/user/projects/auth-service/session-4/events.jsonl",
    source: "copilot",
    title: "Configure OAuth2 flow for authentication layer",
    primaryPath: "/home/user/projects/auth-service/session-4/events.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 31000,
    mtimeMs: 1779970000000,
    metadata: {
      cwd: "/workspace/auth-service"
    }
  }
];

function getMockBundle(key: string): any {
  const records = [
    {
      record_type: "session_meta",
      cascade_id: "019e0133-f8ec-7e62-8b31-bbe8d119c117",
      created_time: "2026-05-30T10:15:30.000Z",
      last_modified_time: "2026-05-30T10:20:41.000Z",
      workspaces: ["/workspace/markdown-viewer"]
    },
    {
      record_type: "message",
      role: "user",
      content: "<USER_REQUEST>\nHow do I build a lightweight, dependency-free Markdown renderer in TypeScript that handles inline code and code blocks with syntax highlighting?\n</USER_REQUEST>",
      created_at: "2026-05-30T10:15:35.000Z"
    },
    {
      record_type: "message",
      role: "assistant",
      content: "Building a clean, lightweight Markdown parser is straightforward. We can parse the input string line-by-line or using regular expressions for blocks (headers, lists, code blocks) and then apply inline parsing (bold, code, links). For syntax highlighting, we can integrate highlight.js. Let's look at the core structure in `src/renderer.ts`.",
      created_at: "2026-05-30T10:16:02.000Z"
    },
    {
      record_type: "tool_call",
      tool_name: "view_file",
      tool_call: {
        id: "tool-1",
        name: "view_file",
        arguments: { AbsolutePath: "/workspace/markdown-viewer/src/renderer.ts", StartLine: 12, EndLine: 26 }
      },
      created_at: "2026-05-30T10:16:05.000Z"
    },
    {
      record_type: "tool_result",
      tool_name: "view_file",
      tool_call: { id: "tool-1", name: "view_file" },
      content: [
        "12: export function renderMarkdown(text: string): string {",
        "13:   const lines = text.split('\\n');",
        "14:   let html = '';",
        "15:   let inCodeBlock = false;",
        "16: ",
        "17:   for (const line of lines) {",
        "18:     if (line.startsWith('```')) {",
        "19:       inCodeBlock = !inCodeBlock;",
        "20:       html += inCodeBlock ? '<pre><code>' : '</code></pre>';",
        "21:       continue;",
        "22:     }",
        "23:     html += inCodeBlock ? escapeHtml(line) : parseInline(line);",
        "24:   }",
        "25:   return html;",
        "26: }"
      ].join("\n"),
      completed_at: "2026-05-30T10:16:08.000Z"
    },
    {
      record_type: "message",
      role: "assistant",
      content: "This simple line-by-line parser handles code blocks, but it doesn't support syntax highlighting or nested elements yet. Let's modify it to automatically detect the language (like `typescript` or `css`) from the markdown fence and run `highlight.js`'s highlight function on the block contents.",
      created_at: "2026-05-30T10:16:20.000Z"
    }
  ];

  return {
    key,
    source: "antigravity",
    title: "Implement custom markdown renderer with syntax highlighting",
    primaryPath: key.replace("file::", ""),
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 24500,
    mtimeMs: 1779973000000,
    metadata: {
      primaryWorkspace: "/workspace/markdown-viewer"
    },
    files: [
      {
        path: key.replace("file::", ""),
        content: records.map(r => JSON.stringify(r)).join("\n")
      }
    ]
  };
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let resKey = "";
  let zoomFactor = "";
  let theme: "light" | "dark" | "" = "";

  const RESOLUTIONS: Record<string, { width: number; height: number; defaultZoom: number }> = {
    "mobile": { width: 720, height: 960, defaultZoom: 1 },
    "960p": { width: 1440, height: 960, defaultZoom: 1.25 },
    "1080p": { width: 1920, height: 1080, defaultZoom: 1.25 },
    "2k": { width: 2560, height: 1440, defaultZoom: 1.75 },
    "4k": { width: 3840, height: 2160, defaultZoom: 2.5 },
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--resolution=")) {
      resKey = arg.split("=")[1].toLowerCase();
    } else if (arg === "-r" && i + 1 < args.length) {
      resKey = args[++i].toLowerCase();
    } else if (arg.startsWith("--zoom=")) {
      zoomFactor = arg.split("=")[1];
    } else if (arg === "-z" && i + 1 < args.length) {
      zoomFactor = args[++i];
    } else if (arg.startsWith("--theme=")) {
      const value = arg.slice("--theme=".length);
      if (value !== "light" && value !== "dark") {
        throw new Error(`Unsupported screenshot theme: ${value}`);
      }
      theme = value;
    } else {
      // Fallback for positional arguments
      const lowerArg = arg.toLowerCase();
      if (lowerArg in RESOLUTIONS) {
        resKey = lowerArg;
      } else if (!isNaN(parseFloat(arg)) && parseFloat(arg) > 0.1 && parseFloat(arg) < 10) {
        zoomFactor = arg;
      }
    }
  }

  // Fallback to default resolution
  if (!resKey) {
    resKey = "960p";
  }

  const config = RESOLUTIONS[resKey] || RESOLUTIONS["960p"];

  // Fallback to default zoom for the chosen resolution
  if (!zoomFactor) {
    zoomFactor = config.defaultZoom.toString();
  }

  console.log(`[Screenshot Orchestrator] Selected Resolution: ${resKey.toUpperCase()} (${config.width}x${config.height}), Zoom: ${zoomFactor}`);

  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Starting ThreadAtlas Express server at ${baseUrl}...`);
  const server = spawn(process.execPath, ["dist/server/server/index.js", `--port=${port}`], {
    stdio: "inherit"
  });

  let browser;
  try {
    await waitForHttpServer(baseUrl, server);
    console.log("Launching headless browser via Puppeteer...");
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
    } catch (error) {
      console.error("Failed to launch browser with default puppeteer. Attempting download...", error);
      const installProcess = spawn("npx", ["puppeteer", "browsers", "install", "chrome"], {
        stdio: "inherit",
        shell: true
      });
      await new Promise((resolve) => installProcess.on("exit", resolve));
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
    }

    const page = await browser.newPage();
    await page.setViewport({ width: config.width, height: config.height, deviceScaleFactor: 1 });

    // Enable request interception to mock API calls containing sensitive local information
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/local/scan")) {
        console.log("Mocking API response for /api/local/scan");
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            files: mockDescriptors
          })
        });
      } else if (url.includes("/api/local/session")) {
        console.log(`Mocking API response for /api/local/session: ${url}`);
        const key = new URL(url).searchParams.get("key") || "";
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            bundle: getMockBundle(key)
          })
        });
      } else {
        request.continue();
      }
    });

    console.log(`Navigating to ${baseUrl}...`);
    await page.goto(baseUrl, { waitUntil: "networkidle0" });

    if (theme) {
      console.log(`Applying ${theme} theme...`);
      await page.evaluate((value) => {
        localStorage.setItem("thread-atlas-theme", value);
      }, theme);
      await page.reload({ waitUntil: "networkidle0" });
    }
  
    console.log(`Setting page zoom to ${zoomFactor}...`);
    await page.evaluate(`document.documentElement.style.zoom = '${zoomFactor}'`);

    console.log("Waiting for sessions to load...");
    await page.waitForSelector(".session-row", { timeout: 15000 });

    const sessions = await page.$$(".session-row");
    console.log(`Found ${sessions.length} sessions.`);

    // Click on the first session which is our mocked antigravity session
    if (sessions.length > 0) {
      console.log("Clicking the mock session.");
      await sessions[0].click();
    }

    console.log("Waiting for chat messages to load and render...");
    await page.waitForSelector(".chat-messages", { timeout: 10000 });

    // Wait extra time for syntax highlight and fonts to fully load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const screenshotPath = path.resolve(process.cwd(), "docs/screenshot.png");
    console.log(`Saving screenshot to ${screenshotPath}...`);
    await page.screenshot({ path: screenshotPath });

    console.log("Extracting element positions for annotation alignment...");
    const positions = await page.evaluate(`
      (function() {
        function getRect(selector) {
          var el = document.querySelector(selector);
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), selector: selector };
        }

        function getBtnByText(text) {
          var btns = Array.from(document.querySelectorAll("button"));
          var el = btns.find(function(b) {
            return b.textContent && b.textContent.trim().includes(text);
          });
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }

        function getAllRects(selector) {
          var els = document.querySelectorAll(selector);
          return Array.from(els).map(function(el, i) {
            var r = el.getBoundingClientRect();
            return {
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
              text: (el.textContent || "").slice(0, 50),
              index: i
            };
          });
        }

        return {
          themeToggle: getRect(".theme-toggle"),
          rescanBtn: getBtnByText("Rescan local"),
          importBtn: getBtnByText("Import files"),
          sshBtn: getBtnByText("SSH sync"),
          pathDisplay: getRect(".status-pill"),
          searchInput: getRect(".sidebar-controls .text-input"),
          sourceFilter: getRect(".source-filter-dropdown .custom-dropdown-trigger"),
          sidebarHeader: getRect(".sidebar .panel-header"),
          sessionList: getRect(".session-list"),
          sessionCount: getRect(".sidebar .panel-header .count-badge"),
          sortToggle: getRect(".sidebar .panel-header .panel-icon-button"),
          chatHeader: getRect(".chat-header"),
          chatTitleRow: getRect(".chat-title-row"),
          chatActions: getRect(".chat-actions"),
          chatMeta: getRect(".chat-meta"),
          filterTabs: getRect(".filter-chip-row"),
          actionButtons: getAllRects(".chat-actions button"),
          toolRows: getAllRects(".tool-call-block"),
          timeline: getRect(".timeline-panel"),
          timelineEntries: getAllRects(".timeline-item"),
          exportBtn: getBtnByText("Export JSON"),
          copyBtn: getRect(".chat-actions .copy-command-button"),
          pinBtn: getRect(".timeline-header .panel-icon-button"),
          allButtons: getAllRects("button"),
        };
      })()
    `) as any;

    const outPath = path.resolve(process.cwd(), "docs/element-positions.json");
    fs.writeFileSync(outPath, JSON.stringify(positions, null, 2));
    console.log(`Saved dynamic positions to ${outPath}`);

  } finally {
    try {
      if (browser) {
        console.log("Closing browser...");
        await browser.close();
      }
    } finally {
      if (server.exitCode === null) {
        console.log("Stopping ThreadAtlas server...");
        server.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  console.log("Running python annotation script...");
  const annotateProcess = spawn("python3", ["scripts/annotate.py"], {
    stdio: "inherit"
  });
  const annotationExit = await new Promise<number | null>((resolve) => annotateProcess.on("exit", resolve));
  if (annotationExit !== 0) {
    throw new Error(`Screenshot annotation failed with exit code ${annotationExit}.`);
  }

  console.log("All done!");
  process.exit(0);
}

main().catch((error) => {
  console.error("Screenshot capture failed:", error);
  process.exit(1);
});
