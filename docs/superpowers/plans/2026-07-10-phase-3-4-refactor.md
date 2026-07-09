# Phase 3–4 Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the mandatory source-adapter registry and scoped-rendering refactors while preserving all current session parsing, scanning, unsafe resume, and subagent navigation behavior.

**Architecture:** Frontend and backend get separate ordered source registries because only the backend may depend on Node APIs. SessionStore publishes explicit render scopes, ThreadAtlasApp renders shell/sidebar/main independently, and a persistent sidebar controller keeps controls stable while replacing only list content.

**Tech Stack:** TypeScript, browser DOM APIs, Node.js ESM, Express, Vite, node:test, the repository DOM mock.

## Global Constraints

- Do not introduce a frontend framework, virtual DOM, state-management library, or CSS framework.
- Do not change the local scan or session bundle API contracts in shared/types.ts.
- Do not move normalized Session parsing into the server.
- Preserve parser fallbacks and source detection priority.
- Keep Antigravity protobuf decoding as the only backend decode exception.
- Keep SSH commands free of unsanitized user shell input.
- Keep browser imports in SessionStore and do not upload them.
- Preserve the untracked .antigravitycli/ directory and never stage it.
- Run npm run typecheck, npm test, and npm run build at each phase boundary.

---

## File Map

**Frontend source ownership**

- Create src/sources/types.ts: SourceAdapter and DetectContext contracts.
- Create src/sources/codex.ts, copilot.ts, claude.ts, opencode.ts, antigravity.ts, gemini.ts: source-specific detect/parse/resume behavior.
- Create src/sources/registry.ts: ordered registry and lookup helpers.
- Modify src/parsers/detect.ts: registry orchestration and global fallbacks only.
- Modify src/ui/chatView.ts and src/ui/sidebar.ts: registry consumers.
- Delete src/ui/resumeCommands.ts after tests and consumers move.

**Backend source ownership**

- Create server/sources/types.ts: backend adapter and scan context contracts.
- Create server/sources/fileSources.ts: Codex, Claude, Gemini roots and path matching.
- Create server/sources/antigravity.ts, copilot.ts, opencode.ts: special discovery and bundle loading.
- Create server/sources/registry.ts: ordered path routing and adapter lookup.
- Create server/sources/fsScan.ts: default text file-tree scan and shared descriptor helpers.
- Modify server/scanner.ts: orchestration plus compatibility exports.

**Scoped rendering**

- Modify src/store/sessionStore.ts: StateScope-aware notifications.
- Modify src/ui/sidebar.ts: SidebarView controller and independently rendered list.
- Modify src/ui/app.ts: shell/sidebar/main region renderers.
- Create tests/render-scope.test.ts: store and DOM identity regressions.

**Documentation**

- Create docs/adding-a-source.md.
- Update docs/architecture-refactor.md execution table with actual commit ids after each phase.

---

### Task 1: Restore the TypeScript Baseline

**Files:**
- Modify: src/ui/app.ts:189-195
- Test: existing npm run typecheck

**Interfaces:**
- Consumes: Session.metadata as Record<string, MetadataValue>.
- Produces: targetSubagentScrollId remains string | undefined.

- [ ] **Step 1: Reproduce the failing check**

Run: npm run typecheck

Expected: FAIL at src/ui/app.ts:194 because MetadataValue is not assignable to string | undefined.

- [ ] **Step 2: Add the smallest type-safe assignment**

Use currentSession.id first and only use metadata.sessionId after a string guard:

~~~ts
const metadataSessionId = currentSession.metadata.sessionId;
this.targetSubagentScrollId =
  currentSession.id ||
  (typeof metadataSessionId === "string" ? metadataSessionId : undefined);
~~~

- [ ] **Step 3: Verify the baseline**

Run: npm run typecheck && npm test

Expected: both commands PASS; test count is at least 155.

- [ ] **Step 4: Commit**

~~~bash
git add src/ui/app.ts
git commit -m "fix: narrow subagent session metadata id"
~~~

---

### Task 2: Add the Frontend Source Registry

**Files:**
- Create: src/sources/types.ts
- Create: src/sources/codex.ts
- Create: src/sources/copilot.ts
- Create: src/sources/claude.ts
- Create: src/sources/opencode.ts
- Create: src/sources/antigravity.ts
- Create: src/sources/gemini.ts
- Create: src/sources/registry.ts
- Create: tests/source-registry.test.ts
- Modify: src/parsers/detect.ts

**Interfaces:**
- Produces: SOURCE_ADAPTERS, getAdapter(id), getSourceLabel(id), SourceAdapter.buildResumeCommand(session, options).
- Preserves: detectSessionSource(bundle) and parseSessionBundle(bundle) public signatures.

- [ ] **Step 1: Write failing registry tests**

Add tests that assert registry order, source lookup, unknown lookup, generic fallback order, and unsafe command behavior:

~~~ts
test("frontend source registry preserves detection priority", () => {
  assert.deepEqual(
    SOURCE_ADAPTERS.map((adapter) => adapter.id),
    ["codex", "copilot", "claude", "opencode", "antigravity", "gemini"]
  );
});

test("registry retains unsafe Codex resume commands", () => {
  const session = makeSession("codex", { sessionId: "session-1" });
  assert.equal(getAdapter("codex")?.buildResumeCommand?.(session), "codex resume session-1");
  assert.equal(
    getAdapter("codex")?.buildResumeCommand?.(session, { unsafe: true }),
    "codex resume session-1 --yolo"
  );
});
~~~

Use a generic Session fixture with empty messages and rawFiles. Add bundles for the three fallbacks: messages object → gemini, generic JSON → opencode, plain text → claude.

- [ ] **Step 2: Verify the new test is red**

Run: node --import tsx --test tests/source-registry.test.ts

Expected: FAIL because src/sources/registry.ts does not exist.

- [ ] **Step 3: Define the contracts**

~~~ts
export interface ResumeCommandOptions {
  unsafe?: boolean;
}

export interface DetectContext {
  combinedPath: string;
  firstContent: string;
  trimmed: string;
}

export interface SourceAdapter {
  id: SessionSource;
  label: string;
  detect(bundle: SessionBundle, context: DetectContext): boolean;
  parse(bundle: SessionBundle): Session;
  buildResumeCommand?(
    session: Session,
    options?: ResumeCommandOptions
  ): string | null;
}
~~~

- [ ] **Step 4: Create all six adapters**

Move each condition from detect.ts without changing literals. Each adapter calls its existing parser. Move the four resume function bodies from src/ui/resumeCommands.ts into the corresponding adapter files and export the named function for focused tests.

Codex detection remains:

~~~ts
detect(_bundle, context) {
  return (
    context.combinedPath.includes(".codex") ||
    context.combinedPath.includes("rollout-") ||
    context.firstContent.includes("\"type\":\"session_meta\"")
  );
}
~~~

Copilot keeps the .copilot, /session-state/, events.jsonl, producer, assistant.turn_start, and tool.execution_start checks. Claude keeps .claude and tool_use. OpenCode keeps opencode, #session.json, modelID, and providerID. Antigravity keeps #chat.jsonl, both Antigravity path forms, session_meta, and cascade_id. Gemini keeps .gemini, functionCall, and functionResponse.

- [ ] **Step 5: Implement the ordered registry**

~~~ts
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  codexAdapter,
  copilotAdapter,
  claudeAdapter,
  opencodeAdapter,
  antigravityAdapter,
  geminiAdapter
];

export function getAdapter(id: SessionSource): SourceAdapter | undefined {
  return SOURCE_ADAPTERS.find((adapter) => adapter.id === id);
}

export function getSourceLabel(id: SessionSource): string {
  return getAdapter(id)?.label ?? id;
}
~~~

Use labels Codex, Copilot, Claude, OpenCode, Antigravity, and Gemini so current copy does not change.

- [ ] **Step 6: Rewrite detect.ts as orchestration**

Build DetectContext once, return the first matching adapter, preserve the three global fallbacks, and replace the parser switch with getAdapter(source)?.parse(bundle). Keep the existing try/catch and buildFallbackSession calls byte-for-byte where practical.

- [ ] **Step 7: Run focused tests**

Run: node --import tsx --test tests/source-registry.test.ts tests/copilot-session.test.ts tests/path-compat.test.ts

Expected: PASS.

---

### Task 3: Move Frontend Consumers to the Registry

**Files:**
- Modify: src/ui/chatView.ts:1-260
- Modify: src/ui/sidebar.ts:187-205
- Modify: tests/resume-command.test.ts
- Delete: src/ui/resumeCommands.ts

**Interfaces:**
- Consumes: getAdapter(session.source), SOURCE_ADAPTERS, SourceAdapter.buildResumeCommand.
- Produces: unchanged Resume dropdown and source-filter copy.

- [ ] **Step 1: Change resume tests to adapter imports**

Import named command builders from src/sources/codex.ts, claude.ts, antigravity.ts, and copilot.ts. Keep all existing assertions, including dynamic copy-button and unsafe dropdown assertions.

- [ ] **Step 2: Make chatView use one adapter**

Replace four source-specific blocks with:

~~~ts
const adapter = session ? getAdapter(session.source) : undefined;
const defaultCommand = adapter?.buildResumeCommand?.(session);
if (defaultCommand) {
  optionsList.push({ label: "Default", command: defaultCommand });
  const unsafeCommand = adapter?.buildResumeCommand?.(session, { unsafe: true });
  if (unsafeCommand && unsafeCommand !== defaultCommand) {
    optionsList.push({ label: "Unsafe", command: unsafeCommand });
  }
}
~~~

This keeps Copilot to one option because its unsafe result is identical.

- [ ] **Step 3: Build sidebar source items from the registry**

~~~ts
const sidebarSourceOrder: SessionSource[] = [
  "codex",
  "claude",
  "opencode",
  "gemini",
  "antigravity",
  "copilot"
];
const sourceItems: DropdownItem[] = [
  { value: "all", label: "All sources" },
  ...sidebarSourceOrder.map((source) => ({
    value: source,
    label: getSourceLabel(source)
  }))
];
~~~

Preserve the existing UI order shown above; detection priority belongs only to SOURCE_ADAPTERS. Assert all six values, labels, and their existing sidebar order.

- [ ] **Step 4: Remove the old module and prove no callers remain**

Run: rg -n "resumeCommands|buildCodexResumeCommand" src tests

Expected: named builders appear only in adapter files/tests; resumeCommands has no matches.

- [ ] **Step 5: Verify and commit phase 3.1**

Run: npm run typecheck && npm test && npm run build

Expected: all PASS.

~~~bash
git add src/sources src/parsers/detect.ts src/ui/chatView.ts src/ui/sidebar.ts tests/source-registry.test.ts tests/resume-command.test.ts
git rm src/ui/resumeCommands.ts
git commit -m "refactor: add frontend source adapter registry"
~~~

---

### Task 4: Add Backend Adapter Contracts and Routing

**Files:**
- Create: server/sources/types.ts
- Create: server/sources/fileSources.ts
- Create: server/sources/registry.ts
- Modify: server/scanner.ts:575-596
- Extend: tests/source-registry.test.ts

**Interfaces:**
- Produces: SERVER_SOURCE_ADAPTERS, getServerAdapter(id), inferRegisteredSource(path).
- Preserves: scanner.inferSourceFromPath(path).

- [ ] **Step 1: Add failing backend order and path tests**

Assert the server order is antigravity, codex, claude, opencode, copilot, gemini so the current inferSourceFromPath if-chain remains exact. Assert Windows-style roots for all sources and unknown fallback.

- [ ] **Step 2: Verify the tests are red**

Run: node --import tsx --test tests/source-registry.test.ts tests/path-compat.test.ts

Expected: FAIL because server/sources/registry.ts does not exist.

- [ ] **Step 3: Define backend contracts**

~~~ts
export interface ScanContext {
  roots: LocalScanRoots;
  remoteRoot: string;
  remoteFiles: readonly string[];
}

export interface ServerSourceAdapter {
  id: SessionSource;
  scanRoots(roots: LocalScanRoots): string[];
  matchPath(absolutePath: string): boolean;
  scan?(context: ScanContext): Promise<SessionDescriptor[]>;
  loadBundle?(key: string): Promise<SessionBundle | undefined>;
}
~~~

- [ ] **Step 4: Implement exact path matchers**

Antigravity uses isAntigravityConversationPath/isAntigravityTranscriptPath before normalized substring checks. The remaining matchers preserve /.codex/ or /rollout-, /.claude/, /opencode, /.copilot/, and /.gemini/.

- [ ] **Step 5: Delegate scanner path inference**

~~~ts
export function inferSourceFromPath(absolutePath: string): SessionSource {
  return inferRegisteredSource(absolutePath);
}
~~~

- [ ] **Step 6: Run focused tests**

Run: node --import tsx --test tests/source-registry.test.ts tests/path-compat.test.ts

Expected: PASS.

---

### Task 5: Extract Backend Scan Implementations

**Files:**
- Create: server/sources/fsScan.ts
- Create: server/sources/antigravity.ts
- Create: server/sources/copilot.ts
- Create: server/sources/opencode.ts
- Modify: server/sources/registry.ts
- Modify: server/scanner.ts:1-869
- Test: tests/scanner-mtime-slice.test.ts
- Test: tests/opencode-sqlite.test.ts
- Test: tests/copilot-session.test.ts
- Test: tests/antigravity-title.test.ts

**Interfaces:**
- Produces: scanDefaultFileTree(root, source, origin, precollectedFiles), adapter scan/load methods.
- Preserves public exports: scanLocalSessions, loadLocalSessionBundle, inferSourceFromPath.

- [ ] **Step 1: Export and preserve current scanner behavior in focused tests**

Keep scanner-mtime-slice as the contract for mtime-before-slice and parent recovery. Add one routing assertion per special key prefix: copilot-dir::, opencode-sqlite::, and file:: Antigravity.

- [ ] **Step 2: Move default file scanning**

Move MAX_FILES_PER_SOURCE, collectFiles, exists, isSessionLikeFile, shouldIncludeScannedFile, buildFileDescriptor, readTextFileIfPossible, and the complete parent-recovery loop into fsScan.ts. Rename the internal implementation to scanDefaultFileTree; scanner.ts imports it for orchestration.

- [ ] **Step 3: Move Antigravity ownership**

Move loadAntigravityHistoryMap, scanAntigravitySessions, preferAntigravityPath, and Antigravity load routing into server/sources/antigravity.ts. Keep descriptor construction delegated to server/antigravity.ts exports.

- [ ] **Step 4: Move Copilot ownership**

Move COPILOT_DIR_KEY_PREFIX, both directory scan functions, loadCopilotBundle, buildCopilotDescriptor, YAML parsing, workspace reading, title inference, and mtime inference into server/sources/copilot.ts. Keep COPILOT_BUNDLE_FILES and COPILOT_EVENTS_FILE in server/copilot.ts.

- [ ] **Step 5: Move OpenCode ownership**

Move the SQLite row interfaces, MAX_OPENCODE_SESSIONS, both database scan functions, loadOpenCodeBundle, buildOpenCodeDescriptor, SqliteParameter, and querySqlite into server/sources/opencode.ts. Keep read-only DatabaseSync construction and catch-to-empty scan behavior unchanged.

- [ ] **Step 6: Reduce scanner.ts to orchestration**

Resolve roots and remote files once. Run default local roots, default remote scan, and every special adapter scan concurrently. Flatten results and call the unchanged dedupe/sort helper.

For bundle loading, ask key-owning special adapters first. If none returns a bundle, enforce file:: and use default raw-text loading. Unsupported keys still throw "Unsupported session key."

- [ ] **Step 7: Preserve SSH scope**

Do not migrate server/ssh.ts or server/remote.ts. Add only the requested future-unification comment beside their hardcoded source discovery tables.

- [ ] **Step 8: Verify and commit phase 3.2**

Run: npm run typecheck && npm test && npm run build

Expected: all PASS; scanner, OpenCode, Copilot, Antigravity, and path tests remain green.

~~~bash
git add server/sources server/scanner.ts server/ssh.ts server/remote.ts tests/source-registry.test.ts tests/scanner-mtime-slice.test.ts tests/opencode-sqlite.test.ts tests/copilot-session.test.ts tests/antigravity-title.test.ts
git commit -m "refactor: add backend source adapter registry"
~~~

---

### Task 6: Document Adding a Source

**Files:**
- Create: docs/adding-a-source.md
- Modify: src/AGENTS.md
- Modify: docs/architecture-refactor.md

**Interfaces:**
- Documents the actual frontend/backend registry entry points created above.

- [ ] **Step 1: Write the five-step guide**

Document: add SessionSource value in shared/types.ts; create parser; create/register frontend adapter; optionally create/register backend adapter; add parser, detection, scanning, and fallback tests. Include the fixed detection-order warning and state that SSH discovery remains separate.

- [ ] **Step 2: Link the guide from src/AGENTS.md**

Add one sentence under parser/source guidance pointing to docs/adding-a-source.md.

- [ ] **Step 3: Fill phase 1–3 execution records**

Record existing commits 2d5a074, 23be0c1, bbaf4db, d915fdb and the new phase 3 commit ids. Record the unsafe-resume signature extension as the only phase 3 deviation.

- [ ] **Step 4: Verify and commit**

Run: npm run typecheck && npm test && npm run build

Expected: all PASS.

~~~bash
git add docs/adding-a-source.md docs/architecture-refactor.md src/AGENTS.md
git commit -m "docs: explain source adapter extension flow"
~~~

---

### Task 7: Add StateScope Notifications

**Files:**
- Modify: src/store/sessionStore.ts
- Create: tests/render-scope.test.ts

**Interfaces:**
- Produces: export type StateScope = "sidebar" | "session" | "all".
- Changes listener signature to (state: StoreState, scope: StateScope) => void.

- [ ] **Step 1: Write failing scope tests**

Subscribe after constructing SessionStore, discard the initial all event, call setSearch and expect sidebar, call setSourceFilter and expect sidebar, call togglePin and expect all, and call selectSession for an imported bundle and expect all.

- [ ] **Step 2: Verify the test is red**

Run: node --import tsx --test tests/render-scope.test.ts

Expected: FAIL because listeners receive no scope.

- [ ] **Step 3: Add the scope contract**

~~~ts
export type StateScope = "sidebar" | "session" | "all";
type Listener = (state: StoreState, scope: StateScope) => void;

private updateState(partial: Partial<StoreState>, scope: StateScope): void {
  this.state = { ...this.state, ...partial };
  for (const listener of this.listeners) {
    listener(this.getState(), scope);
  }
}
~~~

Initial subscribe calls listener(getState(), "all").

- [ ] **Step 4: Audit all 17 call sites**

Use sidebar for search, sourceFilter, expandedSessionKeys, show/clear hidden projects. Use all for pin, favorite, favorite metadata, scans, selection/loading/session results, imports, and hideProject when it may change selectedKey. Use session for the history-only previousKeys update before goBack selection. No updateState call may omit scope.

- [ ] **Step 5: Run store tests**

Run: node --import tsx --test tests/render-scope.test.ts tests/session-store.test.ts

Expected: PASS.

---

### Task 8: Make Sidebar Controls Persistent

**Files:**
- Modify: src/ui/sidebar.ts
- Modify: tests/sidebar.test.ts

**Interfaces:**
- Produces: SidebarView with element and update(options).
- Preserves: renderSidebar(options): HTMLElement.

- [ ] **Step 1: Add a failing stable-control test**

Create a SidebarView, capture its search input and .session-list, call update with new search/descriptors, then assert the same search node and list node remain connected while list children and count badge update.

- [ ] **Step 2: Verify the test is red**

Run: node --import tsx --test tests/sidebar.test.ts

Expected: FAIL because createSidebarView is not exported.

- [ ] **Step 3: Add the controller**

~~~ts
export interface SidebarView {
  element: HTMLElement;
  update(options: SidebarOptions): void;
}

export function renderSidebar(options: SidebarOptions): HTMLElement {
  return createSidebarView(options).element;
}
~~~

createSidebarView stores currentOptions in a mutable closure. All event handlers read currentOptions at event time. update changes dock/open/pin classes, button titles, count, search value only when different, dropdown selection, quick chips, and session-list children.

- [ ] **Step 4: Extract list rendering**

Move the existing descriptor/tree rendering block into renderSessionList(list, options). It must replace list children before rendering, keep the 200-row cap, preserve Show full history behavior, and leave the list element itself stable.

- [ ] **Step 5: Make dropdown controlled**

Return a CustomDropdown controller with element and updateSelectedValue(value). Its item click updates its internal selected value before calling onChange, and update refreshes trigger copy plus active item classes.

- [ ] **Step 6: Run sidebar tests**

Run: node --import tsx --test tests/sidebar.test.ts

Expected: PASS, including existing hover/focus/dropdown/tree tests and the new node identity test.

---

### Task 9: Split ThreadAtlasApp Rendering

**Files:**
- Modify: src/ui/app.ts
- Extend: tests/render-scope.test.ts

**Interfaces:**
- Consumes: StateScope and createSidebarView.
- Produces: renderShellState, renderSidebarRegion, renderMainRegion private methods.

- [ ] **Step 1: Add the failing main identity test**

Instantiate ThreadAtlasApp with a SessionStore and DOM mock, capture .main-mount firstElementChild, call store.setSearch("needle"), and assert strict identity with the original firstElementChild. Then select an imported session and assert the main child changes.

- [ ] **Step 2: Verify the test is red**

Run: node --import tsx --test tests/render-scope.test.ts

Expected: FAIL because the current subscription always replaces mainMount children.

- [ ] **Step 3: Route subscriptions by scope**

~~~ts
this.store.subscribe((state, scope) => {
  this.renderShellState(state);
  if (scope !== "session") {
    this.renderSidebarRegion(state);
  }
  if (scope !== "sidebar") {
    this.renderMainRegion(state);
  }
});
~~~

- [ ] **Step 4: Split the current render body**

renderShellState owns app-shell classes and status text/title. renderSidebarRegion lazily creates one SidebarView and calls update thereafter. renderMainRegion calls cleanupMermaid and replaces mainMount with renderChatView.

- [ ] **Step 5: Narrow local UI updates**

Sidebar open/pin changes update shell plus sidebar. Timeline open/pin and message filter changes update shell plus main. Viewport changes update all three. Theme controls stay independent.

- [ ] **Step 6: Remove obsolete workarounds**

Delete active search focus/selection capture and restore, captureSidebarScroll, restoreSidebarScroll, sidebarScrollTop, and the copied status special case if no test requires it. Keep chat scroll restoration and subagent target scrolling.

- [ ] **Step 7: Run scoped rendering tests**

Run: node --import tsx --test tests/render-scope.test.ts tests/sidebar.test.ts tests/chat-view-scroll.test.ts tests/subagent-notification.test.ts

Expected: PASS.

- [ ] **Step 8: Verify and commit phase 4**

Run: npm run typecheck && npm test && npm run build

Expected: all PASS and test count exceeds the original 155.

~~~bash
git add src/store/sessionStore.ts src/ui/sidebar.ts src/ui/app.ts tests/render-scope.test.ts tests/sidebar.test.ts
git commit -m "refactor: scope store-driven UI rendering"
~~~

---

### Task 10: Browser Regression and Final Records

**Files:**
- Modify: docs/architecture-refactor.md

**Interfaces:**
- Produces the completed execution record for phases 3 and 4.

- [ ] **Step 1: Start the application**

Run the backend and Vite dev server using the repository scripts. Open the local application in the in-app browser.

- [ ] **Step 2: Verify sidebar-only behavior**

Type continuously in search, move the caret into the middle, continue typing, switch source filters, expand subagent trees, hide/restore a workspace, and confirm the chat DOM remains the same node.

- [ ] **Step 3: Verify cross-region behavior**

Switch sessions; toggle pin/favorite; edit favorite tags; use history Back and subagent backlinks; verify chat header and sidebar update together.

- [ ] **Step 4: Verify chat-local behavior**

Change message filters, open/pin timeline, inspect Mermaid content, use Default/Unsafe resume options, export JSON/MD, and confirm scroll restoration.

- [ ] **Step 5: Verify shell and modal behavior**

Exercise Rescan local, Import files, SSH sync opening, Connections opening, Escape close, theme toggle, sidebar/timeline hover/pin, and responsive widths around 960 and 1200 pixels.

- [ ] **Step 6: Fill the phase 4 execution record**

Record the phase 4 commit and any implementation deviation. Do not mark manual checks complete unless performed.

- [ ] **Step 7: Run final verification**

Run: npm run typecheck && npm test && npm run build

Expected: all PASS with no new warnings beyond existing KaTeX, Mermaid chunking, and Vite chunk-size warnings.

- [ ] **Step 8: Commit final records**

~~~bash
git add docs/architecture-refactor.md
git commit -m "docs: record architecture refactor completion"
~~~
