import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const styleRoot = path.join(repoRoot, "src/styles");
const expectedImports = [
  "tokens.css",
  "base.css",
  "primitives.css",
  "layout.css",
  "sidebar.css",
  "session.css",
  "content.css",
  "dialogs.css",
  "vendor.css",
  "utilities.css"
];

interface CssMetrics {
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
  return {
    declarations: countDeclarations(css),
    important: (css.match(/!important\b/g) ?? []).length,
    transitionAll: (css.match(/transition\s*:\s*all\b/g) ?? []).length
  };
}

test("style entry imports only the approved module graph", () => {
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const imports = [...entry.matchAll(/\.\/styles\/([\w-]+\.css)/g)].map((match) => match[1]);
  assert.deepEqual(imports, expectedImports);
  assert.match(entry, /@layer tokens, base, primitives, layout, features, vendor, utilities;/);
});

test("style entry keeps every import before the layer order statement", () => {
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const layerIndex = entry.indexOf("@layer tokens, base, primitives, layout, features, vendor, utilities;");
  assert.ok(layerIndex >= 0);
  for (const match of entry.matchAll(/@import\s+[^;]+;/g)) {
    assert.ok(match.index < layerIndex, match[0]);
  }
});

test("CSS meets the final complexity budgets", () => {
  const metrics = collectMetrics();
  assert.ok(metrics.declarations <= 1750, JSON.stringify(metrics));
  assert.ok(metrics.important <= 16, JSON.stringify(metrics));
  assert.equal(metrics.transitionAll, 0, JSON.stringify(metrics));
});

test("literal colors live only in tokens and vendor overrides", () => {
  const offenders = readCssFiles()
    .filter(({ name }) => name !== "tokens.css" && name !== "vendor.css")
    .flatMap(({ name, css }) => stripComments(css).split("\n")
      .map((line, index) => ({ name, line: index + 1, text: line.trim() }))
      .filter(({ text }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(text)));
  assert.deepEqual(offenders, []);
});

test("navigation side panels use dedicated surface and divider tokens", () => {
  const tokens = fs.readFileSync(path.join(styleRoot, "tokens.css"), "utf8");
  const layout = fs.readFileSync(path.join(styleRoot, "layout.css"), "utf8");
  const sidebar = fs.readFileSync(path.join(styleRoot, "sidebar.css"), "utf8");
  const session = fs.readFileSync(path.join(styleRoot, "session.css"), "utf8");

  assert.match(tokens, /--bg-sidebar:\s*#f0f2f5;/);
  assert.match(tokens, /--border-sidebar:\s*#dfe3e8;/);
  assert.match(layout, /\.sidebar-mount\s*{[^}]*background:\s*var\(--bg-sidebar\)/s);
  assert.match(sidebar, /\.sidebar\s*{[^}]*background:\s*var\(--bg-sidebar\)/s);
  assert.match(session, /\.timeline-panel\s*{[^}]*background:\s*var\(--bg-sidebar\)/s);
});

test("legacy style modules and confirmed obsolete selectors are gone", () => {
  for (const name of ["topbar.css", "chat.css", "code.css", "modals.css", "misc.css"]) {
    assert.equal(fs.existsSync(path.join(styleRoot, name)), false, name);
  }
  const css = readCssFiles().map((file) => file.css).join("\n");
  for (const selector of [".select-input", ".tag-filter-select", ".glassmorphic"]) {
    assert.equal(css.includes(selector), false, selector);
  }
});

test("important declarations are isolated to vendor overrides and hidden", () => {
  const offenders = readCssFiles()
    .filter(({ name }) => name !== "vendor.css" && name !== "utilities.css")
    .filter(({ css }) => /!important\b/.test(css))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);

  const utilities = fs.readFileSync(path.join(styleRoot, "utilities.css"), "utf8");
  assert.equal((utilities.match(/!important\b/g) ?? []).length, 1);
  assert.match(utilities, /\.hidden\s*{[^}]*display\s*:\s*none\s*!important;/s);
});
