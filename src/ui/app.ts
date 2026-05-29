import type { Session } from "../parsers/types.js";
import { SessionStore, type StoreState } from "../store/sessionStore.js";
import { createImportModal } from "./importModal.js";
import { renderSidebar } from "./sidebar.js";
import { type MessageViewFilter, renderChatView } from "./chatView.js";
import { createSshModal } from "./sshModal.js";
import { showToast, copyText } from "./utils.js";

type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "thread-atlas-theme";
const SIDEBAR_PIN_STORAGE_KEY = "thread-atlas-sidebar-pinned";
const TIMELINE_PIN_STORAGE_KEY = "thread-atlas-timeline-pinned";

export class ThreadAtlasApp {
  private readonly shell: HTMLElement;
  private readonly sidebarMount: HTMLElement;
  private readonly mainMount: HTMLElement;
  private readonly statusNode: HTMLElement;
  private readonly modalMount: HTMLElement;
  private readonly themeControls: HTMLElement;
  private messageFilter: MessageViewFilter = "default";
  private theme: AppTheme = getInitialTheme();
  private sidebarPinned = getStoredBoolean(SIDEBAR_PIN_STORAGE_KEY, true);
  private sidebarOpen = false;
  private timelinePinned = getStoredBoolean(TIMELINE_PIN_STORAGE_KEY, window.innerWidth >= 1200);
  private timelineOpen = false;
  private viewportWidth = window.innerWidth;
  private sidebarScrollTop = 0;

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
    actions.append(scanButton, importButton, sshButton);

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
    await this.store.refreshLocalScan();
  }

  private render(state: StoreState): void {
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
    this.captureSidebarScroll();

    this.sidebarMount.replaceChildren(
      renderSidebar({
        descriptors: visibleDescriptors,
        selectedKey: state.selectedKey,
        sourceFilter: state.sourceFilter,
        search: state.search,
        loading: state.loadingScan,
        pinned: sidebarPinned,
        open: sidebarOpen,
        onToggleOpen: () => {
          this.sidebarOpen = !sidebarOpen;
          this.render(this.store.getState());
        },
        onTogglePin: () => {
          const nextPinned = !this.sidebarPinned;
          this.sidebarPinned = nextPinned;
          this.sidebarOpen = !nextPinned;
          localStorage.setItem(SIDEBAR_PIN_STORAGE_KEY, String(this.sidebarPinned));
          this.render(this.store.getState());
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
            this.sidebarOpen = false;
            this.render(this.store.getState());
          }
        }
      })
    );
    this.restoreSidebarScroll();

    this.mainMount.replaceChildren(
      renderChatView({
        descriptor: selectedDescriptor,
        session: selectedSession,
        loading: state.loadingSession,
        messageFilter: this.messageFilter,
        timelinePinned,
        timelineOpen,
        onFilterChange: (filter) => {
          this.messageFilter = filter;
          this.render(this.store.getState());
        },
        onTimelineToggleOpen: () => {
          this.timelineOpen = !timelineOpen;
          this.render(this.store.getState());
        },
        onTimelineTogglePin: () => {
          const nextPinned = !this.timelinePinned;
          this.timelinePinned = nextPinned;
          this.timelineOpen = !nextPinned;
          localStorage.setItem(TIMELINE_PIN_STORAGE_KEY, String(this.timelinePinned));
          this.render(this.store.getState());
        },
        onExport: (session) => {
          this.exportSession(session);
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
        onClose: () => {
          this.modalMount.replaceChildren();
        },
        onSynced: async () => {
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
