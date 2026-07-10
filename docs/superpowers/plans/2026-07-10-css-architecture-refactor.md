# CSS Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the patch-heavy global CSS cascade with a token- and primitive-driven architecture while preserving product behavior and reducing source CSS below the approved complexity budgets.

**Architecture:** `src/index.css` establishes ordered cascade layers and imports focused token, base, primitive, layout, feature, vendor, and utility modules. Existing behavior classes remain stable, new `ui-*` classes own reusable visual structure, and feature styles only own layout or state-specific differences.

**Tech Stack:** Framework-free TypeScript DOM UI, native CSS cascade layers and `color-mix()`, Vite 7, Node.js 22, `node:test`, and `tests/dom-mock.ts`.

## Global Constraints

- Preserve all content, functionality, interaction flows, light/dark themes, and dense log-viewer ergonomics.
- CSS source must total no more than 2,600 lines and no more than 1,750 declarations.
- CSS may contain no more than 16 `!important` declarations, only in third-party overrides or the forced-hidden utility.
- First-party CSS outside `tokens.css` and `vendor.css` must contain no literal hex, `rgb()`, or `rgba()` colors.
- CSS must contain no `transition: all` and no confirmed obsolete first-party selectors.
- Do not introduce a UI framework, CSS framework, CSS-in-JS runtime, preprocessor, or new dependency.
- Keep `html[data-theme="dark"]` as the theme switch and keep current `.active`, `.open`, `.visible`, and `.hidden` state behavior.
- Keep existing business classes for JavaScript queries and test location; add `ui-*` classes for shared appearance.
- Keep Highlight.js, KaTeX, Mermaid, and dynamically generated vendor DOM rules isolated in `vendor.css`.
- Preserve the untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml`; never stage them.
- Follow `DESIGN.md`: retain the monochrome surface system and main mesh gradient, and remove other decorative gradients, glass effects, glows, hover scaling, and hover translation.
- Run focused tests after each red/green cycle and run `npm run test`, `npm run typecheck`, and `npm run build` at every task boundary.

---

## Baseline

- `npm run test`: 188 tests pass.
- `npm run typecheck`: passes.
- `npm run build`: passes; Vite reports the application CSS bundle as 135.46 kB before gzip, including imported vendor CSS.
- First-party CSS: 4,376 lines, 567 rules, 2,521 declarations, 97 `!important` declarations, 34 `transition: all` declarations, and 125 non-token literal color declarations.

## File Map

**Final style ownership**

- Create `src/styles/tokens.css`: light/dark theme values, source/status colors, typography, spacing, radii, elevation, motion, layout widths, and z-index values.
- Rewrite `src/styles/base.css`: reset and document-level defaults only.
- Create `src/styles/primitives.css`: reusable `ui-button`, `ui-icon-button`, `ui-input`, `ui-chip`, `ui-badge`, `ui-panel`, `ui-menu-*`, `ui-modal`, and `ui-status` rules.
- Rewrite `src/styles/layout.css`: app shell, topbar, sidebar/timeline docks, rails, and shared responsive layout.
- Rewrite `src/styles/sidebar.css`: session list, rows, tree, metadata, pin/favorite states, and sidebar-only layout.
- Create `src/styles/session.css`: chat header, filters, timeline list, log entries, citations, commentary groups, tags, scroll controls, and subagent notices.
- Create `src/styles/content.css`: Markdown structure, code frames, tool calls, tables, blockquotes, images, math containers, and first-party Mermaid card chrome.
- Create `src/styles/dialogs.css`: modal-specific layout for import, SSH, connections, export, and file preview.
- Create `src/styles/vendor.css`: KaTeX import, Highlight.js token selectors, Mermaid enhancement overrides, and library-generated lightbox rules.
- Create `src/styles/utilities.css`: scrollbars, toast positioning/animation, and `.hidden`.
- Rewrite `src/index.css`: cascade order and imports only.
- Delete `src/styles/topbar.css`, `src/styles/chat.css`, `src/styles/code.css`, `src/styles/modals.css`, and `src/styles/misc.css` after their selectors have migrated.

**DOM class composition**

- Modify `src/ui/app.ts`: shell buttons, theme toggles, and status badge.
- Modify `src/ui/sidebar.ts`: rails, inputs, menu, chips, badges, panels, and inline-style removal.
- Modify `src/ui/chatView.ts`: header controls, menus, chips, tag panel, copy feedback, timeline controls, and inline-style removal.
- Modify `src/ui/messageRenderer.ts`: log panels, status badges, tool-call panels, and expand control.
- Modify `src/ui/markdown.ts`: code/Mermaid panels and tab visibility classes.
- Modify `src/ui/importModal.ts`, `src/ui/sshModal.ts`, `src/ui/connectionModal.ts`, `src/ui/exportMdModal.ts`, and `src/ui/filePreviewModal.ts`: shared modal, input, button, chip, badge, status, and panel classes.
- Modify `src/ui/utils.ts`: toast primitive classes only; retain functional off-screen textarea and ANSI content color generation.
- Modify `src/main.ts`: move the KaTeX stylesheet import under the CSS vendor layer.

**Tests**

- Create `tests/css-architecture.test.ts`: module graph and source-metric enforcement without adding a parser dependency.
- Modify `tests/render-scope.test.ts`, `tests/sidebar.test.ts`, `tests/resume-command.test.ts`, `tests/markdown-render.test.ts`, `tests/connection-modal.test.ts`, `tests/export-md-modal.test.ts`, and `tests/file-preview-modal.test.ts`: shared primitive class contracts plus existing behavior.
- Modify `scripts/capture-screenshot.ts`: add safe light/dark and mobile capture options while retaining mocked generic session data.

---

### Task 1: Establish the Token, Base, and Primitive Foundation

**Files:**
- Create: `tests/css-architecture.test.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/primitives.css`
- Modify: `src/styles/base.css`
- Modify: `src/index.css`
- Modify: `src/ui/app.ts`
- Modify: `tests/render-scope.test.ts`
- Modify: `scripts/capture-screenshot.ts`

**Interfaces:**
- Produces: ordered cascade layers `tokens, base, primitives, layout, features, vendor, utilities`.
- Produces: reusable classes `ui-button`, `ui-button--primary`, `ui-button--secondary`, `ui-button--ghost`, `ui-button--compact`, `ui-icon-button`, `ui-input`, `ui-textarea`, `ui-chip`, `ui-badge`, `ui-panel`, `ui-menu-root`, `ui-menu-trigger`, `ui-menu`, `ui-menu-item`, `ui-modal`, and `ui-status`.
- Preserves: existing `.button`, `.primary`, `.secondary`, `.ghost`, `.status-pill`, and `.theme-toggle-button` behavior classes during migration.

- [ ] **Step 1: Add deterministic theme/mobile capture options and preserve the visual baseline**

Extend the existing argument parser in `scripts/capture-screenshot.ts` without changing its mocked descriptors or bundle. Add a mobile viewport and a validated theme option:

```ts
let theme: "light" | "dark" | "" = "";

const RESOLUTIONS: Record<string, { width: number; height: number; defaultZoom: number }> = {
  mobile: { width: 720, height: 960, defaultZoom: 1 },
  "960p": { width: 1440, height: 960, defaultZoom: 1.25 },
  "1080p": { width: 1920, height: 1080, defaultZoom: 1.25 },
  "2k": { width: 2560, height: 1440, defaultZoom: 1.75 },
  "4k": { width: 3840, height: 2160, defaultZoom: 2.5 }
};

// Inside the existing argument loop:
if (arg.startsWith("--theme=")) {
  const value = arg.slice("--theme=".length);
  if (value !== "light" && value !== "dark") {
    throw new Error(`Unsupported screenshot theme: ${value}`);
  }
  theme = value;
}
```

Immediately after the first `page.goto`, set the saved theme and reload before waiting for `.session-row`:

```ts
if (theme) {
  await page.evaluate((value) => {
    localStorage.setItem("thread-atlas-theme", value);
  }, theme);
  await page.reload({ waitUntil: "networkidle0" });
}
```

Back up the tracked documentation artifacts, build the unchanged app, capture the four approved baselines, and restore the tracked files after each output has been copied:

Run:

```bash
mkdir -p /tmp/thread-atlas-css-refactor/before
mkdir -p /tmp/thread-atlas-css-refactor/repo-artifacts
cp docs/screenshot.png docs/screenshot_annotated.png docs/element-positions.json /tmp/thread-atlas-css-refactor/repo-artifacts/
npm run build
npm run screenshot -- --resolution=960p --zoom=1 --theme=light
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/before/light-desktop.png
npm run screenshot -- --resolution=960p --zoom=1 --theme=dark
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/before/dark-desktop.png
npm run screenshot -- --resolution=mobile --theme=light
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/before/light-mobile.png
npm run screenshot -- --resolution=mobile --theme=dark
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/before/dark-mobile.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/screenshot.png docs/screenshot.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/screenshot_annotated.png docs/screenshot_annotated.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/element-positions.json docs/element-positions.json
```

Expected: four safe mocked screenshots exist under `/tmp/thread-atlas-css-refactor/before`, the three tracked documentation artifacts match HEAD, and `git status --short` shows only `scripts/capture-screenshot.ts`, the plan's implementation changes, and the pre-existing untracked pnpm files.

- [ ] **Step 2: Write the failing architecture and shell primitive tests**

Create `tests/css-architecture.test.ts` with a dependency-free scanner and a transitional baseline ceiling:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const styleRoot = path.join(repoRoot, "src/styles");

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

function collectMetrics() {
  const files = readCssFiles();
  const css = files.map((file) => file.css).join("\n");
  return {
    lines: files.reduce((total, file) => total + file.css.split("\n").length - 1, 0) + fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8").split("\n").length - 1,
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

test("CSS complexity stays within the temporary migration ceiling", () => {
  const metrics = collectMetrics();
  assert.ok(metrics.lines <= 4700, JSON.stringify(metrics));
  assert.ok(metrics.declarations <= 2800, JSON.stringify(metrics));
  assert.ok(metrics.important <= 97, JSON.stringify(metrics));
  assert.ok(metrics.transitionAll <= 34, JSON.stringify(metrics));
});
```

Append this shell contract to `tests/render-scope.test.ts`:

```ts
test("app shell composes shared control primitives", () => {
  const store = new SessionStore();
  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);

  const topbarButtons = root.querySelectorAll(".topbar .button");
  assert.ok(topbarButtons.length >= 4);
  assert.equal(topbarButtons.every((button) => button.classList.contains("ui-button")), true);
  assert.equal(root.querySelector(".status-pill")?.classList.contains("ui-badge"), true);
  assert.equal(root.querySelectorAll(".theme-toggle-button").every((button) => button.classList.contains("ui-chip")), true);
});
```

- [ ] **Step 3: Run the new tests and verify they fail for the intended reasons**

Run: `node --import tsx --test tests/css-architecture.test.ts tests/render-scope.test.ts`

Expected: FAIL because `src/index.css` has no layer declaration or token/primitive imports and the app shell lacks `ui-*` classes.

- [ ] **Step 4: Split theme values from reset rules and declare the transitional layer graph**

Move all current `:root` and `html[data-theme="dark"]` custom properties into `src/styles/tokens.css`, replace duplicate aliases and missing fallback names with this canonical vocabulary, and keep literal colors in this file only:

```css
:root {
  --sidebar-width: 320px;
  --timeline-width: 320px;
  --rail-width: 44px;
  --control-compact: 28px;
  --control-standard: 32px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --bg-app: #fafafa;
  --bg-panel: #ffffff;
  --bg-muted: #f5f5f5;
  --bg-hover: #fafafa;
  --bg-code: #f5f5f5;
  --bg-overlay: rgba(23, 23, 23, 0.4);
  --border-default: #ebebeb;
  --border-strong: #a1a1a1;
  --text-primary: #171717;
  --text-secondary: #4d4d4d;
  --text-muted: #888888;
  --text-link: #0070f3;
  --accent: #171717;
  --accent-inverse: #ffffff;
  --status-success: #0070f3;
  --status-warning: #f5a623;
  --status-danger: #ee0000;
  --pin-color: #ff7a59;
  --favorite-color: #f5a623;
  --brand-codex: #3b82f6;
  --brand-claude: #f97316;
  --brand-opencode: #10b981;
  --brand-gemini: #eab308;
  --brand-antigravity: #06b6d4;
  --brand-copilot: #8b5cf6;
  --syntax-keyword: #ff0080;
  --syntax-string: #0070f3;
  --syntax-number: #7928ca;
  --syntax-function: #eb367f;
  --syntax-attribute: #29bc9b;
  --syntax-builtin: #f5a623;
  --syntax-tag: #ff0080;
  --syntax-operator: #171717;
  --syntax-meta: #4d4d4d;
  --syntax-insert-bg: rgba(0, 112, 243, 0.08);
  --syntax-delete-bg: rgba(238, 0, 0, 0.08);
  --syntax-meta-bg: rgba(121, 40, 202, 0.08);
  --font-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
  --radius-control: 6px;
  --radius-panel: 8px;
  --radius-full: 9999px;
  --shadow-float: 0 8px 16px -8px rgba(0, 0, 0, 0.12);
  --shadow-modal: 0 24px 32px -12px rgba(0, 0, 0, 0.18);
  --motion-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-normal: 160ms cubic-bezier(0.4, 0, 0.2, 1);
  --mesh-opacity: 0.65;
  --mesh-color-1: rgba(0, 112, 243, 0.08);
  --mesh-color-2: rgba(80, 227, 194, 0.08);
  --mesh-color-3: rgba(121, 40, 202, 0.06);
  --mesh-color-4: rgba(255, 0, 80, 0.05);
  --mesh-color-5: rgba(245, 166, 35, 0.04);
  --z-rail: 8;
  --z-topbar: 10;
  --z-float: 20;
  --z-modal: 100;
  --z-lightbox: 200;
}

html[data-theme="dark"] {
  --bg-app: #0a0a0a;
  --bg-panel: #121212;
  --bg-muted: #1a1a1a;
  --bg-hover: #1e1e1e;
  --bg-code: #0a0a0a;
  --bg-overlay: rgba(0, 0, 0, 0.75);
  --border-default: #333333;
  --border-strong: #666666;
  --text-primary: #ffffff;
  --text-secondary: #a1a1a1;
  --text-muted: #737373;
  --accent: #ffffff;
  --accent-inverse: #0a0a0a;
  --syntax-operator: #ffffff;
  --syntax-meta: #888888;
  --syntax-insert-bg: rgba(0, 112, 243, 0.12);
  --syntax-delete-bg: rgba(238, 0, 0, 0.12);
  --syntax-meta-bg: rgba(121, 40, 202, 0.12);
  --shadow-float: 0 8px 16px -8px rgba(0, 0, 0, 0.45);
  --shadow-modal: 0 24px 32px -12px rgba(0, 0, 0, 0.65);
  --mesh-opacity: 0.45;
  --mesh-color-1: rgba(0, 112, 243, 0.15);
  --mesh-color-2: rgba(80, 227, 194, 0.12);
  --mesh-color-3: rgba(121, 40, 202, 0.12);
  --mesh-color-4: rgba(255, 0, 80, 0.1);
  --mesh-color-5: rgba(245, 166, 35, 0.08);
}
```

Until Tasks 2–5 have migrated every consumer, append compatibility aliases whose values point to canonical tokens rather than new literals:

```css
:root {
  --bg-panel-muted: var(--bg-muted);
  --bg-surface: var(--bg-panel);
  --bg-surface-hover: var(--bg-hover);
  --bg-surface-active: var(--bg-muted);
  --border-subtle: var(--bg-hover);
  --border-focus: var(--accent);
  --text-link-hover: var(--text-link);
  --accent-subtle: var(--bg-muted);
  --accent-emphasis: var(--accent);
  --accent-base: var(--text-link);
  --success: var(--status-success);
  --warning: var(--status-warning);
  --danger: var(--status-danger);
  --font-brand: var(--font-sans);
  --font-code: var(--font-mono);
  --shadow-sm: none;
  --shadow-md: var(--shadow-float);
  --radius-sm: var(--radius-control);
  --radius-md: var(--radius-panel);
  --radius-lg: var(--radius-panel);
  --transition: var(--motion-fast);
  --md-border: var(--border-default);
  --md-code-bg: var(--bg-code);
  --md-code-header: var(--bg-muted);
  --md-code-text: var(--text-primary);
  --md-code-comment: var(--text-muted);
  --md-code-keyword: var(--syntax-keyword);
  --md-code-string: var(--syntax-string);
  --md-code-number: var(--syntax-number);
  --md-code-function: var(--syntax-function);
  --md-code-attr: var(--syntax-attribute);
  --md-code-builtin: var(--syntax-builtin);
  --md-code-property: var(--syntax-string);
  --md-code-tag: var(--syntax-tag);
  --md-code-operator: var(--syntax-operator);
  --md-code-meta: var(--syntax-meta);
  --md-code-line-insert: var(--syntax-insert-bg);
  --md-code-line-delete: var(--syntax-delete-bg);
  --md-code-line-meta: var(--syntax-meta-bg);
  --md-code-emphasis: var(--text-primary);
  --md-inline-code-bg: var(--bg-muted);
  --md-inline-code-text: var(--syntax-function);
  --md-link: var(--text-link);
  --md-link-hover: var(--text-link);
  --md-quote-border: var(--border-strong);
  --md-quote-bg: var(--bg-hover);
  --md-surface-strong: var(--bg-muted);
  --md-table-stripe: color-mix(in srgb, var(--bg-muted) 50%, transparent);
}
```

Task 6 removes this compatibility block after `rg -n 'var\(--(?:bg-surface|bg-panel-muted|accent-base|font-brand|font-code|radius-sm|radius-md|shadow-sm|shadow-md|transition|md-)' src/styles` returns no feature-module matches.

Rewrite `src/styles/base.css` so it contains only the universal box model, color scheme, document/body defaults, form inheritance, checkbox accent, and `#app`/`.app-shell` height rules. Remove all theme variables from this file.

Use a transitional `src/index.css` that introduces layers while retaining old feature modules until their tasks migrate them:

```css
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter:wght@400;500;600&display=swap");

@layer tokens, base, primitives, layout, features, vendor, utilities;

@import "./styles/tokens.css" layer(tokens);
@import "./styles/base.css" layer(base);
@import "./styles/primitives.css" layer(primitives);
@import "./styles/topbar.css" layer(layout);
@import "./styles/layout.css" layer(layout);
@import "./styles/sidebar.css" layer(features);
@import "./styles/chat.css" layer(features);
@import "./styles/code.css" layer(features);
@import "./styles/modals.css" layer(features);
@import "./styles/misc.css" layer(utilities);
```

- [ ] **Step 5: Add the shared primitive rules and compose them into the app shell**

Implement `src/styles/primitives.css` with low-specificity `:where()` state selectors and property-specific transitions. Use this core shape and add only the modifiers listed in the Interfaces block:

```css
.ui-button,
.ui-icon-button,
.ui-chip,
.ui-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), opacity var(--motion-fast);
}

.ui-button {
  min-height: var(--control-standard);
  gap: var(--space-2);
  padding: 0 var(--space-3);
}

.ui-button:hover,
.ui-icon-button:hover,
.ui-chip:hover,
.ui-menu-trigger:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.ui-button--primary,
.ui-chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-inverse);
}

.ui-button--secondary {
  background: var(--bg-muted);
}

.ui-button--ghost {
  border-color: transparent;
  background: transparent;
}

.ui-button--compact {
  min-height: var(--control-compact);
  padding-inline: var(--space-2);
  font-size: 12px;
}

.ui-button:disabled,
.ui-icon-button:disabled,
.ui-chip:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.ui-button:focus-visible,
.ui-icon-button:focus-visible,
.ui-chip:focus-visible,
.ui-input:focus-visible,
.ui-menu-trigger:focus-visible {
  outline: 2px solid var(--text-link);
  outline-offset: 2px;
}

.ui-icon-button {
  width: var(--control-compact);
  height: var(--control-compact);
  padding: 0;
}

.ui-input {
  width: 100%;
  min-height: var(--control-standard);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 12px;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}

.ui-input::placeholder {
  color: var(--text-muted);
}

.ui-textarea {
  min-height: 88px;
  resize: vertical;
  line-height: 1.5;
}

.ui-chip,
.ui-badge {
  min-height: 20px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  font-size: 11px;
  white-space: nowrap;
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--badge-color, var(--text-muted)) 35%, transparent);
  background: color-mix(in srgb, var(--badge-color, var(--text-muted)) 12%, transparent);
  color: color-mix(in srgb, var(--badge-color, var(--text-muted)) 72%, var(--text-primary));
}

.ui-panel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-panel);
}

.ui-modal {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--bg-panel);
  box-shadow: var(--shadow-modal);
}
```

In `src/ui/app.ts`, keep behavior classes and add primitives:

```ts
this.statusNode.className = "status-pill ui-badge";

private makeButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "button ui-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => void onClick());
  return button;
}

button.className = `theme-toggle-button ui-chip${this.theme === theme ? " active" : ""}`;
```

- [ ] **Step 6: Verify the foundation and commit**

Run: `node --import tsx --test tests/css-architecture.test.ts tests/render-scope.test.ts`

Expected: PASS.

Run: `npm run test && npm run typecheck && npm run build`

Expected: 188 or more tests pass; typecheck and build pass.

Commit:

```bash
git add scripts/capture-screenshot.ts src/index.css src/styles/tokens.css src/styles/base.css src/styles/primitives.css src/ui/app.ts tests/css-architecture.test.ts tests/render-scope.test.ts
git commit -m "refactor: establish CSS tokens and primitives"
```

---

### Task 2: Migrate the Shell, Topbar, and Sidebar

**Files:**
- Modify: `src/ui/sidebar.ts`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/sidebar.css`
- Modify: `src/index.css`
- Modify: `tests/sidebar.test.ts`
- Delete: `src/styles/topbar.css`

**Interfaces:**
- Consumes: all `ui-*` primitives from Task 1.
- Produces: shell and sidebar feature rules with no control reimplementation and no inline layout styles.
- Preserves: all existing sidebar behavior selectors, source ordering, tree state, hover/focus close timing, pin/favorite callbacks, and hidden-project commands.

- [ ] **Step 1: Write failing sidebar primitive assertions**

Update the exact class assertion in `tests/sidebar.test.ts` and add a focused composition test:

```ts
assert.ok(input.classList.contains("text-input"));
assert.ok(input.classList.contains("ui-input"));

test("sidebar composes shared controls and panels", () => {
  const sidebar = renderSidebar(createSidebarOptions());
  assert.equal(sidebar.querySelector(".rail-button")?.classList.contains("ui-icon-button"), true);
  assert.equal(sidebar.querySelector(".panel-icon-button")?.classList.contains("ui-icon-button"), true);
  assert.equal(sidebar.querySelector(".count-badge")?.classList.contains("ui-badge"), true);
  assert.equal(sidebar.querySelector(".session-row")?.classList.contains("ui-panel"), true);
  assert.equal(sidebar.querySelector(".source-badge")?.classList.contains("ui-badge"), true);

  const dropdown = sidebar.querySelector(".source-filter-dropdown");
  assert.equal(dropdown?.classList.contains("ui-menu-root"), true);
  assert.equal(dropdown?.querySelector(".custom-dropdown-trigger")?.classList.contains("ui-menu-trigger"), true);
  assert.equal(dropdown?.querySelector(".custom-dropdown-menu")?.classList.contains("ui-menu"), true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/sidebar.test.ts`

Expected: FAIL because sidebar elements do not yet contain the shared primitive classes.

- [ ] **Step 3: Add primitives to sidebar DOM without changing behavior hooks**

Apply these class compositions in both top-level and subagent row builders:

```ts
openButton.className = "rail-button ui-icon-button";
pinButton.className = `panel-icon-button ui-icon-button${nextOptions.pinned ? " active" : ""}`;
countBadge.className = "count-badge ui-badge";
search.className = "text-input ui-input";
chipsContainer.className = "quick-chips-container";
allFavChip.className = `chip-btn ui-chip star-chip${isFavSearchActive ? " active" : ""}`;
button.className = `session-row ui-panel${descriptor.key === options.selectedKey ? " active" : ""}${isPinned ? " pinned-row" : ""}${isFavorited ? " favorite-row" : ""}`;
badgeSpan.className = `source-badge ui-badge ${descriptor.source}`;
connectionBadgeEl.className = "connection-badge ui-badge";
pinBtn.className = `session-action-btn ui-icon-button pin-btn${isPinned ? " active" : ""}`;
favBtn.className = `session-action-btn ui-icon-button favorite-btn${isFavorited ? " active" : ""}`;
pill.className = "tag-pill ui-badge";
badge.className = "subagent-count-badge ui-badge";
moreBtn.className = "button secondary ui-button ui-button--secondary show-more-sessions-btn";
```

For tree rows, initialize `btnClassName` with `session-row ui-panel`; for hidden-workspace rows, use `session-row ui-panel`. Add `ui-badge` to both HTML-template source badges: `<span class="source-badge ui-badge unknown">` and `<span class="source-badge ui-badge ${descriptor.source}">`.

Update `createCustomDropdown` without renaming queried classes:

```ts
container.className = "custom-dropdown-container ui-menu-root";
trigger.className = "custom-dropdown-trigger ui-menu-trigger";
menu.className = "custom-dropdown-menu ui-menu hidden";
btn.className = `custom-dropdown-item ui-menu-item${item.value === selectedValue ? " active" : ""}`;
```

Remove `chipsContainer.style.display`; use only `chipsContainer.classList.toggle("hidden", !showChips)`. Remove the four `showMore` inline style assignments and move them under `.show-more-sessions-btn`. Remove `style="display: block"` from the caret SVG templates and set the SVG display in `.session-title-row svg`.

- [ ] **Step 4: Rewrite shell and sidebar CSS around layout and state responsibilities**

Move `.topbar`, `.brand-block`, `.topbar-actions`, `.topbar-side`, `.theme-toggle`, and responsive shell rules into `src/styles/layout.css`. Remove generic `.button`, badge, and control declarations now owned by primitives. Keep the mesh only on `.main-mount::before`.

Rewrite `src/styles/sidebar.css` with this exact responsibility split:

```css
.sidebar { /* panel positioning and flex column only */ }
.panel-header,
.panel-header-actions,
.sidebar-controls { /* sidebar layout only */ }
.session-list,
.session-tree-node,
.session-children-container { /* list/tree geometry */ }
.session-row,
.session-row:hover,
.session-row.active,
.session-row.pinned-row,
.session-row.favorite-row,
.session-row.subagent-row { /* row state only; no duplicated control chrome */ }
.session-row-top,
.source-and-date,
.session-title-row,
.session-path-row,
.session-item-actions { /* internal row layout */ }
.session-title,
.session-date,
.session-workspace,
.session-path,
.session-row-note { /* typography and truncation */ }
.source-badge.codex { --badge-color: var(--brand-codex); }
.source-badge.claude { --badge-color: var(--brand-claude); }
.source-badge.opencode { --badge-color: var(--brand-opencode); }
.source-badge.gemini { --badge-color: var(--brand-gemini); }
.source-badge.antigravity { --badge-color: var(--brand-antigravity); }
.source-badge.copilot { --badge-color: var(--brand-copilot); }
.pinned-row { --row-accent: var(--pin-color); }
.favorite-row { --row-accent: var(--favorite-color); }
.quick-chips-container,
.session-row-tags { /* sidebar-specific clusters */ }
.show-more-sessions-btn { width: calc(100% - 16px); margin: 12px 8px; }
```

Derive badge background/border through `.ui-badge`; delete all light/dark per-source blocks, all pin/favorite gradients and glows, and all hover scale/translate rules. Use border color or a flat left indicator for pinned/favorite priority.

Remove `src/styles/topbar.css` from `src/index.css` and delete the file after its remaining layout rules have moved.

- [ ] **Step 5: Verify sidebar behavior, responsive compilation, and commit**

Run: `node --import tsx --test tests/sidebar.test.ts tests/render-scope.test.ts tests/css-architecture.test.ts`

Expected: PASS, including all hover/focus delay and dropdown interaction tests.

Run: `npm run test && npm run typecheck && npm run build`

Expected: PASS.

Commit:

```bash
git add src/index.css src/styles/layout.css src/styles/sidebar.css src/styles/topbar.css src/ui/sidebar.ts tests/sidebar.test.ts
git commit -m "refactor: simplify shell and sidebar styles"
```

---

### Task 3: Migrate Session Layout, Timeline, and Log Controls

**Files:**
- Create: `src/styles/session.css`
- Modify: `src/styles/chat.css`
- Modify: `src/index.css`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/chatView.ts`
- Modify: `src/ui/messageRenderer.ts`
- Modify: `src/ui/timeline.ts`
- Modify: `tests/resume-command.test.ts`
- Modify: `tests/chat-view-scroll.test.ts`
- Modify: `tests/subagent-notification.test.ts`

**Interfaces:**
- Consumes: Task 1 primitives and Task 2 dock/rail layout.
- Produces: `session.css` for session-only structure and state; `chat.css` temporarily retains only Markdown/image/Mermaid content pending Task 4.
- Preserves: filtering, copy feedback, tags/notes, commentary collapsing, citations, timeline jumping/pinning, scroll restoration, parent/history navigation, subagent navigation, and export dropdown behavior.

- [ ] **Step 1: Write failing session primitive and state-class tests**

Replace exact class-name expectations in `tests/resume-command.test.ts` with behavior plus primitive assertions:

```ts
assert.equal(container.tagName, "button");
assert.ok(container.classList.contains("button"));
assert.ok(container.classList.contains("copy-command-button"));
assert.ok(container.classList.contains("ui-button"));
assert.ok(container.classList.contains("ui-button--secondary"));

const trigger = container.querySelector(".custom-dropdown-trigger");
assert.ok(trigger?.classList.contains("ui-menu-trigger"));
assert.ok(container.querySelector(".custom-dropdown-menu")?.classList.contains("ui-menu"));
```

Add assertions to the existing render tests:

```ts
assert.equal(container.querySelector(".filter-chip")?.classList.contains("ui-chip"), true);
assert.equal(container.querySelector(".log-entry")?.classList.contains("ui-panel"), true);
assert.equal(container.querySelector(".scroll-btn")?.classList.contains("ui-icon-button"), true);
assert.equal(container.querySelector(".subagent-status-pill")?.classList.contains("ui-badge"), true);
```

- [ ] **Step 2: Run focused tests and verify the new assertions fail**

Run: `node --import tsx --test tests/resume-command.test.ts tests/chat-view-scroll.test.ts tests/subagent-notification.test.ts`

Expected: FAIL only on missing `ui-*` classes.

- [ ] **Step 3: Compose primitives into session DOM and remove inline visual styling**

Use these class contracts throughout `chatView.ts`, `messageRenderer.ts`, and `timeline.ts`:

```ts
pinToggleBtn.className = `button header-fav-btn ui-button ui-button--compact pin-btn${isPinned ? " active" : ""}`;
favToggleBtn.className = `button header-fav-btn ui-button ui-button--compact favorite-btn${isFavorited ? " active" : ""}`;
editTagsBtn.className = "button header-fav-btn edit-tags-btn ui-button ui-button--secondary ui-button--compact";
chip.className = `filter-chip ui-chip${filter.key === options.filter ? " active" : ""}`;
tagsPanel.className = "tags-edit-panel ui-panel hidden";
filterRow.className = "chat-filter-row";
backLink.className = "parent-session-backlink md-link";
separator.className = "parent-link-separator";
button.className = "button secondary copy-command-button ui-button ui-button--secondary";
container.className = "custom-dropdown-container copy-command-dropdown-container ui-menu-root";
triggerBtn.className = "button secondary custom-dropdown-trigger copy-command-dropdown-trigger ui-button ui-button--secondary ui-menu-trigger";
menu.className = "custom-dropdown-menu ui-menu hidden";
item.className = "custom-dropdown-item ui-menu-item";
timelineToggle.className = "rail-button ui-icon-button";
timelinePin.className = `panel-icon-button ui-icon-button${options.timelinePinned ? " active" : ""}`;
btnTop.className = "scroll-btn scroll-btn-top ui-icon-button";
btnBottom.className = "scroll-btn scroll-btn-bottom ui-icon-button";
entry.className = "log-entry ui-panel";
groupElement.className = "log-entry collapsed-commentary-group ui-panel";
statusPill.className = `subagent-status-pill ui-badge ${notify.status}`;
block.className = "tool-call-block ui-panel";
toggleButton.className = "button secondary message-expand-button ui-button ui-button--secondary ui-button--compact";
```

Replace tag panel `style.display` reads/writes with `.hidden`. Replace copy-button inline icon/label styles with `.trigger-icon`, `.trigger-arrow`, and `data-state="loading|success|error"`; colors come from tokens. Replace `.chat-filter-row`, menu-root width, and parent-link inline geometry with CSS. Give the clickable cwd span `.chat-meta-copyable`, toggle `.copied` during feedback, and remove its cursor, user-select, color, and font-weight style assignments. Remove all `message-expand-button` style assignments from `messageRenderer.ts`. Replace `list.style.opacity = "1"` in `app.ts` with `list.classList.add("ready")` and style `.chat-messages.ready { opacity: 1; }`.

Do not remove functional inline styles in `utils.ts` used to position the temporary clipboard textarea or ANSI span colors derived from session content.

- [ ] **Step 4: Create the flat session module and reduce chat.css to content-only rules**

Move these selector families into `src/styles/session.css`: `.main-panel`, `.chat-header*`, `.chat-meta*`, `.chat-actions`, `.chat-filter-row`, `.filter-chip*`, `.chat-layout`, `.chat-messages`, `.timeline-*`, `.log-entry*`, `.commentary-*`, `.citation-*`, `.chat-fav-actions`, `.header-fav-btn*`, `.header-badge`, `.tags-*`, `.header-bookmark-summary`, `.summary-*`, `.scroll-helper-hub`, `.scroll-btn*`, `.subagent-*`, and `.parent-*`.

Implement active colors without gradients or glow:

```css
.header-fav-btn.pin-btn.active,
.session-action-btn.pin-btn.active {
  --control-accent: var(--pin-color);
  border-color: var(--control-accent);
  background: color-mix(in srgb, var(--control-accent) 14%, var(--bg-panel));
  color: color-mix(in srgb, var(--control-accent) 75%, var(--text-primary));
}

.header-fav-btn.favorite-btn.active,
.session-action-btn.favorite-btn.active {
  --control-accent: var(--favorite-color);
  border-color: var(--control-accent);
  background: color-mix(in srgb, var(--control-accent) 14%, var(--bg-panel));
  color: color-mix(in srgb, var(--control-accent) 70%, var(--text-primary));
}

.log-role-badge.user { --badge-color: var(--brand-opencode); }
.log-role-badge.assistant,
.log-role-badge.developer { --badge-color: var(--brand-codex); }
.log-role-badge.system { --badge-color: var(--status-danger); }
.log-role-badge.tool { --badge-color: var(--status-warning); }
```

Keep log rows flat: one border, no default shadow, no hover elevation, and only the current role indicator. Keep timeline drawer translation because it conveys open/closed state, but remove scale/glass effects from floating scroll controls. Delete obsolete `.tag-filter-select` rules because the UI uses the custom dropdown.

Import `session.css` in the features layer immediately before the temporarily reduced `chat.css`.

- [ ] **Step 5: Verify session behavior and commit**

Run: `node --import tsx --test tests/resume-command.test.ts tests/chat-view-scroll.test.ts tests/subagent-notification.test.ts tests/css-architecture.test.ts`

Expected: PASS.

Run: `npm run test && npm run typecheck && npm run build`

Expected: PASS.

Commit:

```bash
git add src/index.css src/styles/session.css src/styles/chat.css src/ui/app.ts src/ui/chatView.ts src/ui/messageRenderer.ts src/ui/timeline.ts tests/resume-command.test.ts tests/chat-view-scroll.test.ts tests/subagent-notification.test.ts
git commit -m "refactor: flatten session and timeline styles"
```

---

### Task 4: Consolidate Markdown, Code, and Vendor Overrides

**Files:**
- Create: `src/styles/content.css`
- Create: `src/styles/vendor.css`
- Modify: `src/index.css`
- Modify: `src/main.ts`
- Modify: `src/ui/markdown.ts`
- Modify: `src/ui/messageRenderer.ts`
- Modify: `tests/markdown-render.test.ts`
- Delete: `src/styles/chat.css`
- Delete: `src/styles/code.css`

**Interfaces:**
- Consumes: session panels and primitive controls.
- Produces: first-party content chrome in `content.css` and library-generated selectors in `vendor.css`.
- Preserves: code collapse, syntax highlighting, diff highlighting, Markdown links/lists/tables/quotes, math, image gallery/zoom, Mermaid tabs, pan/zoom/fullscreen/export, and tool-call inspection.

- [ ] **Step 1: Write failing Markdown primitive and visibility-state assertions**

Extend the existing code-frame and Mermaid tests in `tests/markdown-render.test.ts`:

```ts
assert.equal(frame.classList.contains("ui-panel"), true);
assert.equal(card.classList.contains("ui-panel"), true);
assert.equal(card.querySelectorAll(".mermaid-tab-btn").every((button) => button.classList.contains("ui-chip")), true);

const preview = card.querySelector(".mermaid-preview-content");
const code = card.querySelector(".mermaid-code-content");
assert.equal(preview?.classList.contains("hidden"), false);
assert.equal(code?.classList.contains("hidden"), true);
```

- [ ] **Step 2: Run the Markdown tests and verify they fail**

Run: `node --import tsx --test tests/markdown-render.test.ts`

Expected: FAIL because frames/cards/tabs do not use primitives and Mermaid tab visibility still uses inline styles.

- [ ] **Step 3: Compose content primitives and class-based Mermaid tab state**

Update `markdown.ts` and the tool-call builders:

```ts
card.className = "mermaid-diagram-card ui-panel";
btnPreview.className = "mermaid-tab-btn ui-chip active";
btnCode.className = "mermaid-tab-btn ui-chip";
previewContainer.className = "mermaid-diagram-container mermaid-preview-content active";
codeContainer.className = "mermaid-code-content hidden";
figure.className = "md-code-frame ui-panel";
block.className = "tool-call-block ui-panel";
```

Tab handlers must toggle `.active` and `.hidden` only:

```ts
btnPreview.addEventListener("click", () => {
  btnPreview.classList.add("active");
  btnCode.classList.remove("active");
  previewContainer.classList.remove("hidden");
  codeContainer.classList.add("hidden");
});

btnCode.addEventListener("click", () => {
  btnCode.classList.add("active");
  btnPreview.classList.remove("active");
  previewContainer.classList.add("hidden");
  codeContainer.classList.remove("hidden");
});
```

- [ ] **Step 4: Split first-party content rules from vendor selectors**

Create `content.css` from the remaining Markdown/image/math/Mermaid card rules in `chat.css` plus first-party frame/tool/table/list/link rules in `code.css`. Replace old `--md-*` aliases with canonical background, border, text, syntax, and status tokens. Keep panels flat and transitions property-specific.

Create `vendor.css` with the KaTeX import first, followed by Highlight.js and Mermaid generated-DOM rules:

```css
@import "katex/dist/katex.min.css";

.hljs-comment,
.hljs-quote { color: var(--text-muted); font-style: italic; }
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-name { color: var(--syntax-keyword); }
.hljs-string,
.hljs-regexp,
.hljs-symbol,
.hljs-bullet { color: var(--syntax-string); }
.hljs-number { color: var(--syntax-number); }
.hljs-title,
.hljs-title.function_,
.hljs-function .hljs-title,
.hljs-section { color: var(--syntax-function); }
.hljs-attr,
.hljs-attribute,
.hljs-selector-id,
.hljs-selector-class { color: var(--syntax-attribute); }
.hljs-built_in,
.hljs-builtin-name { color: var(--syntax-builtin); }
.hljs-property,
.hljs-type { color: var(--syntax-string); }
.hljs-tag,
.hljs-selector-pseudo { color: var(--syntax-tag); }
.hljs-operator { color: var(--syntax-operator); }
.hljs-meta { color: var(--syntax-meta); }
.hljs-emphasis { font-style: italic; }
.md-code.language-diff .hljs-addition,
.md-code.language-diff .hljs-deletion,
.md-code.language-diff .hljs-meta { display: block; margin-inline: -14px; padding-inline: 14px; }
.md-code.language-diff .hljs-addition { background: var(--syntax-insert-bg); }
.md-code.language-diff .hljs-deletion { background: var(--syntax-delete-bg); }
.md-code.language-diff .hljs-meta { background: var(--syntax-meta-bg); }

.md-math-block .katex-display { margin: 0; }

.mermaid-lightbox { z-index: var(--z-lightbox) !important; /* Overrides enhancement package inline stacking. */ }
body:has(.mermaid-lightbox) .scroll-helper-hub { opacity: 0 !important; pointer-events: none !important; /* Prevents controls above fullscreen vendor UI. */ }
.mermaid-lightbox-content { width: 96% !important; height: 92% !important; border-radius: var(--radius-control) !important; /* Overrides enhancement package fixed geometry. */ }
.mermaid-lightbox-diagram-wrapper { padding: 1.5rem !important; /* Restores usable diagram viewport. */ }
.mermaid-lightbox-close { width: 2.2rem !important; height: 2.2rem !important; top: 0.5rem !important; right: 0.5rem !important; /* Overrides enhancement package close control geometry. */ }
```

Remove `import "katex/dist/katex.min.css"` from `src/main.ts`. Import `content.css` in the features layer and `vendor.css` in the vendor layer. Delete `chat.css` and `code.css` after all selectors move.

- [ ] **Step 5: Verify content rendering, vendor compilation, and commit**

Run: `node --import tsx --test tests/markdown-render.test.ts tests/chat-view-scroll.test.ts tests/subagent-notification.test.ts tests/file-preview-modal.test.ts tests/css-architecture.test.ts`

Expected: PASS.

Run: `npm run test && npm run typecheck && npm run build`

Expected: PASS; Vite resolves the KaTeX CSS import from `vendor.css`.

Commit:

```bash
git add src/index.css src/main.ts src/styles/content.css src/styles/vendor.css src/styles/chat.css src/styles/code.css src/ui/markdown.ts src/ui/messageRenderer.ts tests/markdown-render.test.ts
git commit -m "refactor: isolate content and vendor styles"
```

---

### Task 5: Consolidate Dialogs, Forms, Menus, and Toasts

**Files:**
- Create: `src/styles/dialogs.css`
- Create: `src/styles/utilities.css`
- Modify: `src/styles/primitives.css`
- Modify: `src/index.css`
- Modify: `src/ui/importModal.ts`
- Modify: `src/ui/sshModal.ts`
- Modify: `src/ui/connectionModal.ts`
- Modify: `src/ui/exportMdModal.ts`
- Modify: `src/ui/filePreviewModal.ts`
- Modify: `src/ui/utils.ts`
- Modify: `tests/connection-modal.test.ts`
- Modify: `tests/export-md-modal.test.ts`
- Modify: `tests/file-preview-modal.test.ts`
- Delete: `src/styles/modals.css`
- Delete: `src/styles/misc.css`

**Interfaces:**
- Consumes: all shared primitives and feature content styles.
- Produces: one modal shell, one input system, one menu system, one status system, and modal-specific layouts only.
- Preserves: modal stacking/close, drag-and-drop import, SSH tabs/auth/results/sync, connection persistence/edit/delete, export selection/filename configuration, file preview loading/error/highlighting, dropdown behavior, and toast lifecycle.

- [ ] **Step 1: Write failing dialog primitive assertions**

Add these assertions to the first render test in each relevant file:

```ts
assert.equal(overlay.querySelector(".modal-card")?.classList.contains("ui-modal"), true);
assert.equal(overlay.querySelector(".button")?.classList.contains("ui-button"), true);
```

Add form-specific assertions:

```ts
assert.equal(overlay.querySelector(".input")?.classList.contains("ui-input"), true);
assert.equal(overlay.querySelector(".connection-feedback")?.classList.contains("ui-status"), true);
assert.equal(overlay.querySelector(".export-filter-chip")?.classList.contains("ui-chip"), true);
assert.equal(overlay.querySelector(".export-message-item")?.classList.contains("ui-panel"), true);
```

- [ ] **Step 2: Run dialog tests and verify they fail**

Run: `node --import tsx --test tests/connection-modal.test.ts tests/export-md-modal.test.ts tests/file-preview-modal.test.ts`

Expected: FAIL only on missing primitive classes.

- [ ] **Step 3: Apply the shared class matrix to every modal builder**

Keep all existing business classes and append the following primitives consistently:

| Existing role | Added classes |
|---|---|
| `.modal-card` | `.ui-modal` |
| `.button.primary` | `.ui-button.ui-button--primary` |
| `.button.secondary` | `.ui-button.ui-button--secondary` |
| `.button.ghost` | `.ui-button.ui-button--ghost` |
| `.text-input`, `.input` | `.ui-input` |
| `.text-area`, textarea `.input` | `.ui-input.ui-textarea` |
| `.filter-pill`, `.export-filter-chip`, `.tab-btn`, `.auth-mode-btn` | `.ui-chip` |
| `.status-inline`, `.saved-status-inline`, `.results-status-inline`, `.connection-feedback` | `.ui-status` |
| `.saved-server-row`, `.remote-row`, `.export-message-item` | `.ui-panel` |
| `.custom-dropdown-container` | `.ui-menu-root` |
| `.custom-dropdown-trigger` | `.ui-menu-trigger` |
| `.custom-dropdown-menu` | `.ui-menu` |
| `.custom-dropdown-item` | `.ui-menu-item` |

For example:

```ts
card.className = "modal-card modal-wide ui-modal";
closeButton.className = "button ghost ui-button ui-button--ghost";
tokenInput.className = "input ui-input";
submit.className = "button primary ui-button ui-button--primary";
status.className = "status-inline status-info ui-status";
chip.className = "export-filter-chip ui-chip";
item.className = "export-message-item ui-panel";
```

Every function that replaces a status element's complete `className` must retain the primitive:

```ts
status.className = `status-inline ui-status status-${type}`;
savedStatus.className = "saved-status-inline ui-status status-error";
```

Move export checkbox and tool-call inline styles into `.export-message-checkbox-label`, `.export-message-checkbox`, and `.export-tool-calls`. Replace SSH auth label `style.display` assignments with `.hidden` toggles. Remove the file-preview error SVG's inline margin/vertical-align and style it through `.error-status svg`. Keep only content-derived media dimensions, ANSI content colors, and the clipboard textarea positioning as functional inline styles.

- [ ] **Step 4: Rewrite dialogs and utilities, then remove legacy modules**

Build `dialogs.css` around the following selector groups without redefining primitive chrome:

```css
.modal-overlay,
.modal-card,
.modal-wide,
.modal-header,
.modal-body { /* modal geometry and scrolling */ }
.form-grid,
.field-span-2,
.button-row,
.connection-grid,
.connection-row { /* modal form layouts */ }
.dropzone,
.dropzone.dragging { /* import-only drop target */ }
.modal-tabs,
.tab-content,
.tab-content.active,
.auth-mode-selector { /* SSH mode layout */ }
.saved-server-panel,
.saved-server-list,
.saved-server-content,
.saved-server-actions { /* saved SSH layout */ }
.results-toolbar,
.source-filter-pills,
.remote-results,
.remote-row-content,
.results-footer { /* remote result layout */ }
.connection-section,
.connection-form,
.connection-remote-label { /* connection manager layout */ }
.export-filter-row,
.export-message-list,
.export-message-content-wrapper,
.export-message-details,
.export-filename-row,
.filename-config-container,
.filename-config-dropdown,
.filename-config-list,
.filename-config-item,
.filename-config-item-left,
.filename-config-item-right,
.filename-config-btn { /* export-only layout */ }
.modal-preview-card,
.modal-preview-body,
.preview-* { /* file preview layout */ }
```

Complete `primitives.css` menu/status rules:

```css
.ui-menu-root { position: relative; min-width: 0; }
.ui-menu-trigger { width: 100%; min-height: var(--control-standard); justify-content: space-between; gap: var(--space-2); padding: 0 var(--space-2); }
.ui-menu { position: absolute; z-index: var(--z-float); min-width: 100%; max-height: 240px; overflow-y: auto; padding: var(--space-1); border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: var(--bg-panel); box-shadow: var(--shadow-float); }
.ui-menu-item { width: 100%; min-height: var(--control-standard); padding: 0 var(--space-2); border-radius: var(--radius-control); color: var(--text-secondary); text-align: left; }
.ui-menu-item:hover,
.ui-menu-item.active { background: var(--bg-hover); color: var(--text-primary); }
.ui-status { --status-color: var(--text-secondary); color: var(--status-color); background: color-mix(in srgb, var(--status-color) 10%, var(--bg-panel)); border-color: color-mix(in srgb, var(--status-color) 25%, var(--border-default)); }
.ui-status.status-success,
.ui-status.success { --status-color: var(--status-success); }
.ui-status.status-error,
.ui-status.error { --status-color: var(--status-danger); }
.ui-status.status-loading { --status-color: var(--text-link); }
```

Create `utilities.css` with only global scrollbars, toast placement/flat status variants, keyframes used by toast/modal entry, and:

```css
.hidden { display: none !important; /* State utility must override component display rules. */ }
```

Delete obsolete native `.select-input`, legacy `.tag-filter-select`, glass dropdown overrides, duplicate status banners, duplicate inputs, decorative gradients, and historical comments. Remove `modals.css` and `misc.css` from `index.css`, import `dialogs.css` in features and `utilities.css` in utilities, then delete both legacy files.

- [ ] **Step 5: Verify every modal flow and commit**

Run: `node --import tsx --test tests/connection-modal.test.ts tests/export-md-modal.test.ts tests/file-preview-modal.test.ts tests/sidebar.test.ts tests/resume-command.test.ts tests/css-architecture.test.ts`

Expected: PASS.

Run: `npm run test && npm run typecheck && npm run build`

Expected: PASS.

Commit:

```bash
git add src/index.css src/styles/primitives.css src/styles/dialogs.css src/styles/utilities.css src/styles/modals.css src/styles/misc.css src/ui/importModal.ts src/ui/sshModal.ts src/ui/connectionModal.ts src/ui/exportMdModal.ts src/ui/filePreviewModal.ts src/ui/utils.ts tests/connection-modal.test.ts tests/export-md-modal.test.ts tests/file-preview-modal.test.ts
git commit -m "refactor: unify dialog and utility styles"
```

---

### Task 6: Enforce Final Budgets and Perform Visual Verification

**Files:**
- Modify: `tests/css-architecture.test.ts`
- Modify: `src/index.css` to contain the final ten-module import graph only.
- Modify: `src/styles/tokens.css` to remove every Task 1 compatibility alias with no remaining consumer.
- Modify: `src/styles/base.css` and `src/styles/primitives.css` to remove duplicated defaults and retain only their declared responsibilities.
- Modify: `src/styles/layout.css`, `src/styles/sidebar.css`, `src/styles/session.css`, `src/styles/content.css`, and `src/styles/dialogs.css` to replace all compatibility-token references and remove duplicate primitive declarations.
- Modify: `src/styles/vendor.css` to keep no more than the documented Mermaid overrides plus vendor token selectors.
- Modify: `src/styles/utilities.css` to keep only scrollbars, toast, shared entry keyframes, and `.hidden`.

**Interfaces:**
- Consumes: the complete style graph from Tasks 1–5.
- Produces: final automated architecture gates and verified screenshots.
- Preserves: all functionality covered by the 188-test baseline and manual UI checklist.

- [ ] **Step 1: Tighten the architecture test to the approved final contract**

Replace the transitional baseline test and add final topology, color, and deprecation assertions:

```ts
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

test("style entry imports only the approved module graph", () => {
  const entry = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const imports = [...entry.matchAll(/\.\/styles\/([\w-]+\.css)/g)].map((match) => match[1]);
  assert.deepEqual(imports, expectedImports);
  assert.match(entry, /@layer tokens, base, primitives, layout, features, vendor, utilities;/);
});

test("CSS meets the final complexity budgets", () => {
  const metrics = collectMetrics();
  assert.ok(metrics.lines <= 2600, JSON.stringify(metrics));
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
```

- [ ] **Step 2: Run the architecture test and use its exact failures as the cleanup list**

Run: `node --import tsx --test tests/css-architecture.test.ts`

Expected: initially FAIL if any line/declaration budget, legacy file, literal color, `transition: all`, or `!important` isolation requirement remains.

- [ ] **Step 3: Complete only mechanical consolidation required by the test**

Run the compatibility-token search and replace each remaining feature reference with its canonical equivalent before deleting the alias block from `tokens.css`:

```bash
rg -n 'var\(--(?:bg-surface|bg-panel-muted|accent-base|font-brand|font-code|radius-sm|radius-md|shadow-sm|shadow-md|transition|md-)' src/styles
```

Use these exact replacements: `--bg-surface` → `--bg-panel`, `--bg-panel-muted` → `--bg-muted`, `--bg-surface-hover` → `--bg-hover`, `--bg-surface-active` → `--bg-muted`, `--accent-base` → `--text-link`, `--font-brand` → `--font-sans`, `--font-code` → `--font-mono`, `--radius-sm` → `--radius-control`, `--radius-md`/`--radius-lg` → `--radius-panel`, `--shadow-md` → `--shadow-float`, and each `--md-*` token → the canonical background/border/text/syntax token established in Task 1. Delete `--shadow-sm` uses instead of replacing them because ordinary panels are flat. Replace every remaining `var(--transition)` or broad transition with the relevant `--motion-fast`/`--motion-normal` property list.

Within each feature file, remove repeated `display`, alignment, height, border, radius, background, font-size, and transition declarations already supplied by its `ui-*` class. Merge selectors only when they share the same primitive state, then remove stale comments and blank sections. Do not single-line rules or combine unrelated components in broad comma groups. Re-run `node --import tsx --test tests/css-architecture.test.ts` after `tokens.css`, primitives/base, layout/sidebar, session/content, and dialogs/vendor/utilities until it passes.

Expected final metric output from the test: `lines <= 2600`, `declarations <= 1750`, `important <= 16`, and `transitionAll === 0`.

- [ ] **Step 4: Run the complete automated verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
git diff --check
```

Expected: 188 or more tests pass; typecheck, build, and diff check pass. The existing Vite Mermaid chunk warnings may remain, but no new CSS syntax or missing-import warning is allowed.

- [ ] **Step 5: Capture and inspect the post-refactor UI**

Capture the same four mocked scenarios used for the baseline, copying each result out of the worktree:

```bash
mkdir -p /tmp/thread-atlas-css-refactor/after
npm run screenshot -- --resolution=960p --zoom=1 --theme=light
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/after/light-desktop.png
npm run screenshot -- --resolution=960p --zoom=1 --theme=dark
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/after/dark-desktop.png
npm run screenshot -- --resolution=mobile --theme=light
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/after/light-mobile.png
npm run screenshot -- --resolution=mobile --theme=dark
cp docs/screenshot.png /tmp/thread-atlas-css-refactor/after/dark-mobile.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/screenshot.png docs/screenshot.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/screenshot_annotated.png docs/screenshot_annotated.png
cp /tmp/thread-atlas-css-refactor/repo-artifacts/element-positions.json docs/element-positions.json
```

Expected: all eight screenshot runs across Tasks 1 and 6 complete without server, browser, annotation, or missing-selector errors, and the tracked documentation artifacts match their Task 1 backups.

Inspect all four before/after image pairs and manually verify in the browser: pinned and drawer sidebar, pinned and drawer timeline, search/source/tag filters, session selection, copy dropdown feedback, tag editing, commentary/citation collapse, code/tool blocks, Mermaid preview/code/fullscreen, import, SSH tabs/results, connections, Markdown export, file preview, toast, focus rings, overflow, and z-index stacking.

Expected: intentional flattening and palette normalization are visible; no content is missing, unreadable, clipped, obscured, horizontally overflowing, or unreachable by pointer/keyboard.

- [ ] **Step 6: Review scope and commit the final gates**

Run:

```bash
git status --short
git diff --stat
git diff -- src/index.css src/styles src/ui tests/css-architecture.test.ts
```

Expected: no generated screenshot diff, no pnpm files staged, no unrelated file changes, and no formatting-only churn outside the planned files.

Commit:

```bash
git add src/index.css src/styles tests/css-architecture.test.ts
git commit -m "test: enforce CSS architecture budgets"
```

Run once more after the commit: `npm run test && npm run typecheck && npm run build && git status --short`

Expected: all verification passes; working tree contains only the pre-existing untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
