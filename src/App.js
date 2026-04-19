import { el, cleanup, replace } from "./core/dom.js";
import { CONFIG } from "./core/config.js";
import store from "./core/state.js";
import router from "./core/router.js";
import AuthService from "./services/auth.service.js";
import ApiService from "./services/api.service.js";
import TransactionService from "./services/transaction.service.js";
import LoginComponent from "./features/login/login.component.js";
import DashboardComponent from "./features/dashboard/dashboard.component.js";
import UploadComponent from "./features/upload/upload.component.js";
import TransactionsComponent from "./features/transactions/transactions.component.js";
import TagsComponent from "./features/tags/tags.component.js";
import AnalysisComponent from "./features/analysis/analysis.component.js";
import SettingsComponent from "./features/settings/settings.component.js";
import LoaderComponent from "./shared/loader.component.js";

class App {
  constructor(element) {
    this.element = element;
    this.element.className = "app-root";
    this.subscriptions = [];

    this.dataUploadedHandler = () => {
      this.loadInitialData();
    };
    document.addEventListener("dataUploaded", this.dataUploadedHandler);

    this.sessionExpiredHandler = () => {
      AuthService.logout();
      store.setState("error", "Session expired. Please log in again.");
    };
    document.addEventListener("sessionExpired", this.sessionExpiredHandler);

    // When a tab regains focus, verify the session is still valid server-side.
    // This catches the case where a duplicated tab's session was revoked in another tab.
    this.visibilityChangeHandler = () => {
      if (document.visibilityState === "visible" && AuthService.isLoggedIn()) {
        ApiService.ping().catch(() => {
          // A 401 response dispatches the "sessionExpired" CustomEvent via ApiService,
          // which AuthService.logout() handles via sessionExpiredHandler above.
        });
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);

    this.hashChangeHandler = () => {
      const hash = window.location.hash.slice(1) || "dashboard";
      this.updateActiveTab(hash);
    };

    try {
      AuthService.init();
    } catch (error) {
      console.error("Failed to initialize authentication:", error);
      store.setState(
        "error",
        "Authentication initialization failed. Please refresh or contact support.",
      );
    }
    this.render();

    this.subscriptions.push(
      store.subscribe("currentUser", this.render.bind(this)),
    );
    this.subscriptions.push(
      store.subscribe("isLoading", () => this.handleLoadingState()),
    );
    this.subscriptions.push(
      store.subscribe("isUploading", () => this.handleLoadingState()),
    );
    this.subscriptions.push(
      store.subscribe("isTagging", () => this.handleLoadingState()),
    );
    this.subscriptions.push(
      store.subscribe("savingTags", () => this.handleLoadingState()),
    );
    this.subscriptions.push(
      store.subscribe("settingsSyncing", () => this.handleLoadingState()),
    );
    this.subscriptions.push(
      store.subscribe("error", () => this.handleErrorState()),
    );

    // Accessibility Mode
    const savedAccessibilityMode =
      localStorage.getItem("accessibilityMode") === "true";
    store.setState("accessibilityMode", savedAccessibilityMode);
    this.updateAccessibilityMode(savedAccessibilityMode);

    this.subscriptions.push(
      store.subscribe("accessibilityMode", (enabled) => {
        this.updateAccessibilityMode(enabled);
        localStorage.setItem("accessibilityMode", enabled);
      }),
    );

    // Reactive Transaction Processing
    const updateProcessedTransactions = () => {
      const raw = store.getState("rawExpenses") || [];
      const splits = store.getState("splitTransactions") || [];
      // Only process if we have data (or empty array)
      const processed = TransactionService.mergeSplits(raw, splits);
      store.setState("expenses", processed);
    };

    this.subscriptions.push(
      store.subscribe("rawExpenses", updateProcessedTransactions),
    );
    this.subscriptions.push(
      store.subscribe("splitTransactions", updateProcessedTransactions),
    );
  }

  render() {
    if (AuthService.isLoggedIn()) {
      this.renderMainApp();
    } else {
      this.renderLogin();
    }
  }

  cleanupComponents() {
    if (this.loginComponent?.destroy) {
      this.loginComponent.destroy();
    }
  }

  renderLogin() {
    this.element.className = "app-root app-root--login";
    this.cleanupMainApp();
    this.cleanupComponents();
    const loginRoot = el("div", { id: "login-root" });
    replace(this.element, loginRoot);
    this.loginComponent = new LoginComponent(loginRoot);
  }

  renderMainApp() {
    this.element.className = "app-root app-root--shell";
    store.setState("isLoading", true);
    this.cleanupMainApp();
    this.globalLoader = new LoaderComponent();
    const currentUser = store.getState("currentUser") || {};
    const canEdit = currentUser.canEdit === true;

    const navItem = (tab, icon, text, active = false) =>
      el(
        "li",
        { className: `nav-item${active ? " active" : ""}`, dataset: { tab } },
        el(
          "a",
          { href: `#${tab}` },
          el("span", { className: "nav-icon" }, icon),
          el("span", { className: "nav-text" }, text),
        ),
      );

    const mainApp = el(
      "div",
      { className: "main-menu-container" },
      el(
        "aside",
        { className: "sidebar", id: "app-sidebar" },
        el(
          "div",
          { className: "logo-section" },
          el("img", {
            src: CONFIG.LOGO_PATH,
            alt: "UMHC Logo",
            className: "sidebar-logo",
            onerror: (e) => (e.target.style.display = "none"),
          }),
          el("h2", {}, "UMHC Treasurer"),
        ),
        el(
          "nav",
          { className: "nav-menu" },
          el(
            "ul",
            {},
            navItem("dashboard", "📊", "Dashboard", true),
            navItem("transactions", "💳", "Transactions"),
            canEdit ? navItem("upload", "📤", "Upload") : null,
            navItem("tags", "🏷️", canEdit ? "Manage Tags" : "Tags"),
            navItem("analysis", "📈", "Analysis"),
            navItem("settings", "⚙️", "Settings"),
          ),
        ),
        el(
          "div",
          { className: "sidebar-footer" },
          el(
            "button",
            { id: "logout-button", className: "logout-button" },
            "Logout",
          ),
        ),
      ),
      el("button", {
        className: "mobile-menu-backdrop",
        "aria-label": "Close navigation menu",
        tabindex: "-1",
      }),
      el(
        "main",
        { className: "main-content" },
        el(
          "header",
          { className: "main-header" },
          el(
            "div",
            { className: "header-content" },
            el(
              "div",
              { className: "header-primary" },
              el(
                "button",
                {
                  id: "expand-btn",
                  className: "expand-btn",
                  title: "Open navigation menu",
                  "aria-controls": "app-sidebar",
                  "aria-expanded": "false",
                  "aria-label": "Open navigation menu",
                  style: { display: "none" }, // Hidden by default, shown via CSS
                },
                "☰",
              ),
              el(
                "div",
                { className: "title-group" },
                el(
                  "div",
                  { className: "title-row" },
                  el("h1", { id: "page-title" }, "Dashboard"),
                  !canEdit
                    ? el(
                        "span",
                        { className: "mode-badge mode-badge-readonly" },
                        "View Only",
                      )
                    : null,
                ),
              ),
            ),
            el(
              "button",
              { className: "refresh-btn", title: "Refresh Data" },
              "🔄",
            ),
          ),
        ),
        el(
          "div",
          {
            id: "global-loader-container",
            style: {
              display: "none",
              justifyContent: "center",
              alignItems: "center",
              height: "80%",
              width: "100%",
            },
          },
          this.globalLoader.render(),
        ),
        el(
          "div",
          { className: "content-wrapper" },
          el("div", { id: "error-banner-container" }),
          el("section", { id: "dashboard-content", className: "tab-content" }),
          el("section", {
            id: "transactions-content",
            className: "tab-content",
          }),
          canEdit
            ? el("section", { id: "upload-content", className: "tab-content" })
            : null,
          el("section", { id: "tags-content", className: "tab-content" }),
          el("section", { id: "analysis-content", className: "tab-content" }),
          el("section", { id: "settings-content", className: "tab-content" }),
        ),
      ),
    );

    replace(this.element, mainApp);
    this.initComponents();
    this.attachEventListeners();
    this.handleLoadingState();
    this.loadInitialData();
  }

  cleanupMainApp() {
    // Cleanup components if they have destroy methods
    if (this.components) {
      Object.values(this.components).forEach((component) => {
        if (component?.destroy) component.destroy();
      });
    }

    if (this.globalLoader?.destroy) {
      this.globalLoader.destroy();
    }

    // Reset router
    if (router.reset) router.reset();

    // Remove hashchange listener specifically added in attachEventListeners
    window.removeEventListener("hashchange", this.hashChangeHandler);
    window.removeEventListener("resize", this.mobileViewportHandler);
    document.removeEventListener("keydown", this.mobileMenuKeydownHandler);
  }

  initComponents() {
    this.components = {};
    const currentUser = store.getState("currentUser") || {};
    const canEdit = currentUser.canEdit === true;

    const dashboardEl = this.element.querySelector("#dashboard-content");
    const transactionsEl = this.element.querySelector("#transactions-content");
    const uploadEl = canEdit
      ? this.element.querySelector("#upload-content")
      : null;
    const tagsEl = this.element.querySelector("#tags-content");
    const analysisEl = this.element.querySelector("#analysis-content");
    const settingsEl = this.element.querySelector("#settings-content");

    if (
      !dashboardEl ||
      !transactionsEl ||
      (canEdit && !uploadEl) ||
      !tagsEl ||
      !analysisEl ||
      !settingsEl
    ) {
      console.error("Failed to find all content containers");
      store.setState("error", "Application initialization failed");
      return;
    }

    try {
      this.components.dashboard = new DashboardComponent(dashboardEl);
      this.components.transactions = new TransactionsComponent(transactionsEl);
      if (canEdit && uploadEl) {
        this.components.upload = new UploadComponent(uploadEl);
      }
      this.components.tags = new TagsComponent(tagsEl);
      this.components.analysis = new AnalysisComponent(analysisEl);
      this.components.settings = new SettingsComponent(settingsEl);
    } catch (error) {
      console.error("Failed to initialize components:", error);
      store.setState(
        "error",
        "Component initialization failed. Please refresh the page.",
      );
      store.setState("isLoading", false);
      return;
    }

    router.register("dashboard", dashboardEl);
    router.register("transactions", transactionsEl);
    if (canEdit && uploadEl) {
      router.register("upload", uploadEl);
    }
    router.register("tags", tagsEl);
    router.register("analysis", analysisEl);
    router.register("settings", settingsEl);
    router.start();
  }

  handleLoadingState() {
    const isLoading = store.getState("isLoading");
    const isUploading = store.getState("isUploading");
    const isTagging = store.getState("isTagging");
    const savingTags = store.getState("savingTags");
    const settingsSyncing = store.getState("settingsSyncing");

    const activeNavItem = this.element.querySelector(".nav-item.active");
    const activeTab = activeNavItem
      ? activeNavItem.getAttribute("data-tab")
      : "dashboard";

    const loaderContainer = this.element.querySelector(
      "#global-loader-container",
    );
    const contentWrapper = this.element.querySelector(".content-wrapper");
    const refreshBtn = this.element.querySelector(".refresh-btn");

    // Show global loader if loading (standard)
    // OR if uploading and NOT on upload tab
    // OR if tagging and NOT on transactions tab
    // OR if savingTags and NOT on tags tab
    // OR if settingsSyncing and NOT on settings tab
    const shouldShowGlobalLoader =
      isLoading ||
      (isUploading && activeTab !== "upload") ||
      (isTagging && activeTab !== "transactions" && activeTab !== "tags") ||
      (savingTags && activeTab !== "tags") ||
      (settingsSyncing && activeTab !== "settings");
    if (loaderContainer && contentWrapper) {
      if (shouldShowGlobalLoader) {
        loaderContainer.style.display = "flex";
        contentWrapper.style.display = "none";
        if (refreshBtn) refreshBtn.textContent = "⏳";
      } else {
        loaderContainer.style.display = "none";
        contentWrapper.style.display = "block";
        if (refreshBtn) refreshBtn.textContent = "🔄";
      }
    }
  }

  handleErrorState() {
    const error = store.getState("error");
    const container = this.element.querySelector("#error-banner-container");
    if (!container) return;

    if (error) {
      const banner = el(
        "div",
        { className: "error-banner", role: "alert" },
        el("span", { className: "error-banner-message" }, error),
        el(
          "button",
          {
            className: "error-banner-close",
            onclick: () => store.setState("error", null),
            "aria-label": "Dismiss error",
          },
          "×",
        ),
      );
      replace(container, banner);
    } else {
      cleanup(container);
    }
  }

  attachEventListeners() {
    const logoutBtn = this.element.querySelector("#logout-button");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        AuthService.logout();
      });
    }

    const expandBtn = this.element.querySelector("#expand-btn");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        this.toggleMobileMenu();
      });
    }

    const backdrop = this.element.querySelector(".mobile-menu-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        this.toggleMobileMenu(false);
      });
    }

    const refreshBtn = this.element.querySelector(".refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        this.loadInitialData();
      });
    }

    // Handle navigation via hash change (Unidirectional Flow)
    window.addEventListener("hashchange", this.hashChangeHandler);
    this.mobileViewportHandler = () => {
      if (window.innerWidth > 1024) {
        this.toggleMobileMenu(false);
      }
    };
    this.mobileMenuKeydownHandler = (event) => {
      if (event.key === "Escape") {
        this.toggleMobileMenu(false);
      }
    };
    window.addEventListener("resize", this.mobileViewportHandler);
    document.addEventListener("keydown", this.mobileMenuKeydownHandler);

    // Initial check
    const initialTab = window.location.hash.slice(1) || "dashboard";
    this.updateActiveTab(initialTab);
  }

  toggleMobileMenu(forceOpen) {
    const container = this.element.querySelector(".main-menu-container");
    const expandBtn = this.element.querySelector("#expand-btn");
    if (!container || !expandBtn) return;

    const isOpen =
      typeof forceOpen === "boolean"
        ? forceOpen
        : !container.classList.contains("mobile-menu-open");

    container.classList.toggle("mobile-menu-open", isOpen);
    expandBtn.textContent = isOpen ? "✕" : "☰";
    expandBtn.setAttribute("aria-expanded", String(isOpen));
    expandBtn.setAttribute(
      "aria-label",
      isOpen ? "Close navigation menu" : "Open navigation menu",
    );
    expandBtn.setAttribute(
      "title",
      isOpen ? "Close navigation menu" : "Open navigation menu",
    );
  }

  updateAccessibilityMode(enabled) {
    if (enabled) {
      document.body.classList.add("accessibility-mode");
    } else {
      document.body.classList.remove("accessibility-mode");
    }
  }

  updateActiveTab(tabName) {
    const currentUser = store.getState("currentUser") || {};
    const canEdit = currentUser.canEdit === true;
    if (!canEdit && tabName === "upload") {
      tabName = "dashboard";
      if (window.location.hash.slice(1) === "upload") {
        window.location.hash = "#dashboard";
      }
    }

    // 1. Update Sidebar Selection
    const navItems = this.element.querySelectorAll(".nav-item");
    navItems.forEach((i) => {
      if (i.getAttribute("data-tab") === tabName) {
        i.classList.add("active");
      } else {
        i.classList.remove("active");
      }
    });

    // 2. Update Page Title
    const title = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    const pageTitle = this.element.querySelector("#page-title");
    if (pageTitle) {
      pageTitle.textContent = title;
    }

    // 3. Handle Loading State specific to new tab
    this.handleLoadingState();

    // 4. Close mobile menu if open
    this.toggleMobileMenu(false);
  }

  async loadInitialData() {
    if (this._loadingData) return;
    this._loadingData = true;
    store.setState("isLoading", true);

    try {
      const appData = await ApiService.getAppData();

      if (appData.success) {
        store.setState(
          "splitTransactions",
          appData.data.splitTransactions || [],
        );
        store.setState("tags", appData.data.tags);
        store.setState("openingBalance", appData.data.openingBalance);
        // Store raw expenses last — triggers the subscription that merges splits,
        // which must already be in the store to avoid a flash of un-split state.
        store.setState("rawExpenses", appData.data.expenses);
      } else {
        console.error("API returned success: false", appData);
        store.setState("error", appData.message || "Failed to load data");
      }
    } catch (error) {
      console.error("Load initial data error:", error);
      store.setState(
        "error",
        "Failed to load application data. Please try refreshing.",
      );
    } finally {
      this._loadingData = false;
      store.setState("isLoading", false);
    }
  }

  destroy() {
    this.cleanupMainApp();
    this.cleanupComponents();

    if (this.dataUploadedHandler) {
      document.removeEventListener("dataUploaded", this.dataUploadedHandler);
    }
    if (this.sessionExpiredHandler) {
      document.removeEventListener(
        "sessionExpired",
        this.sessionExpiredHandler,
      );
    }
    if (this.visibilityChangeHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler,
      );
    }

    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }
}

const appElement = document.getElementById("app");
if (appElement) {
  new App(appElement);
} else {
  console.error("Root element #app not found");
}
