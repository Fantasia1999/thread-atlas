# Timeline Hover Flash Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing timeline hover interaction without replacing, hiding, or repositioning the rendered message list.

**Architecture:** Keep timeline state in `ThreadAtlasApp`, but synchronize that presentation state onto the existing main panel and timeline controls instead of calling `renderMainRegion()`. Full main rendering remains reserved for session data and message-filter changes.

**Tech Stack:** TypeScript, browser DOM APIs, Node.js test runner, `tests/dom-mock.ts`, Puppeteer browser verification.

## Global Constraints

- Preserve hover-open at 50ms and leave-close at 80ms.
- Preserve click, pin/unpin, Escape, responsive, scroll and accessibility-label behavior.
- Do not change parser, store, server or API contracts.
- Do not touch the existing untracked `pnpm-lock.yaml` or `pnpm-workspace.yaml` files.
- Browser acceptance uses `npm start -- --host=0.0.0.0` at `http://localhost:3030`.

---

### Task 1: Keep the message view stable across timeline presentation changes

**Files:**
- Modify: `tests/render-scope.test.ts`
- Modify: `src/ui/app.ts`

**Interfaces:**
- Consumes: the existing `.main-panel`, `.chat-messages`, `.timeline-dock`, `.rail-button` and `.panel-icon-button` elements rendered by `renderChatView()`.
- Produces: private `ThreadAtlasApp.syncTimelineRegionState(): void`, which synchronizes timeline classes and accessible labels without replacing children.

- [ ] **Step 1: Add a selected-session test helper and failing hover regression test**

Add this helper and test to `tests/render-scope.test.ts`:

```ts
async function createSelectedApp(): Promise<HTMLElement> {
  const bundle = createImportedBundle();
  const store = new SessionStore();
  store.importBundles([bundle]);
  await store.selectSession(bundle.key);

  const root = document.createElement("div");
  new ThreadAtlasApp(root, store);
  return root;
}

test("timeline hover open and leave close preserve the rendered message view", async () => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1000,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "false");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const timelineToggle = timelineDock?.querySelector(".rail-button") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(timelineDock);
  assert.ok(timelineToggle);

  timelineToggle.dispatchEvent("mouseenter");
  await new Promise((resolve) => setTimeout(resolve, 60));

  const openDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const openToggle = openDock?.querySelector(".rail-button");
  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(openDock?.classList.contains("open"), true);
  assert.equal(openToggle?.getAttribute("title"), "Collapse timeline");

  openDock?.dispatchEvent("mouseleave");
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(root.querySelector(".chat-messages"), messageList);
  const closedDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  assert.equal(closedDock?.classList.contains("open"), false);
  assert.equal(closedDock?.querySelector(".rail-button")?.getAttribute("title"), "Open timeline");
});

test("timeline pinning preserves the rendered message view", async () => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1300,
    writable: true,
    configurable: true
  });
  localStorage.setItem("thread-atlas-timeline-pinned", "false");

  const root = await createSelectedApp();
  const messageList = root.querySelector(".chat-messages");
  const timelineDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const pinButton = timelineDock?.querySelector(".panel-icon-button") as HTMLElement | null;
  assert.ok(messageList);
  assert.ok(pinButton);

  pinButton.click();

  const pinnedDock = root.querySelector(".timeline-dock") as HTMLElement | null;
  const pinnedButton = pinnedDock?.querySelector(".panel-icon-button");
  assert.equal(root.querySelector(".chat-messages"), messageList);
  assert.equal(pinnedDock?.classList.contains("pinned"), true);
  assert.equal(pinnedDock?.classList.contains("open"), true);
  assert.equal(pinnedButton?.classList.contains("active"), true);
  assert.equal(pinnedButton?.getAttribute("title"), "Unpin timeline");
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
node --import tsx --test --test-name-pattern="timeline hover open" tests/render-scope.test.ts
```

Expected: FAIL because the `.chat-messages` reference after hover is a newly rendered element.

- [ ] **Step 3: Implement local timeline state synchronization**

Add this private method to `ThreadAtlasApp` in `src/ui/app.ts`:

```ts
private syncTimelineRegionState(): void {
  const timelinePinned = this.isTimelinePinned();
  const timelineOpen = timelinePinned || this.timelineOpen;
  const mainPanel = this.mainMount.querySelector<HTMLElement>(".main-panel");
  const timelineDock = this.mainMount.querySelector<HTMLElement>(".timeline-dock");
  if (!mainPanel || !timelineDock) {
    return;
  }

  mainPanel.classList.toggle("timeline-pinned", timelinePinned);
  mainPanel.classList.toggle("timeline-open", timelineOpen);
  timelineDock.classList.toggle("pinned", timelinePinned);
  timelineDock.classList.toggle("open", timelineOpen);

  const timelineToggle = timelineDock.querySelector<HTMLButtonElement>(".rail-button");
  const toggleLabel = timelineOpen ? "Collapse timeline" : "Open timeline";
  if (timelineToggle) {
    timelineToggle.title = toggleLabel;
    timelineToggle.setAttribute("aria-label", toggleLabel);
  }

  const timelinePin = timelineDock.querySelector<HTMLButtonElement>(".panel-icon-button");
  const pinLabel = timelinePinned ? "Unpin timeline" : "Pin timeline";
  if (timelinePin) {
    timelinePin.classList.toggle("active", timelinePinned);
    timelinePin.title = pinLabel;
    timelinePin.setAttribute("aria-label", pinLabel);
  }
}
```

Apply it at these state boundaries:

```ts
// Insert immediately after the existing replaceChildren(...) call in renderMainRegion():
this.syncTimelineRegionState();

// In toggleTimelineOpen() and toggleTimelinePin():
this.renderShellState(state);
this.syncTimelineRegionState();

// In the Escape handler when timelineChanged is true:
this.syncTimelineRegionState();

// In the resize handler, replace the full this.render(...) call:
const state = this.store.getState();
this.renderShellState(state);
this.renderSidebarRegion(state);
this.syncTimelineRegionState();
```

Do not remove `.chat-messages { opacity: 0; }`; initial session rendering still needs its existing scroll-restoration guard.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --import tsx --test tests/render-scope.test.ts tests/chat-view-scroll.test.ts tests/sidebar.test.ts
```

Expected: all focused tests PASS, including the new identity assertions.

- [ ] **Step 5: Commit the tested fix**

```bash
git add src/ui/app.ts tests/render-scope.test.ts
git commit -m "fix: preserve messages while toggling timeline"
```

### Task 2: Verify the real 3030 experience and full repository

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the production build served by the existing Express entry point.
- Produces: browser and automated verification evidence for the merged fix.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
python3 -m unittest tests/test_annotate.py
git diff --check
```

Expected: 200 or more TypeScript tests and the Python test pass; typecheck and build exit 0; only the existing Mermaid chunk warnings remain.

- [ ] **Step 2: Start or reuse the user-facing server**

Run when port 3030 is free:

```bash
npm start -- --host=0.0.0.0
```

If the user's existing process already owns port 3030, reuse it after `npm run build`; do not kill it.

- [ ] **Step 3: Repeat the long-session browser diagnostic**

Use request interception to load at least 500 mock messages, then hover `.timeline-dock .rail-button`, wait for open, move outside `.timeline-dock`, and wait for close. Record `.chat-messages` identity, computed opacity and scrollTop before, during and after both transitions.

Expected: the node identity never changes, opacity remains `1`, scrollTop is unchanged, and the dock alone toggles `open`.

- [ ] **Step 4: Confirm repository scope**

Run:

```bash
git status --short --branch
```

Expected: only the user's pre-existing untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain.
