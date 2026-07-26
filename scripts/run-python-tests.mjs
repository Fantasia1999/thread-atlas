#!/usr/bin/env node
/**
 * Runs the Python tests that cover the screenshot annotation script.
 *
 * The annotation step is an optional part of the toolchain (it only regenerates
 * docs/screenshot_annotated.png), so a contributor without Python or Pillow
 * should still be able to run `npm test`. When the toolchain is missing this
 * skips loudly rather than failing; when it is present the tests must pass.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
}

const python = run("python3", ["--version"]);
if (python.error || python.status !== 0) {
  console.log("[python tests] SKIPPED: python3 is not available.");
  console.log("[python tests] Install Python 3 to cover scripts/annotate.py.");
  process.exit(0);
}

const pillow = run("python3", ["-c", "import PIL"]);
if (pillow.status !== 0) {
  console.log("[python tests] SKIPPED: Pillow is not installed.");
  console.log("[python tests] Install it with: pip install -r requirements.txt");
  process.exit(0);
}

const result = run("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
