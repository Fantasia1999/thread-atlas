import type { Session } from "../parsers/types.js";
import { SessionStore, type StoreState } from "../store/sessionStore.js";
import { createImportModal } from "./importModal.js";
import { renderSidebar } from "./sidebar.js";
import { type MessageViewFilter, renderChatView } from "./chatView.js";
import { createSshModal } from "./sshModal.js";

type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "thread-atlas-theme";

export class ThreadAtlasApp {
  private readonly shell: HTMLElement;
  private readonly sidebarMount: HTMLElement;
  private readonly mainMount: HTMLElement;
  private readonly statusNode: HTMLElement;
  private readonly modalMount: HTMLElement;
  private readonly themeControls: HTMLElement;
  private messageFilter: MessageViewFilter = "default";
  private theme: AppTheme = getInitialTheme();
  private sidebarScrollTop = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: SessionStore
  ) {
    this.shell = document.createElement("div");
    this.shell.className = "app-shell";

    const topbar = document.createElement("header");
    topbar.className = "topbar";
    topbar.innerHTML = `
      <div class="brand-block">
        <p class="eyebrow">AI Session Browser</p>
        <h1>ThreadAtlas</h1>
        <span class="brand-repo-chip">github-style</span>
      </div>
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

    const rightRail = document.createElement("div");
    rightRail.className = "topbar-side";
    rightRail.append(actions, this.statusNode);

    topbar.append(rightRail);

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
  }

  async init(): Promise<void> {
    await this.store.refreshLocalScan();
  }

  private render(state: StoreState): void {
    this.statusNode.textContent = state.status;

    const visibleDescriptors = this.store.getVisibleDescriptors();
    const selectedDescriptor = this.store.getSelectedDescriptor();
    const selectedSession = this.store.getSelectedSession();
    this.captureSidebarScroll();

    this.sidebarMount.replaceChildren(
      renderSidebar({
        descriptors: visibleDescriptors,
        selectedKey: state.selectedKey,
        sourceFilter: state.sourceFilter,
        search: state.search,
        loading: state.loadingScan,
        onSearch: (value) => {
          this.store.setSearch(value);
        },
        onFilter: (value) => {
          this.store.setSourceFilter(value);
        },
        onSelect: async (key) => {
          await this.store.selectSession(key);
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
        onFilterChange: (filter) => {
          this.messageFilter = filter;
          this.render(this.store.getState());
        },
        onExport: (session) => {
          this.exportSession(session);
        }
      })
    );
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
