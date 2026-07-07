import type { Session } from "../../shared/types.js";
import { SessionStore, type StoreState } from "../store/sessionStore.js";
import { createImportModal } from "./importModal.js";
import { renderSidebar } from "./sidebar.js";
import { renderChatView } from "./chatView.js";
import type { MessageViewFilter } from "./messageFilter.js";
import { createSshModal } from "./sshModal.js";
import { createConnectionModal } from "./connectionModal.js";
import { createExportMdModal } from "./exportMdModal.js";
import { createFilePreviewModal, parseFileLink, isSupportedPreview } from "./filePreviewModal.js";
import { showToast, copyText } from "./utils.js";
import { cleanupMermaid } from "./mermaidRender.js";

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
    if (val === "raw" || val === "not-tool" || val === "pure" || val === "user" || val === "answer") {
      return val;
    }
    return "pure";
  })();
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

      // Check if any modal is open in the mount, and trigger its close flow gracefully
      if (this.modalMount.childNodes.length > 0) {
        const topModal = this.modalMount.lastChild as HTMLElement | null;
        if (topModal) {
          const closeBtn = topModal.querySelector(".ghost, .button") as HTMLButtonElement | null;
          if (closeBtn) {
            closeBtn.click();
            event.preventDefault();
            return;
          }
        }
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

    let clickTimeout: any = null;

    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.md-link") as HTMLAnchorElement | null;
      if (link) {
        const href = link.getAttribute("href") || "";
        if (href.startsWith("session://")) {
          event.preventDefault();
          const targetSessionId = href.slice(10);
          const state = this.store.getState();
          const targetDescriptor = state.descriptors.find(
            d => d.metadata?.sessionId === targetSessionId || d.key === targetSessionId
          );
          if (targetDescriptor) {
            void this.store.selectSession(targetDescriptor.key);
            showToast("Switched to subagent session", "success");
          } else {
            showToast("Subagent session is not loaded in workspace", "error");
          }
          return;
        }
        const isWebLink = href.startsWith("http://") || href.startsWith("https://");
        const isAnchorOnly = href.startsWith("#");
        if (href && !isWebLink && !isAnchorOnly) {
          const { filePath, lineNumber } = parseFileLink(href);
          if (isSupportedPreview(filePath, lineNumber)) {
            event.preventDefault();
            const modalOverlay = target.closest(".modal-overlay") as HTMLElement | null;
            const inheritedApiBase = modalOverlay?.getAttribute("data-api-base") || undefined;
            this.openFilePreviewModal(href, inheritedApiBase);
          } else {
            event.preventDefault();
            if (clickTimeout) {
              clearTimeout(clickTimeout);
              clickTimeout = null;
            }
            clickTimeout = setTimeout(() => {
              const textToCopy = link.textContent || "";
              copyText(textToCopy)
                .then(() => {
                  showToast(`Copied text: "${textToCopy}"`, "success");
                })
                .catch(() => {
                  showToast("Failed to copy text.", "error");
                });
              clickTimeout = null;
            }, 250);
          }
        }
      }
    });

    this.root.addEventListener("mouseover", (event) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.md-link") as HTMLAnchorElement | null;
      if (link && !link.getAttribute("title")) {
        const href = link.getAttribute("href") || "";
        const isWebLink = href.startsWith("http://") || href.startsWith("https://");
        const isAnchorOnly = href.startsWith("#");
        if (href && !isWebLink && !isAnchorOnly) {
          const { filePath, lineNumber } = parseFileLink(href);
          if (!isSupportedPreview(filePath, lineNumber)) {
            link.setAttribute("title", "Click to copy text, double-click to copy path");
          }
        }
      }
    });

    this.root.addEventListener("dblclick", (event) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.md-link") as HTMLAnchorElement | null;
      if (link) {
        const href = link.getAttribute("href") || "";
        const isWebLink = href.startsWith("http://") || href.startsWith("https://");
        const isAnchorOnly = href.startsWith("#");
        if (href && !isWebLink && !isAnchorOnly) {
          const { filePath, lineNumber } = parseFileLink(href);
          if (!isSupportedPreview(filePath, lineNumber)) {
            event.preventDefault();
            if (clickTimeout) {
              clearTimeout(clickTimeout);
              clickTimeout = null;
            }
            let cleanPath = filePath;
            if (cleanPath.startsWith("file:///")) {
              try {
                const url = new URL(cleanPath);
                cleanPath = decodeURIComponent(url.pathname);
                if (/^\/[a-zA-Z]:[/\\]/.test(cleanPath)) {
                  cleanPath = cleanPath.slice(1);
                }
              } catch {
                cleanPath = decodeURIComponent(cleanPath.slice(8));
              }
            } else if (cleanPath.startsWith("file://")) {
              cleanPath = decodeURIComponent(cleanPath.slice(7));
            } else {
              cleanPath = decodeURIComponent(cleanPath);
            }
            const displayAddress = lineNumber !== undefined ? `${cleanPath}:${lineNumber}` : cleanPath;
            copyText(displayAddress)
              .then(() => {
                showToast(`Copied address: "${displayAddress}"`, "success");
              })
              .catch(() => {
                showToast("Failed to copy address.", "error");
              });
          }
        }
      }
    });
  }

  async init(): Promise<void> {
    await Promise.all([
      this.store.getConnection().reconcileRemotes(),
      this.store.refreshLocalScan()
    ]);
  }

  private render(state: StoreState): void {
    this.captureSidebarScroll();

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
        hiddenProjects: state.hiddenProjects,
        expandedSessionKeys: state.expandedSessionKeys,
        onTogglePinSession: (key) => {
          this.store.togglePin(key);
        },
        onToggleFavoriteSession: (key) => {
          this.store.toggleFavorite(key);
        },
        onToggleSessionCollapse: (key) => {
          this.store.toggleSessionCollapse(key);
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
        },
        onHideProject: (wsPath) => {
          this.store.hideProject(wsPath);
          showToast(`Workspace hidden: ${wsPath}`, "success");
        },
        onShowProject: (wsPath) => {
          this.store.showProject(wsPath);
          showToast(`Workspace restored: ${wsPath}`, "success");
        },
        onClearHiddenProjects: () => {
          this.store.clearHiddenProjects();
          showToast("All hidden workspaces restored", "success");
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

    void cleanupMermaid();

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
        onExport: (session, format) => {
          if (format === "json") {
            this.exportSession(session);
          } else {
            this.openExportMdModal(session);
          }
        },
        onRenderComplete: () => {
          setTimeout(() => this.restoreChatMessagesScroll(), 0);
        },
        previousKeys: state.previousKeys,
        onGoBack: () => {
          this.store.goBack();
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

  private restoreChatMessagesScroll(): void {
    const list = this.mainMount.querySelector<HTMLElement>(".chat-messages");
    if (!list || !list.isConnected) {
      // If the list is not in the DOM yet or not fully connected (e.g. synchronous render before mount finishes),
      // defer scroll restoration to the next tick when mainMount has been updated.
      setTimeout(() => this.restoreChatMessagesScroll(), 0);
      return;
    }

    const key = this.store.getState().selectedKey;
    if (key) {
      const savedScrollTop = getStoredScrollPosition(key);
      
      // Restore scroll position synchronously before browser paint to prevent any visual jump or flash
      list.scrollTop = savedScrollTop;
      
      // Reveal the container synchronously - it is now perfectly scrolled!
      list.style.opacity = "1";
      
      console.log("[Scroll] Restored synchronously to:", savedScrollTop, "scrollHeight:", list.scrollHeight, "clientHeight:", list.clientHeight, "actual list scrollTop:", list.scrollTop);

      let scrollTimeout: number | undefined;
      list.addEventListener("scroll", () => {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }
        
        // Debounce writes to localStorage to prevent transient scroll events and multi-render races from saving incorrect positions
        scrollTimeout = window.setTimeout(() => {
          const currentKey = this.store.getState().selectedKey;
          if (currentKey) {
            setStoredScrollPosition(currentKey, list.scrollTop);
          }
        }, 150);
      });
    } else {
      list.style.opacity = "1";
    }
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

  private pushModal(createModalFn: (onClose: () => void) => HTMLElement): void {
    const existingCount = this.modalMount.children.length;
    if (existingCount > 0) {
      const topModal = this.modalMount.children[existingCount - 1] as HTMLElement;
      topModal.classList.add("stacked-under");
    }

    const modalElement = createModalFn(() => {
      modalElement.remove();

      const newCount = this.modalMount.children.length;
      if (newCount > 0) {
        const newTopModal = this.modalMount.children[newCount - 1] as HTMLElement;
        newTopModal.classList.remove("stacked-under");
      }
    });

    this.modalMount.append(modalElement);
  }

  private openFilePreviewModal(fileUrlOrPath: string, apiBase?: string): void {
    const { filePath, lineNumber, endLineNumber } = parseFileLink(fileUrlOrPath);
    const selectedKey = this.store.getState().selectedKey || undefined;
    const resolvedApiBase = apiBase || (() => {
      return selectedKey
        ? this.store.getConnection().routeForKey(selectedKey).base
        : undefined;
    })();

    this.pushModal((onClose) =>
      createFilePreviewModal({
        filePath,
        lineNumber,
        endLineNumber,
        connection: this.store.getConnection(),
        apiBase: resolvedApiBase,
        sessionKey: selectedKey,
        onClose
      })
    );
  }

  private openImportModal(): void {
    this.pushModal((onClose) =>
      createImportModal({
        onClose,
        onImport: (bundles) => {
          this.store.importBundles(bundles);
        }
      })
    );
  }

  private openSshModal(): void {
    this.pushModal((onClose) =>
      createSshModal({
        authHeaders: this.store.getConnection().authHeaders(),
        onClose,
        onSynced: async () => {
          await this.store.refreshLocalScan();
        }
      })
    );
  }

  private openConnectionModal(): void {
    this.pushModal((onClose) =>
      createConnectionModal({
        connection: this.store.getConnection(),
        onClose,
        onChanged: async () => {
          await this.store.refreshLocalScan();
        }
      })
    );
  }

  private openExportMdModal(session: Session): void {
    this.pushModal((onClose) =>
      createExportMdModal({
        session,
        onClose,
        onExport: (filename, markdownContent) => {
          onClose();
          
          const blob = new Blob([markdownContent], {
            type: "text/markdown"
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
          URL.revokeObjectURL(url);
          showToast(`Exported to ${filename}`);
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

const SCROLL_POSITIONS_STORAGE_KEY = "thread-atlas-session-scroll-positions";

interface ScrollRecord {
  scrollTop: number;
  lastUsed: number;
}

function getStoredScrollPosition(key: string): number {
  try {
    const val = localStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY);
    if (val) {
      const parsed = JSON.parse(val) as Record<string, ScrollRecord | number>;
      const record = parsed[key];
      if (record !== undefined) {
        let scrollTop = 0;
        if (typeof record === "number") {
          scrollTop = record;
          parsed[key] = { scrollTop, lastUsed: Date.now() };
        } else {
          scrollTop = record.scrollTop;
          record.lastUsed = Date.now();
        }
        localStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify(parsed));
        return scrollTop;
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

function setStoredScrollPosition(key: string, scrollTop: number): void {
  try {
    const val = localStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY);
    const parsed = val ? JSON.parse(val) as Record<string, ScrollRecord | number> : {};
    
    parsed[key] = { scrollTop, lastUsed: Date.now() };
    
    // Evict least recently used entries if total keys exceed 300 to keep localStorage footprint under 20 KB
    const entries = Object.entries(parsed);
    if (entries.length > 300) {
      entries.sort((a, b) => {
        const timeA = typeof a[1] === "number" ? 0 : a[1].lastUsed;
        const timeB = typeof b[1] === "number" ? 0 : b[1].lastUsed;
        return timeA - timeB;
      });
      // Delete the oldest/least recently used entry
      const oldestKey = entries[0][0];
      delete parsed[oldestKey];
    }
    
    localStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}
