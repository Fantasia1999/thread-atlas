import type { Session } from "../parsers/types.js";
import { SessionStore, type StoreState } from "../store/sessionStore.js";
import { createImportModal } from "./importModal.js";
import { renderSidebar } from "./sidebar.js";
import { type MessageViewFilter, renderChatView } from "./chatView.js";
import { createSshModal } from "./sshModal.js";
import { createConnectionModal } from "./connectionModal.js";
import { showToast, copyText } from "./utils.js";

type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "thread-atlas-theme";
const SIDEBAR_PIN_STORAGE_KEY = "thread-atlas-sidebar-pinned";
const TIMELINE_PIN_STORAGE_KEY = "thread-atlas-timeline-pinned";
const MESSAGE_FILTER_STORAGE_KEY = "thread-atlas-message-filter";

export class ThreadAtlasApp {
  private readonly shell: HTMLElement;
  private readonly sidebarMount: HTMLElement;
  private readonly mainMount: HTMLElement;
  private readonly statusNode: HTMLElement;
  private readonly modalMount: HTMLElement;
  private readonly themeControls: HTMLElement;
  private messageFilter: MessageViewFilter = (() => {
    const val = localStorage.getItem(MESSAGE_FILTER_STORAGE_KEY);
    if (val === "default" || val === "not-tool" || val === "user" || val === "answer") {
      return val;
    }
    return "default";
  })();
  private theme: AppTheme = getInitialTheme();
  private sidebarPinned = getStoredBoolean(SIDEBAR_PIN_STORAGE_KEY, true);
  private sidebarOpen = false;
  private timelinePinned = getStoredBoolean(TIMELINE_PIN_STORAGE_KEY, window.innerWidth >= 1200);
  private timelineOpen = false;
  private viewportWidth = window.innerWidth;
  private sidebarScrollTop = 0;
  private chatMessagesScrollTop = 0;
  private lastSelectedKey?: string;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: SessionStore
  ) {
    this.shell = document.createElement("div");
    this.shell.className = "app-shell";

    const topbar = document.createElement("header");
    topbar.className = "topbar";

    const brand = document.createElement("div");
    brand.className = "brand-block";
    brand.innerHTML = `
      <p class="eyebrow">AI Session Browser</p>
      <h1>ThreadAtlas</h1>
    `;

    const actions = document.createElement("div");
    actions.className = "topbar-actions";

    this.themeControls = document.createElement("div");
    this.themeControls.className = "theme-toggle";
    actions.append(this.themeControls);

    const scanButton = this.makeButton("Rescan local", async () => {
      await this.store.refreshLocalScan();
    });
    const importButton = this.makeButton("Import files", () => {
      this.openImportModal();
    });
    const sshButton = this.makeButton("SSH sync", () => {
      this.openSshModal();
    });
    const connectionsButton = this.makeButton("Connections", () => {
      this.openConnectionModal();
    });
    actions.append(scanButton, importButton, sshButton, connectionsButton);

    this.statusNode = document.createElement("div");
    this.statusNode.className = "status-pill";
    this.statusNode.addEventListener("dblclick", async () => {
      const textToCopy = this.statusNode.getAttribute("data-path") || this.statusNode.textContent || "";
      if (!textToCopy) return;

      try {
        await copyText(textToCopy);
        this.statusNode.classList.add("copied");
        this.statusNode.textContent = "Copied! ✓";
        this.statusNode.title = "Successfully copied to clipboard";
        showToast("Path copied to clipboard!", "success");
        
        setTimeout(() => {
          this.statusNode.classList.remove("copied");
          const latestPath = this.statusNode.getAttribute("data-path") || "";
          this.statusNode.textContent = latestPath;
          this.statusNode.title = "Double-click to copy absolute path\n" + latestPath;
        }, 1200);
      } catch (error) {
        showToast("Failed to copy path.", "error");
      }
    });

    const rightRail = document.createElement("div");
    rightRail.className = "topbar-side";
    rightRail.append(actions);

    topbar.append(brand, this.statusNode, rightRail);

    const content = document.createElement("div");
    content.className = "content-grid";

    this.sidebarMount = document.createElement("div");
    this.mainMount = document.createElement("div");
    this.mainMount.className = "main-mount";
    this.sidebarMount.className = "sidebar-mount";

    content.append(this.sidebarMount, this.mainMount);

    this.modalMount = document.createElement("div");

    this.shell.append(topbar, content, this.modalMount);
    this.root.replaceChildren(this.shell);
    this.applyTheme();
    this.renderThemeControls();

    this.store.subscribe((state) => {
      this.render(state);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      let changed = false;
      if (!this.isSidebarPinned() && this.sidebarOpen) {
        this.sidebarOpen = false;
        changed = true;
      }
      if (!this.isTimelinePinned() && this.timelineOpen) {
        this.timelineOpen = false;
        changed = true;
      }
      if (changed) {
        this.render(this.store.getState());
      }
    });

    window.addEventListener("resize", () => {
      const nextWidth = window.innerWidth;
      if (nextWidth === this.viewportWidth) {
        return;
      }
      this.viewportWidth = nextWidth;
      this.render(this.store.getState());
    });
  }

  async init(): Promise<void> {
    await this.store.getConnection().reconcileRemotes();
    await this.store.refreshLocalScan();
  }

  private render(state: StoreState): void {
    this.captureSidebarScroll();
    this.captureChatMessagesScroll(state);

    const sidebarPinned = this.isSidebarPinned();
    const timelinePinned = this.isTimelinePinned();
    const sidebarOpen = sidebarPinned || this.sidebarOpen;
    const timelineOpen = timelinePinned || this.timelineOpen;

    this.shell.classList.toggle("sidebar-pinned", sidebarPinned);
    this.shell.classList.toggle("sidebar-open", this.sidebarOpen);
    this.shell.classList.toggle("timeline-pinned", timelinePinned);
    this.shell.classList.toggle("timeline-open", this.timelineOpen);

    const selectedDescriptor = this.store.getSelectedDescriptor();
    const currentPath = selectedDescriptor ? selectedDescriptor.primaryPath : state.status;
    this.statusNode.setAttribute("data-path", currentPath);

    if (!this.statusNode.classList.contains("copied")) {
      this.statusNode.textContent = currentPath;
      this.statusNode.title = selectedDescriptor 
        ? "Double-click to copy absolute path\n" + currentPath 
        : currentPath;
    }

    const visibleDescriptors = this.store.getVisibleDescriptors();
    const selectedSession = this.store.getSelectedSession();
    // Record search focus and selection to prevent losing focus during keystrokes
    const activeEl = document.activeElement as HTMLInputElement | null;
    const isSearchActive = activeEl && activeEl.type === "search" && activeEl.className?.includes("text-input");
    const selectionStart = isSearchActive ? activeEl.selectionStart : null;
    const selectionEnd = isSearchActive ? activeEl.selectionEnd : null;

    this.sidebarMount.replaceChildren(
      renderSidebar({
        descriptors: visibleDescriptors,
        selectedKey: state.selectedKey,
        sourceFilter: state.sourceFilter,
        search: state.search,
        loading: state.loadingScan,
        pinned: sidebarPinned,
        open: sidebarOpen,
        pinnedKeys: state.pinnedKeys,
        favoriteKeys: state.favoriteKeys,
        favoriteMetadata: state.favoriteMetadata,
        onTogglePinSession: (key) => {
          this.store.togglePin(key);
        },
        onToggleFavoriteSession: (key) => {
          this.store.toggleFavorite(key);
        },
        onToggleOpen: () => {
          this.toggleSidebarOpen();
        },
        onTogglePin: () => {
          this.toggleSidebarPin();
        },
        onSearch: (value) => {
          this.store.setSearch(value);
        },
        onFilter: (value) => {
          this.store.setSourceFilter(value);
        },
        onSelect: async (key) => {
          await this.store.selectSession(key);
          if (!this.isSidebarPinned()) {
            this.toggleSidebarOpen(false);
          }
        }
      })
    );

    // Restore focus and selection
    if (isSearchActive) {
      const newSearch = this.sidebarMount.querySelector("input[type='search']") as HTMLInputElement | null;
      if (newSearch) {
        newSearch.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          newSearch.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }

    this.restoreSidebarScroll();

    this.mainMount.replaceChildren(
      renderChatView({
        descriptor: selectedDescriptor,
        session: selectedSession,
        loading: state.loadingSession,
        messageFilter: this.messageFilter,
        timelinePinned,
        timelineOpen,
        pinnedKeys: state.pinnedKeys,
        favoriteKeys: state.favoriteKeys,
        favoriteMetadata: state.favoriteMetadata,
        onTogglePinSession: (key) => {
          this.store.togglePin(key);
        },
        onToggleFavoriteSession: (key) => {
          this.store.toggleFavorite(key);
        },
        onUpdateMetadata: (key, tags, notes) => {
          this.store.updateFavoriteMetadata(key, { tags, notes });
        },
        onFilterChange: (filter) => {
          this.messageFilter = filter;
          localStorage.setItem(MESSAGE_FILTER_STORAGE_KEY, filter);
          this.render(this.store.getState());
        },
        onTimelineToggleOpen: () => {
          this.toggleTimelineOpen();
        },
        onTimelineTogglePin: () => {
          this.toggleTimelinePin();
        },
        onExport: (session) => {
          this.exportSession(session);
        },
        onRenderComplete: () => {
          this.restoreChatMessagesScroll();
        }
      })
    );
  }

  private isSidebarPinned(): boolean {
    return this.sidebarPinned && this.viewportWidth >= 960;
  }

  private isTimelinePinned(): boolean {
    return this.timelinePinned && this.viewportWidth >= 1200;
  }

  private captureSidebarScroll(): void {
    const list = this.sidebarMount.querySelector<HTMLElement>(".session-list");
    if (!list) {
      return;
    }
    this.sidebarScrollTop = list.scrollTop;
  }

  private restoreSidebarScroll(): void {
    const list = this.sidebarMount.querySelector<HTMLElement>(".session-list");
    if (!list) {
      return;
    }

    list.scrollTop = this.sidebarScrollTop;
    list.addEventListener("scroll", () => {
      this.sidebarScrollTop = list.scrollTop;
    });
  }

  private captureChatMessagesScroll(state: StoreState): void {
    const list = this.mainMount.querySelector<HTMLElement>(".chat-messages");
    if (!list) {
      return;
    }

    if (state.selectedKey !== this.lastSelectedKey) {
      this.chatMessagesScrollTop = 0;
      this.lastSelectedKey = state.selectedKey;
    } else {
      this.chatMessagesScrollTop = list.scrollTop;
    }
    console.log("[Scroll] Captured:", this.chatMessagesScrollTop, "for key:", state.selectedKey);
  }

  private restoreChatMessagesScroll(): void {
    const list = this.mainMount.querySelector<HTMLElement>(".chat-messages");
    if (!list) {
      return;
    }

    list.scrollTop = this.chatMessagesScrollTop;
    console.log("[Scroll] Restoring to:", this.chatMessagesScrollTop, "actual list scrollTop:", list.scrollTop);
    list.addEventListener("scroll", () => {
      this.chatMessagesScrollTop = list.scrollTop;
    });
  }

  private toggleSidebarOpen(force?: boolean): void {
    this.sidebarOpen = force !== undefined ? force : !this.sidebarOpen;
    const isPinned = this.isSidebarPinned();
    const open = isPinned || this.sidebarOpen;

    // 1. Toggle class on shell
    this.shell.classList.toggle("sidebar-open", this.sidebarOpen);

    // 2. Toggle class on sidebar-dock
    const dock = this.sidebarMount.querySelector(".sidebar-dock");
    if (dock) {
      dock.classList.toggle("open", open);
    }

    // 3. Update sidebar rail button title / aria-label
    const toggleBtn = this.sidebarMount.querySelector(".sidebar-rail .rail-button") as HTMLButtonElement | null;
    if (toggleBtn) {
      const nextTitle = open ? "Collapse sessions" : "Open sessions";
      toggleBtn.title = nextTitle;
      toggleBtn.setAttribute("aria-label", nextTitle);
    }
  }

  private toggleSidebarPin(): void {
    const nextPinned = !this.sidebarPinned;
    this.sidebarPinned = nextPinned;
    this.sidebarOpen = !nextPinned;
    localStorage.setItem(SIDEBAR_PIN_STORAGE_KEY, String(this.sidebarPinned));

    const isPinned = this.isSidebarPinned();
    const open = isPinned || this.sidebarOpen;

    // 1. Toggle classes on shell
    this.shell.classList.toggle("sidebar-pinned", isPinned);
    this.shell.classList.toggle("sidebar-open", this.sidebarOpen);

    // 2. Toggle classes on sidebar-dock
    const dock = this.sidebarMount.querySelector(".sidebar-dock");
    if (dock) {
      dock.classList.toggle("pinned", isPinned);
      dock.classList.toggle("open", open);
    }

    // 3. Update pin button active class & title / aria-label
    const pinBtn = this.sidebarMount.querySelector(".panel-header-actions .panel-icon-button") as HTMLButtonElement | null;
    if (pinBtn) {
      pinBtn.classList.toggle("active", isPinned);
      const nextTitle = isPinned ? "Unpin sessions" : "Pin sessions";
      pinBtn.title = nextTitle;
      pinBtn.setAttribute("aria-label", nextTitle);
    }

    // 4. Update sidebar rail button title / aria-label
    const toggleBtn = this.sidebarMount.querySelector(".sidebar-rail .rail-button") as HTMLButtonElement | null;
    if (toggleBtn) {
      const nextTitle = open ? "Collapse sessions" : "Open sessions";
      toggleBtn.title = nextTitle;
      toggleBtn.setAttribute("aria-label", nextTitle);
    }
  }

  private toggleTimelineOpen(force?: boolean): void {
    this.timelineOpen = force !== undefined ? force : !this.timelineOpen;
    const isPinned = this.isTimelinePinned();
    const open = isPinned || this.timelineOpen;

    // 1. Toggle class on shell
    this.shell.classList.toggle("timeline-open", open);

    // 2. Toggle class on main-panel
    const mainPanel = this.mainMount.querySelector(".main-panel");
    if (mainPanel) {
      mainPanel.classList.toggle("timeline-open", open);
    }

    // 3. Toggle class on timeline-dock
    const dock = this.mainMount.querySelector(".timeline-dock");
    if (dock) {
      dock.classList.toggle("open", open);
    }

    // 4. Update timelineToggle title / aria-label
    const toggleBtn = this.mainMount.querySelector(".timeline-rail .rail-button") as HTMLButtonElement | null;
    if (toggleBtn) {
      const nextTitle = open ? "Collapse timeline" : "Open timeline";
      toggleBtn.title = nextTitle;
      toggleBtn.setAttribute("aria-label", nextTitle);
    }
  }

  private toggleTimelinePin(): void {
    const nextPinned = !this.timelinePinned;
    this.timelinePinned = nextPinned;
    this.timelineOpen = !nextPinned;
    localStorage.setItem(TIMELINE_PIN_STORAGE_KEY, String(this.timelinePinned));

    const isPinned = this.isTimelinePinned();
    const open = isPinned || this.timelineOpen;

    // 1. Toggle classes on shell
    this.shell.classList.toggle("timeline-pinned", isPinned);
    this.shell.classList.toggle("timeline-open", open);

    // 2. Toggle classes on main-panel
    const mainPanel = this.mainMount.querySelector(".main-panel");
    if (mainPanel) {
      mainPanel.classList.toggle("timeline-pinned", isPinned);
      mainPanel.classList.toggle("timeline-open", open);
    }

    // 3. Toggle classes on timeline-dock
    const dock = this.mainMount.querySelector(".timeline-dock");
    if (dock) {
      dock.classList.toggle("pinned", isPinned);
      dock.classList.toggle("open", open);
    }

    // 4. Update pin button
    const pinBtn = this.mainMount.querySelector(".timeline-header .panel-icon-button") as HTMLButtonElement | null;
    if (pinBtn) {
      pinBtn.classList.toggle("active", isPinned);
      const nextTitle = isPinned ? "Unpin timeline" : "Pin timeline";
      pinBtn.title = nextTitle;
      pinBtn.setAttribute("aria-label", nextTitle);
    }

    // 5. Update toggle button
    const toggleBtn = this.mainMount.querySelector(".timeline-rail .rail-button") as HTMLButtonElement | null;
    if (toggleBtn) {
      const nextTitle = open ? "Collapse timeline" : "Open timeline";
      toggleBtn.title = nextTitle;
      toggleBtn.setAttribute("aria-label", nextTitle);
    }
  }

  private openImportModal(): void {
    this.modalMount.replaceChildren(
      createImportModal({
        onClose: () => {
          this.modalMount.replaceChildren();
        },
        onImport: (bundles) => {
          this.store.importBundles(bundles);
        }
      })
    );
  }

  private openSshModal(): void {
    this.modalMount.replaceChildren(
      createSshModal({
        authHeaders: this.store.getConnection().authHeaders(),
        onClose: () => {
          this.modalMount.replaceChildren();
        },
        onSynced: async () => {
          await this.store.refreshLocalScan();
        }
      })
    );
  }

  private openConnectionModal(): void {
    this.modalMount.replaceChildren(
      createConnectionModal({
        connection: this.store.getConnection(),
        onClose: () => {
          this.modalMount.replaceChildren();
        },
        onChanged: async () => {
          await this.store.refreshLocalScan();
        }
      })
    );
  }

  private exportSession(session: Session): void {
    const blob = new Blob([JSON.stringify(session, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${session.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private makeButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      void onClick();
    });
    return button;
  }

  private renderThemeControls(): void {
    this.themeControls.replaceChildren();

    const lightButton = this.makeThemeButton("Light", "light");
    const darkButton = this.makeThemeButton("Dark", "dark");

    this.themeControls.append(lightButton, darkButton);
  }

  private makeThemeButton(label: string, theme: AppTheme): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `theme-toggle-button${this.theme === theme ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      if (this.theme === theme) {
        return;
      }

      this.theme = theme;
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      this.applyTheme();
      this.renderThemeControls();
    });
    return button;
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
  }
}

function getInitialTheme(): AppTheme {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredBoolean(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}
