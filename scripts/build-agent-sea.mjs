import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Builds a Node Single Executable Application (SEA) for the deployable agent so
 * that target machines do not need a separate Node.js install. Works on Linux,
 * macOS, and Windows. Requires Node.js 22+ and the `postject` tool (installed
 * on demand via `npx`).
 *
 * Steps:
 *   1. Bundle the agent (scripts/build-agent.mjs).
 *   2. Generate the SEA blob from sea-config.json.
 *   3. Copy the running node binary as the executable shell.
 *   4. Inject the blob into the copy with postject.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distAgentDir = path.join(root, "dist", "agent");
const bundlePath = path.join(distAgentDir, "atlas-agent.mjs");
const blobPath = path.join(distAgentDir, "atlas-agent.blob");
const isWindows = process.platform === "win32";
const exeName = isWindows ? "atlas-agent.exe" : "atlas-agent";
const exePath = path.join(distAgentDir, exeName);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

mkdirSync(distAgentDir, { recursive: true });

if (!existsSync(bundlePath)) {
  run(process.execPath, [path.join(root, "scripts", "build-agent.mjs")]);
}

console.log("Generating SEA blob...");
run(process.execPath, ["--experimental-sea-config", "sea-config.json"]);

console.log(`Copying node runtime to ${exeName}...`);
copyFileSync(process.execPath, exePath);

const postjectArgs = [
  "postject",
  exePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];
if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}

console.log("Injecting blob with postject...");
run("npx", ["--yes", ...postjectArgs]);

console.log(`Built single executable: ${exePath}`);
