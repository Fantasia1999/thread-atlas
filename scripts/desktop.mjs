import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Cross-platform "thin client" launcher. Builds the app if needed, starts the
 * local ThreadAtlas agent, waits for it to become reachable, and opens the
 * system default browser. Works on Linux, macOS, and Windows using only Node
 * builtins, so no Electron/Tauri runtime is required for the lightweight flow.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.ATLAS_AGENT_PORT ?? "3030");
const serverEntry = path.join(root, "dist", "server", "server", "index.js");
const clientIndex = path.join(root, "dist", "index.html");

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit", cwd: root });
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}

function waitForServer(url, attempts = 40) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        remaining -= 1;
        if (remaining <= 0) {
          reject(new Error("Agent did not start in time."));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

if (!existsSync(serverEntry) || !existsSync(clientIndex)) {
  console.log("Building ThreadAtlas...");
  run(process.execPath, [path.join(root, "node_modules", ".bin", "vite"), "build"]);
  run("npm", ["run", "build:agent"]);
  run(process.execPath, [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.server.json"
  ]);
}

console.log(`Starting ThreadAtlas agent on http://localhost:${port} ...`);
const agent = spawn(process.execPath, [serverEntry], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ATLAS_AGENT_PORT: String(port) }
});

const url = `http://localhost:${port}`;
waitForServer(url)
  .then(() => {
    console.log("ThreadAtlas is ready.");
    openBrowser(url);
  })
  .catch((error) => {
    console.error(error.message);
  });

const shutdown = () => {
  agent.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
