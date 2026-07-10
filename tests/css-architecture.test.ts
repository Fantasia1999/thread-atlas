import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const styleRoot = path.join(repoRoot, "src/styles");

interface CssMetrics {
  lines: number;
  declarations: number;
  important: number;
  transitionAll: number;
}

function readCssFiles(): Array<{ name: string; css: string }> {
  return fs.readdirSync(styleRoot)
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => ({ name, css: fs.readFileSync(path.join(styleRoot, name), "utf8") }));
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function countDeclarations(css: string): number {
  const clean = stripComments(css);
  let count = 0;
  let statement = "";
  let quote = "";
  let parenDepth = 0;

  for (const char of clean) {
    if (quote) {
      statement += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      statement += char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (parenDepth === 0 && (char === "{" || char === "}")) {
      statement = "";
      continue;
    }
    if (parenDepth === 0 && char === ";") {
      if (/^\s*(?:--|-)?[a-zA-Z_][\w-]*\s*:/.test(statement)) count += 1;
      statement = "";
      continue;
    }
    statement += char;
  }

  return count;
}

function collectMetrics(): CssMetrics {
  const files = readCssFiles();
  const css = files.map((file) => file.css).join("\n");
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  return {
    lines: files.reduce((total, file) => total + file.css.split("\n").length - 1, 0) + entry.split("\n").length - 1,
    declarations: countDeclarations(css),
    important: (css.match(/!important\b/g) ?? []).length,
    transitionAll: (css.match(/transition\s*:\s*all\b/g) ?? []).length
  };
}

test("style entry declares the approved foundation layers", () => {
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(entry, /@layer tokens, base, primitives, layout, features, vendor, utilities;/);
  assert.match(entry, /\.\/styles\/tokens\.css/);
  assert.match(entry, /\.\/styles\/base\.css/);
  assert.match(entry, /\.\/styles\/primitives\.css/);
});

test("style entry keeps every import before the layer order statement", () => {
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const layerIndex = entry.indexOf("@layer tokens, base, primitives, layout, features, vendor, utilities;");
  assert.ok(layerIndex >= 0);
  for (const match of entry.matchAll(/@import\s+[^;]+;/g)) {
    assert.ok(match.index < layerIndex, match[0]);
  }
});

test("CSS complexity stays within the temporary migration ceiling", () => {
  const metrics = collectMetrics();
  assert.ok(metrics.lines <= 4700, JSON.stringify(metrics));
  assert.ok(metrics.declarations <= 2800, JSON.stringify(metrics));
  assert.ok(metrics.important <= 97, JSON.stringify(metrics));
  assert.ok(metrics.transitionAll <= 34, JSON.stringify(metrics));
});
