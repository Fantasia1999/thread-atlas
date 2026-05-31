import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

/**
 * Bundles the standalone, deployable ThreadAtlas agent into a single ESM file.
 * The agent only depends on Node builtins (node:http, node:sqlite, node:crypto,
 * node:fs, ...), so it bundles cleanly with no externals and runs on Linux,
 * macOS, and Windows with Node.js 22+.
 */
await build({
  entryPoints: [path.join(projectRoot, "server", "agent.ts")],
  outfile: path.join(projectRoot, "dist", "agent", "atlas-agent.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  },
  legalComments: "none"
});

console.log("Built dist/agent/atlas-agent.mjs");
