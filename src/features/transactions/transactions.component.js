// src/features/transactions/transactions.component.js
import store from "../../core/state.js";
import ApiService from "../../services/api.service.js";
import SortableTable from "../../shared/sortable-table.component.js";
import LoaderComponent from "../../shared/loader.component.js";
import ModalComponent from "../../shared/modal.component.js";
import TransactionsFilters from "./transactions.filters.js";
import TransactionsBulk from "./transactions.bulk.js";
import TransactionsManualModal from "./transactions.manual.js";
import SplitTransactionModal from "./split-transaction.modal.js";
import TransactionsSplitHistory from "./transactions.split-history.js";
import * as TransactionsLogic from "./transactions.logic.js";
import TagSelector from "../../shared/tag-selector.component.js";
import MobileDisclosureComponent from "../../shared/mobile-disclosure.component.js";
import {
  createMobileDataCard,
  createMobileDataDetail,
  createMobileDataEmptyState,
  createMobileDataList,
  createMobileDataMetric,
} from "../../shared/mobile-data-card.component.js";
import { withSearchInputAttributes } from "../../shared/search-input.js";
import { el, replace } from "../../core/dom.js";
import { formatCurrency, parseAmount } from "../../core/utils.js";

class TransactionsComponent {
  getCanEdit() {
    const currentUser = store.getState("currentUser");
    return !(currentUser && currentUser.canEdit === false);
  }

  constructor(element) {
    this.element = element;
    this.transactionData = [];
    this.originalTransactionData = [];
    this.canEdit = this.getCanEdit();

    // State
    this.selectionMode = false;
    this.selectedRows = new Set();
    this.activeTimeouts = [];

    this.pendingChanges = new Map(); // rowId -> { 'Trip/Event': val, 'Category': val }
    this.tagSelector = new TagSelector();

    this.selectedCategories = new Set();
    this.selectedTrips = new Set();
    this.categorySearchTerm = "";
    this.tripSearchTerm = "";
    this.descriptionSearchTerm = "";
    this.filtersExpanded = false;
    this.filtersDisclosure = null;
    this.mobileMediaQuery = window.matchMedia("(max-width: 768px)");
    this.isMobile = this.mobileMediaQuery.matches;
    this.tableSortField = "Date";
    this.tableSortAsc = false;

    this.subscriptions = [];
    this.subscriptions.push(
      store.subscribe("expenses", (data) => this.handleDataChange(data)),
    );
    this.subscriptions.push(
      store.subscribe("tags", () => this.handleTagsChange()),
    );
    this.subscriptions.push(
      store.subscribe("isTagging", () => this.renderTransactionsDisplay()),
    );
    this.subscriptions.push(
      store.subscribe("savingSplitTransaction", () =>
        this.renderTransactionsDisplay(),
      ),
    );
    this.subscriptions.push(
      store.subscribe("taggingProgress", () => this.updateProgressDisplay()),
    );
    this.subscriptions.push(
      store.subscribe("transactionParams", (params) =>
        this.handleTransactionParams(params),
      ),
    );
    this.subscriptions.push(
      store.subscribe("splitTransactions", (splits) =>
        this.handleSplitsChange(splits),
      ),
    );
    this.subscriptions.push(
      store.subscribe("isLoading", (isLoading) =>
        this.handleLoadingChange(isLoading),
      ),
    );
    this.subscriptions.push(
      store.subscribe("currentUser", () => this.handleUserChange()),
    );

    this.render();

    // Initialize with current store state if available
    const currentExpenses = store.getState("expenses");
    if (currentExpenses) {
      this.handleDataChange(currentExpenses);
    }

    this.viewportChangeHandler = () => {
      const nextIsMobile = this.mobileMediaQuery.matches;
      if (nextIsMobile === this.isMobile) return;
      this.isMobile = nextIsMobile;
      this.renderTransactionsDisplay();
    };

    if (typeof this.mobileMediaQuery.addEventListener === "function") {
      this.mobileMediaQuery.addEventListener(
        "change",
        this.viewportChangeHandler,
      );
    } else if (typeof this.mobileMediaQuery.addListener === "function") {
      this.mobileMediaQuery.addListener(this.viewportChangeHandler);
    }

    // Global click listener to close dropdowns
    this.boundGlobalClickHandler = (e) => {
      this.handleGlobalClick(e);
      this.handleInteractiveTagClick(e);
    };
    document.addEventListener("click", this.boundGlobalClickHandler);

    // Global keydown listener for accessibility
    this.boundGlobalKeydownHandler = (e) => {
      this.handleInteractiveTagKeydown(e);
    };
    document.addEventListener("keydown", this.boundGlobalKeydownHandler);
  }

  destroy() {
    if (this.tagSelector) {
      this.tagSelector.destroy();
    }
    if (
      this.tableComponent &&
      typeof this.tableComponent.destroy === "function"
    ) {
      this.tableComponent.destroy();
    }
    if (
      this.filtersComponent &&
      typeof this.filtersComponent.destroy === "function"
    ) {
      this.filtersComponent.destroy();
    }
    if (this.manualModal && typeof this.manualModal.destroy === "function") {
      this.manualModal.destroy();
    }
    if (this.boundGlobalClickHandler) {
      document.removeEventListener("click", this.boundGlobalClickHandler);
    }
    if (this.boundGlobalKeydownHandler) {
      document.removeEventListener("keydown", this.boundGlobalKeydownHandler);
    }
    if (this.subscriptions) {
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions = [];
    }
    if (this.activeTimeouts) {
      this.activeTimeouts.forEach((id) => clearTimeout(id));
      this.activeTimeouts = [];
    }
    if (this.bulkComponent) {
      this.bulkComponent.destroy();
    }
    if (this.filtersDisclosure) {
      this.filtersDisclosure.destroy();
      this.filtersDisclosure = null;
    }
    if (typeof this.mobileMediaQuery.removeEventListener === "function") {
      this.mobileMediaQuery.removeEventListener(
        "change",
        this.viewportChangeHandler,
      );
    } else if (typeof this.mobileMediaQuery.removeListener === "function") {
      this.mobileMediaQuery.removeListener(this.viewportChangeHandler);
    }
  }

  handleLoadingChange(isLoading) {
    if (!isLoading) {
      if (store.getState("savingSplitTransaction")) {
        store.setState("savingSplitTransaction", false);
      }
      if (
        store.getState("isTagging") &&
        store.getState("taggingSource") === "transactions"
      ) {
        store.setState("isTagging", false);
        store.setState("taggingSource", null);
      }
    }
  }

  handleUserChange() {
    const canEdit = this.getCanEdit();
    if (this.canEdit === canEdit) return;
    this.canEdit = canEdit;
    if (!this.canEdit && this.selectionMode) {
      this.toggleSelectionMode(false);
    }
    this.renderTransactionsDisplay();
  }

  handleGlobalClick(e) {
    if (this.selectionMode && this.bulkComponent) {
      this.bulkComponent.handleGlobalClick(e);
    }
  }

  handleInteractiveTagClick(e) {
    // Ignore if we are in bulk selection mode
    if (this.selectionMode || !this.canEdit) return;

    const target = e.target;

    // Handle "Remove Tag" (X button)
    if (target.classList.contains("remove-btn")) {
      e.stopPropagation();
      const pill = target.closest(".tag-pill");
      if (!pill) return;
      const rowId = pill.dataset.row;
      const type = pill.dataset.type;

      if (!rowId || !type) return;

      this.updatePendingChange(rowId, type, "");
      return;
    }

    // Handle "Add Tag" (+)
    if (target.classList.contains("add-tag-placeholder")) {
      e.stopPropagation();
      const rowId = target.dataset.row;
      const type = target.dataset.type;

      if (!rowId || !type) return;

      this.tagSelector.show(target, type, "", (newVal) => {
        this.updatePendingChange(rowId, type, newVal);
      });
      return;
    }

    // Handle "Change Tag" (Clicking the pill body)
    const pill = target.closest(".tag-pill");
    if (pill) {
      e.stopPropagation();
      const rowId = pill.dataset.row;
      const type = pill.dataset.type;

      if (!rowId || !type) return;

      const tagTextEl = pill.querySelector(".tag-text");
      const currentVal = tagTextEl ? tagTextEl.textContent : "";

      this.tagSelector.show(pill, type, currentVal, (newVal) => {
        this.updatePendingChange(rowId, type, newVal);
      });
    }
  }

  handleInteractiveTagKeydown(e) {
    // Ignore if we are in bulk selection mode
    if (this.selectionMode || !this.canEdit) return;

    // Check for Enter (13) or Space (32)
    if (e.key === "Enter" || e.key === " ") {
      const target = e.target;

      // Handle "Remove Tag" (X button)
      if (target.classList.contains("remove-btn")) {
        e.preventDefault(); // Prevent scrolling for Space
        e.stopPropagation();
        const pill = target.closest(".tag-pill");
        if (!pill) return;
        const rowId = pill.dataset.row;
        const type = pill.dataset.type;

        if (!rowId || !type) return;

        this.updatePendingChange(rowId, type, "");
        return;
      }

      // Handle "Add Tag" (+) or "Change Tag" (pill body)
      if (
        target.classList.contains("add-tag-placeholder") ||
        target.classList.contains("tag-pill")
      ) {
        e.preventDefault();
        e.stopPropagation();
        const rowId = target.dataset.row;
        const type = target.dataset.type;

        if (!rowId || !type) return;

        let currentVal = "";
        if (target.classList.contains("tag-pill")) {
          const tagTextEl = target.querySelector(".tag-text");
          currentVal = tagTextEl ? tagTextEl.textContent : "";
        }

        this.tagSelector.show(target, type, currentVal, (newVal) => {
          this.updatePendingChange(rowId, type, newVal);
        });
      }
    }
  }

  updatePendingChange(rowId, type, value) {
    // rowId might be number or string, ensure consistency
    rowId = String(rowId);

    if (!this.pendingChanges.has(rowId)) {
      this.pendingChanges.set(rowId, {});
    }

    const pendingRow = this.pendingChanges.get(rowId);
    pendingRow[type] = value;

    // Check if the new value is actually the same as original, if so remove pending
    const originalRow = this.originalTransactionData.find(
      (r) => String(r.row) === rowId,
    );
    if (originalRow) {
      const originalVal = originalRow[type] || "";
      if (value === originalVal) {
        delete pendingRow[type];
        if (Object.keys(pendingRow).length === 0) {
          this.pendingChanges.delete(rowId);
        }
      }
    }

    // Re-render to update UI
    this.renderTransactionsDisplay();
  }

  handleTransactionParams(params) {
    if (!params) return;
    if (!this.canEdit) {
      store.setState("transactionParams", null);
      return;
    }

    // Ensure we are rendered and components exist
    if (!this.bulkComponent) return;

    if (params.mode === "bulk") {
      this.toggleSelectionMode(true);
      if (params.prefill) {
        this.bulkComponent.setPrefill(params.prefill);
      }
      // Clear params to prevent re-processing
      store.setState("transactionParams", null);
    }
  }

  render() {
    this.transactionsDisplay = el("div", { id: "transactions-display" });
    replace(this.element, this.transactionsDisplay);
    this.renderTransactionsDisplay();
  }

  getFiltersSummaryConfig() {
    const items = [];

    if (this.selectedTrips.size > 0) {
      items.push({
        label: `${this.selectedTrips.size} trip${this.selectedTrips.size === 1 ? "" : "s"}`,
      });
    }

    if (this.selectedCategories.size > 0) {
      items.push({
        label: `${this.selectedCategories.size} categor${this.selectedCategories.size === 1 ? "y" : "ies"}`,
      });
    }

    const activeSearchCount = [
      this.tripSearchTerm,
      this.categorySearchTerm,
      this.descriptionSearchTerm,
    ].filter((term) => term && term.trim().length > 0).length;

    if (activeSearchCount > 0) {
      items.push({
        label: `${activeSearchCount} search${activeSearchCount === 1 ? "" : "es"}`,
        tone: "muted",
      });
    }

    return {
      items,
      emptyText: "No filters active",
    };
  }

  renderFiltersDisclosure(mountPoint, filterBody) {
    if (this.filtersDisclosure) {
      this.filtersDisclosure.destroy();
    }

    this.filtersDisclosure = new MobileDisclosureComponent(mountPoint, {
      title: "Filters",
      summary: this.getFiltersSummaryConfig(),
      expanded: this.filtersExpanded,
      collapseMode: "mobile",
      className: "transactions-filters-disclosure",
      bodyClassName: "transactions-filters-disclosure__body",
      bodyChildren: [filterBody],
      onToggle: (expanded) => {
        this.filtersExpanded = expanded;
      },
    });
  }

  updateFiltersDisclosure() {
    if (!this.filtersDisclosure) return;

    this.filtersDisclosure.setSummary(this.getFiltersSummaryConfig());
  }

  renderTransactionsDisplay() {
    if (this.filtersDisclosure) {
      this.filtersDisclosure.destroy();
      this.filtersDisclosure = null;
    }

    const isTagging = store.getState("isTagging");
    const taggingSource = store.getState("taggingSource");
    const isSavingSplit = store.getState("savingSplitTransaction");
    const taggingProgress =
      store.getState("taggingProgress") || "Initializing...";

    if (isTagging) {
      let content;
      if (taggingSource === "transactions") {
        content = el(
          "div",
          {
            className: "section",
            style: {
              height: "400px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
            },
          },
          el("div", {
            className: "loader",
            style: { width: "50px", height: "50px", marginBottom: "20px" },
          }),
          el(
            "h3",
            { style: { color: "#f0ad4e", marginBottom: "10px" } },
            "Processing Tags...",
          ),
          el(
            "p",
            {
              id: "tagging-progress-text",
              style: { color: "#fff", fontSize: "1.1em" },
            },
            taggingProgress,
          ),
        );
      } else {
        content = el(
          "div",
          {
            className: "section",
            style: {
              height: "400px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            },
          },
          new LoaderComponent().render(),
        );
      }
      replace(this.transactionsDisplay, content);
      return;
    }

    if (isSavingSplit) {
      replace(
        this.transactionsDisplay,
        el(
          "div",
          {
            className: "section",
            style: {
              height: "400px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
            },
          },
          el("div", {
            className: "loader",
            style: { width: "50px", height: "50px", marginBottom: "20px" },
          }),
          el(
            "h3",
            { style: { color: "#f0ad4e", marginBottom: "10px" } },
            "Saving Split Transaction...",
          ),
          el(
            "p",
            { style: { color: "#aaa" } },
            "Please wait while we update the finances.",
          ),
        ),
      );
      return;
    }

    // Default View
    const hasPendingChanges = this.pendingChanges.size > 0;

    // Controls
    const saveBtn =
      this.canEdit && hasPendingChanges
        ? el(
            "button",
            {
              id: "save-changes-btn",
              className: "action-btn",
              onclick: () => this.savePendingChanges(),
            },
            `Save Changes (${this.pendingChanges.size})`,
          )
        : null;

    // Tag Filters Container
    const tripFilterInput = el(
      "input",
      withSearchInputAttributes({
        id: "transactions-trip-search",
        "aria-label": "Search Trips",
        className: "tag-search-input",
        placeholder: "Search trips...",
        value: this.tripSearchTerm,
      }),
    );
    const tripSelectorContainer = el(
      "div",
      { id: "trip-selector-container", className: "tag-selector" },
      el(
        "div",
        { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
        "Loading...",
      ),
    );

    const catFilterInput = el(
      "input",
      withSearchInputAttributes({
        id: "transactions-cat-search",
        "aria-label": "Search Categories",
        className: "tag-search-input",
        placeholder: "Search categories...",
        value: this.categorySearchTerm,
      }),
    );
    const catSelectorContainer = el(
      "div",
      { id: "category-selector-container", className: "tag-selector" },
      el(
        "div",
        { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
        "Loading...",
      ),
    );

    const filterContent = el(
      "div",
      { className: "transactions-filter-body" },
      el(
        "div",
        { className: "tag-filters-container" },
        el(
          "div",
          { className: "tag-filter-column" },
          el("div", { className: "tag-filter-header" }, "Trips / Events"),
          tripFilterInput,
          tripSelectorContainer,
        ),
        el(
          "div",
          { className: "tag-filter-column" },
          el("div", { className: "tag-filter-header" }, "Categories"),
          catFilterInput,
          catSelectorContainer,
        ),
      ),
    );

    const filtersDisclosureMount = el("div", {
      className: "transactions-filters-disclosure-mount",
    });

    const controls = el(
      "div",
      {
        id: "main-controls",
        className: `transaction-controls ${
          this.selectionMode ? "disabled" : ""
        }`,
      },
      filtersDisclosureMount,
      el(
        "div",
        { className: "transaction-actions" },
        el("div", { className: "transaction-actions__primary" }, saveBtn),
        el(
          "div",
          { className: "transaction-actions__secondary" },
          this.canEdit
            ? el(
                "button",
                { id: "tag-transactions-btn", className: "secondary-btn" },
                "Bulk Tagging Mode",
              )
            : null,
          this.canEdit
            ? el(
                "button",
                {
                  id: "add-manual-btn",
                  className: "secondary-btn",
                  onclick: () => this.openManualModal(),
                },
                "Add Manual Transaction",
              )
            : null,
          el(
            "button",
            {
              id: "view-splits-btn",
              className: "secondary-btn",
              onclick: () => this.viewSplitHistory(),
            },
            "View Split Transactions",
          ),
        ),
      ),
    );

    // Bulk Actions Toolbar
    const bulkToolbar = el(
      "div",
      { id: "bulk-actions-toolbar", className: "bulk-actions-toolbar" },
      el(
        "div",
        { className: "bulk-actions-content" },
        el("strong", { className: "bulk-label" }, "BULK ACTIONS:"),
        // Custom Trip Dropdown
        el(
          "div",
          { className: "custom-dropdown", id: "bulk-trip-container" },
          el(
            "div",
            { className: "dropdown-trigger", id: "bulk-trip-trigger" },
            "Set Trip/Event...",
          ),
          el(
            "div",
            {
              className: "dropdown-content",
              id: "bulk-trip-content",
              style: { display: "none" },
            },
            el(
              "input",
              withSearchInputAttributes({
                className: "tag-search-input",
                id: "bulk-trip-search",
                "aria-label": "Search trips for bulk action",
                placeholder: "Search trips...",
              }),
            ),
            el("div", { className: "tag-selector", id: "bulk-trip-list" }),
          ),
        ),
        // Custom Category Dropdown
        el(
          "div",
          { className: "custom-dropdown", id: "bulk-category-container" },
          el(
            "div",
            { className: "dropdown-trigger", id: "bulk-category-trigger" },
            "Set Category...",
          ),
          el(
            "div",
            {
              className: "dropdown-content",
              id: "bulk-category-content",
              style: { display: "none" },
            },
            el(
              "input",
              withSearchInputAttributes({
                className: "tag-search-input",
                id: "bulk-category-search",
                "aria-label": "Search categories for bulk action",
                placeholder: "Search categories...",
              }),
            ),
            el("div", { className: "tag-selector", id: "bulk-category-list" }),
          ),
        ),
        el("div", { style: { flexGrow: "1" } }),
        el(
          "span",
          { id: "selection-count", className: "selection-count" },
          "0 selected",
        ),
        el(
          "button",
          { id: "bulk-apply-btn", className: "action-btn" },
          "Apply Tags",
        ),
        el(
          "button",
          {
            id: "bulk-cancel-btn",
            className: "secondary-btn",
            style: { borderColor: "#d9534f", color: "#d9534f" },
          },
          "Cancel",
        ),
      ),
    );

    // Description Search
    const descSearchInput = el(
      "input",
      withSearchInputAttributes({
        id: "transactions-desc-search",
        "aria-label": "Search transaction descriptions",
        className: "tag-search-input transactions-description-search__input",
        placeholder: "Search transaction descriptions...",
        value: this.descriptionSearchTerm,
      }),
    );

    // Attach listener for description search
    descSearchInput.oninput = (e) => {
      this.descriptionSearchTerm = e.target.value;
      this.updateFiltersDisclosure();
      this.applyFilters();
    };

    const descSearchContainer = el(
      "div",
      { className: "transactions-description-search" },
      descSearchInput,
    );

    const tableContainer = el("div", { id: "transactions-table-container" });
    const mobileListContainer = el("div", {
      id: "transactions-mobile-list-container",
      className: "transactions-mobile-list",
    });

    const mainContainer = el(
      "div",
      { className: "section" },
      el(
        "div",
        { className: "transactions-header" },
        el("h2", {}, "All Transactions"),
      ),
      controls,
      this.canEdit ? bulkToolbar : null,
      descSearchContainer,
      tableContainer,
      mobileListContainer,
    );

    replace(this.transactionsDisplay, mainContainer);
    this.renderFiltersDisclosure(filtersDisclosureMount, filterContent);

    this.initializeSubComponents();

    // Restore UI state if returning from loading
    if (this.selectionMode) {
      this.toggleSelectionMode(true);
    } else {
      this.applyFilters();
    }

    this.handleTagsChange(); // Populate filters
  }

  renderTagCell(item, type) {
    const rowId = String(item.row);
    let value = item[type];
    let isPending = false;

    // Check pending changes
    if (this.pendingChanges.has(rowId)) {
      const changes = this.pendingChanges.get(rowId);
      if (changes.hasOwnProperty(type)) {
        value = changes[type];
        isPending = true;
      }
    }

    // Check if in Bulk Tagging Mode
    if (this.selectionMode) {
      if (value) {
        return el(
          "span",
          {
            className: `tag-pill ${isPending ? "pending-change" : ""}`,
            "data-row": rowId,
            "data-type": type,
            style: { cursor: "default" }, // Override pointer cursor
          },
          el("span", { className: "tag-text" }, value),
          // No remove button
        );
      } else {
        // No "+" button in bulk mode
        return el("span", {}, "");
      }
    }

    if (!this.canEdit) {
      if (value) {
        return el(
          "span",
          {
            className: `tag-pill ${isPending ? "pending-change" : ""}`,
            "data-row": rowId,
            "data-type": type,
            style: { cursor: "default" },
          },
          el("span", { className: "tag-text" }, value),
        );
      }
      return el("span", {}, "");
    }

    if (value) {
      return el(
        "span",
        {
          className: `tag-pill ${isPending ? "pending-change" : ""}`,
          "data-row": rowId,
          "data-type": type,
          tabIndex: "0",
          role: "button",
          title: "Click to change tag",
        },
        el("span", { className: "tag-text" }, value),
        el(
          "span",
          {
            className: "remove-btn",
            title: "Remove Tag",
            tabIndex: "0",
            role: "button",
            "aria-label": "Remove Tag",
          },
          "×",
        ),
      );
    } else {
      return el(
        "span",
        {
          className: "add-tag-placeholder",
          "data-row": rowId,
          "data-type": type,
          title: "Add Tag",
          tabIndex: "0",
          role: "button",
        },
        "+",
      );
    }
  }

  isRowSelected(rowId) {
    return this.selectedRows.has(String(rowId));
  }

  getTransactionNet(item) {
    return parseAmount(item.Income) - parseAmount(item.Expense);
  }

  getSortedTransactions(data) {
    const field = this.tableSortField || "Date";
    const ascending = this.tableSortAsc;

    if (field === "Amount") {
      return [...data].sort((a, b) => {
        const delta = this.getTransactionNet(a) - this.getTransactionNet(b);
        if (delta < 0) return ascending ? -1 : 1;
        if (delta > 0) return ascending ? 1 : -1;
        return 0;
      });
    }

    return TransactionsLogic.sortData(data, field, ascending);
  }

  syncTableSelection() {
    if (!this.tableComponent) return;

    this.tableComponent.selectedRows = new Set(
      this.transactionData
        .filter((item) => this.isRowSelected(item.row))
        .map((item) => item.row),
    );
  }

  reconcileSelectionWithVisibleRows() {
    if (this.selectedRows.size === 0) return;

    const visibleRowIds = new Set(
      this.transactionData.map((item) => String(item.row)),
    );
    let changed = false;

    Array.from(this.selectedRows).forEach((rowId) => {
      if (!visibleRowIds.has(String(rowId))) {
        this.selectedRows.delete(rowId);
        changed = true;
      }
    });

    if (changed) {
      this.updateSelectionUI();
    }
  }

  renderMobileTagCell(item, type) {
    const value = item[type];
    const control = this.renderTagCell(item, type);

    if (
      !value &&
      (!this.canEdit || this.selectionMode) &&
      !(control instanceof Element && control.querySelector(".tag-pill"))
    ) {
      return el(
        "span",
        { className: "transaction-mobile-card__empty-value" },
        "None",
      );
    }

    return control;
  }

  createMobileSelectionBar() {
    const allVisibleSelected =
      this.transactionData.length > 0 &&
      this.transactionData.every((item) => this.isRowSelected(item.row));

    return el(
      "div",
      { className: "transactions-mobile-selection-bar" },
      el(
        "div",
        { className: "transactions-mobile-selection-bar__count" },
        `${this.selectedRows.size} selected`,
      ),
      el(
        "div",
        { className: "transactions-mobile-selection-bar__actions" },
        el(
          "button",
          {
            type: "button",
            className: "secondary-btn",
            onclick: () => this.selectAllVisibleRows(),
            disabled: allVisibleSelected,
          },
          "Select All Visible",
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary-btn",
            onclick: () => this.clearSelectedRows(),
            disabled: this.selectedRows.size === 0,
          },
          "Clear",
        ),
      ),
    );
  }

  handleMobileSelectionChange(rowId, checked) {
    if (checked) {
      this.selectedRows.add(String(rowId));
    } else {
      this.selectedRows.delete(String(rowId));
    }

    this.updateSelectionUI();
    this.renderMobileTransactionsList();
  }

  selectAllVisibleRows() {
    this.transactionData.forEach((item) => {
      this.selectedRows.add(String(item.row));
    });
    this.updateSelectionUI();
    this.renderMobileTransactionsList();
  }

  clearSelectedRows() {
    this.selectedRows.clear();
    this.updateSelectionUI();
    this.renderMobileTransactionsList();
  }

  isMobileCardControlTarget(target) {
    return Boolean(
      target.closest(
        "button, input, label, .tag-pill, .add-tag-placeholder, .remove-btn",
      ),
    );
  }

  createTransactionMobileCard(item) {
    const rowId = String(item.row);
    const net = this.getTransactionNet(item);
    const tone = net > 0 ? "positive" : net < 0 ? "negative" : "";
    const isSelected = this.isRowSelected(rowId);

    const headerAside =
      this.selectionMode && this.canEdit
        ? el(
            "label",
            {
              className: "transaction-mobile-card__checkbox",
              "aria-label": `Select transaction ${item.Description || rowId}`,
            },
            el("input", {
              type: "checkbox",
              checked: isSelected,
              onchange: (event) =>
                this.handleMobileSelectionChange(rowId, event.target.checked),
              onclick: (event) => event.stopPropagation(),
            }),
          )
        : item["Split Group ID"]
          ? el(
              "span",
              {
                className:
                  "mobile-data-card__badge transaction-mobile-card__split-badge",
              },
              "Split",
            )
          : null;

    const details = [
      createMobileDataDetail({
        label: "Date",
        value: item.Date || "",
      }),
      createMobileDataDetail({
        label: "Trip/Event",
        value: this.renderMobileTagCell(item, "Trip/Event"),
      }),
      createMobileDataDetail({
        label: "Category",
        value: this.renderMobileTagCell(item, "Category"),
      }),
    ];

    if (item["Split Group ID"]) {
      details.push(
        createMobileDataDetail({
          label: "Group",
          value: item["Split Group ID"],
          valueClassName:
            "mobile-data-card__detail-value transaction-mobile-card__split-id",
        }),
      );
    }

    const card = createMobileDataCard({
      className: `transaction-mobile-card ${
        isSelected ? "transaction-mobile-card--selected" : ""
      }`.trim(),
      interactive: this.selectionMode || this.canEdit,
      eyebrow: this.selectionMode ? "Select Transaction" : "Transaction",
      title: item.Description || "Transaction",
      headerAside,
      details,
      metrics: [
        createMobileDataMetric({
          label: "Amount",
          value: formatCurrency(Math.abs(net)),
          tone,
          className: "transaction-mobile-card__amount-metric",
        }),
      ],
    });

    const activateCard = (event) => {
      if (this.isMobileCardControlTarget(event.target)) return;

      if (this.selectionMode) {
        this.handleMobileSelectionChange(rowId, !isSelected);
        return;
      }

      this.handleRowClick(item, event);
    };

    if (this.selectionMode || this.canEdit) {
      card.addEventListener("click", activateCard);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activateCard(event);
      });
    }

    return card;
  }

  renderMobileTransactionsList() {
    const container = this.transactionsDisplay.querySelector(
      "#transactions-mobile-list-container",
    );
    if (!container) return;

    if (!this.isMobile) {
      replace(container);
      return;
    }

    const content = [];

    if (this.selectionMode && this.canEdit) {
      content.push(this.createMobileSelectionBar());
    }

    if (this.transactionData.length === 0) {
      content.push(
        createMobileDataEmptyState({
          className: "transactions-mobile-empty-state",
          text: "No transactions match the current filters.",
        }),
      );
    } else {
      content.push(
        createMobileDataList({
          className: "transactions-mobile-card-list",
          children: this.getSortedTransactions(this.transactionData).map(
            (item) => this.createTransactionMobileCard(item),
          ),
        }),
      );
    }

    replace(container, ...content);
  }

  initializeSubComponents() {
    // Cleanup old table component
    if (
      this.tableComponent &&
      typeof this.tableComponent.destroy === "function"
    ) {
      this.tableSortField =
        this.tableComponent.sortField || this.tableSortField;
      this.tableSortAsc =
        this.tableComponent.sortAsc !== undefined
          ? this.tableComponent.sortAsc
          : this.tableSortAsc;
      this.tableComponent.destroy();
    }
    this.tableComponent = null;

    if (!this.isMobile) {
      this.tableComponent = new SortableTable(
        this.transactionsDisplay.querySelector("#transactions-table-container"),
        {
          columns: [
            { key: "Date", label: "Date", type: "date" },
            { key: "Description", label: "Description", type: "text" },
            {
              key: "Trip/Event",
              label: "Trip/Event",
              type: "custom",
              render: (item) => this.renderTagCell(item, "Trip/Event"),
            },
            {
              key: "Category",
              label: "Category",
              type: "custom",
              render: (item) => this.renderTagCell(item, "Category"),
            },
            {
              key: "Amount",
              label: "Amount",
              type: "custom",
              sortValue: (item) => this.getTransactionNet(item),
              render: (item) => {
                const net = this.getTransactionNet(item);
                const classType =
                  net > 0 ? "positive" : net < 0 ? "negative" : "";

                const span = document.createElement("span");
                if (classType) span.className = classType;
                span.textContent = formatCurrency(Math.abs(net));
                return span;
              },
            },
          ],
          enableSelection: this.selectionMode,
          rowIdField: "row",
          initialSortField: this.tableSortField,
          initialSortAsc: this.tableSortAsc,
          onSelectionChange: (selectedIds) =>
            this.handleSelectionChange(selectedIds),
          onRowClick: (item, e) => this.handleRowClick(item, e),
        },
      );
      this.syncTableSelection();
    }

    // Cleanup old filters component
    if (
      this.filtersComponent &&
      typeof this.filtersComponent.destroy === "function"
    ) {
      this.filtersComponent.destroy();
    }

    // Filters
    this.filtersComponent = new TransactionsFilters(this.transactionsDisplay, {
      onFilterChange: (type, tag, checked) =>
        this.handleFilterChange(type, tag, checked),
      onFilterSelectAll: (type, tags, checked) =>
        this.handleFilterSelectAll(type, tags, checked),
      onSearchChange: (type, term) => this.handleSearchChange(type, term),
    });

    // Cleanup old bulk component
    if (this.bulkComponent) {
      this.bulkComponent.destroy();
    }

    // Bulk
    this.bulkComponent = new TransactionsBulk(this.transactionsDisplay, {
      onToggleMode: (active) => this.toggleSelectionMode(active),
      onApply: (tripVal, catVal) => this.applyBulkTags(tripVal, catVal),
    });
  }

  handleRowClick(item, e) {
    if (!this.canEdit) return;

    // Check if click was on a tag interactive element
    if (
      e.target.closest(".tag-pill") ||
      e.target.closest(".add-tag-placeholder") ||
      e.target.closest(".remove-btn")
    ) {
      return;
    }

    if (item["Split Group ID"]) {
      this.openEditSplitModal(item["Split Group ID"]);
    } else {
      this.openSplitModal(item);
    }
  }

  async openSplitModal(transaction) {
    if (!this.canEdit) return;
    if (this.selectionMode) return; // Don't split in bulk mode
    if (store.getState("savingSplitTransaction")) {
      return; // Prevent concurrent split operations
    }
    store.setState("savingSplitTransaction", true);

    const modal = new SplitTransactionModal();
    let splits;
    try {
      splits = await modal.open(transaction);
    } catch (error) {
      store.setState("savingSplitTransaction", false);
      console.error("Split modal error:", error);
      return;
    }

    if (splits) {
      try {
        // Use skipLoading: true to manage our own state/UI
        await ApiService.splitTransaction(transaction, splits, {
          skipLoading: true,
        });

        // Reload data to reflect changes (remove original, add splits)
        document.dispatchEvent(new CustomEvent("dataUploaded"));
      } catch (error) {
        console.error("Split failed:", error);
        alert("Failed to split transaction: " + error.message);
        store.setState("savingSplitTransaction", false);
      }
    } else {
      store.setState("savingSplitTransaction", false);
    }
  }

  async openEditSplitModal(groupId) {
    if (!this.canEdit) return;
    if (this.selectionMode) return;
    if (store.getState("savingSplitTransaction")) {
      return;
    }
    store.setState("savingSplitTransaction", true);

    let source = null;
    let children = [];
    let foundLocally = false;

    const cachedSplits = store.getState("splitTransactions");
    if (cachedSplits && cachedSplits.length > 0) {
      const groupRows = cachedSplits.filter(
        (r) => r["Split Group ID"] === groupId,
      );
      if (groupRows.length > 0) {
        source = groupRows.find((r) => r["Split Type"] === "SOURCE");
        children = groupRows.filter((r) => r["Split Type"] === "CHILD");

        // Verify we have what we need
        if (source && children.length > 0) {
          foundLocally = true;
        }
      }
    }

    if (!foundLocally) {
      try {
        // 1. Fetch group details (Source + Children)
        const result = await ApiService.getSplitGroup(groupId);

        if (!result.success) throw new Error(result.message);

        source = result.data.source;
        children = result.data.children;
      } catch (error) {
        console.error("Edit Split failed:", error);
        alert("Failed to load split details: " + error.message);
        store.setState("savingSplitTransaction", false);
        return;
      }
    }

    try {
      // 2. Open Modal in Edit Mode
      const modal = new SplitTransactionModal();
      const editPayload = await modal.open(source, children, groupId);

      if (editPayload && editPayload.action === "edit") {
        try {
          await ApiService.editSplit(
            editPayload.groupId,
            editPayload.splits,
            editPayload.original,
            { skipLoading: true },
          );
          document.dispatchEvent(new CustomEvent("dataUploaded"));
        } catch (error) {
          console.error("Failed to update split:", error);
          alert("Failed to update split: " + error.message);
          store.setState("savingSplitTransaction", false);
        }
      } else if (editPayload && editPayload.action === "revert") {
        try {
          await ApiService.revertSplit(editPayload.groupId, {
            skipLoading: true,
          });
          document.dispatchEvent(new CustomEvent("dataUploaded"));
        } catch (error) {
          console.error("Failed to revert split:", error);
          alert("Failed to revert split: " + error.message);
          store.setState("savingSplitTransaction", false);
        }
      } else {
        store.setState("savingSplitTransaction", false);
      }
    } catch (error) {
      console.error("Error opening modal:", error);
      store.setState("savingSplitTransaction", false);
    }
  }

  async viewSplitHistory() {
    try {
      const response = await ApiService.getSplitTransactions();

      const modal = new TransactionsSplitHistory();
      const changed = await modal.open(response.data);

      // If user edited/reverted inside the history modal, refresh data
      if (changed) {
        document.dispatchEvent(new CustomEvent("dataUploaded"));
      }
    } catch (error) {
      console.error("Failed to load history:", error);
      alert("Failed to load split history.");
    }
  }

  async openManualModal() {
    if (!this.canEdit) return;
    if (!this.manualModal) {
      this.manualModal = new TransactionsManualModal();
    }
    const data = await this.manualModal.open();
    if (data) {
      this.handleManualAdd(data);
    }
  }

  async handleManualAdd(data) {
    if (!this.canEdit) return;
    try {
      // Wrap single object in array
      await ApiService.saveData([data]);
      document.dispatchEvent(new CustomEvent("dataUploaded"));
    } catch (error) {
      console.error("Failed to add manual transaction", error);
      alert("Failed to add transaction: " + error.message);
    }
  }

  handleSplitsChange(splits) {
    // When splits change, we don't need to do anything complex here locally
    // because App.js will re-process the 'expenses' state.
    // However, if we wanted to force a refresh we could, but the subscription to 'expenses' handles it.
  }

  handleDataChange(data) {
    // The data received here (from 'expenses' store) is already processed/merged.
    this.originalTransactionData = [...data];
    this.transactionData = [...this.originalTransactionData];

    // Reconcile pendingChanges with the new dataset (State is Truth)
    if (this.pendingChanges.size > 0) {
      const rowsToRemove = [];

      this.pendingChanges.forEach((changes, rowId) => {
        const rowIdStr = String(rowId);
        const matchingRow = this.originalTransactionData.find(
          (r) => String(r.row) === rowIdStr,
        );

        if (!matchingRow) {
          // Row no longer exists (e.g. was split/deleted)
          rowsToRemove.push(rowId);
        } else {
          // Row exists, check if changes are still needed
          const keys = Object.keys(changes);
          let hasChanges = false;

          keys.forEach((key) => {
            // If pending value matches new server value, it's not a change anymore
            const serverVal = matchingRow[key] || "";
            const pendingVal = changes[key] || "";

            if (pendingVal !== serverVal) {
              hasChanges = true;
            } else {
              delete changes[key]; // Cleanup redundant field
            }
          });

          // If no actual changes remain for this row, mark for removal
          if (!hasChanges || Object.keys(changes).length === 0) {
            rowsToRemove.push(rowId);
          }
        }
      });

      rowsToRemove.forEach((id) => this.pendingChanges.delete(id));

      // Update the Save Button UI to reflect the cleanup
      this.updateSaveButtonState();
    }

    // If we were tagging, turn it off now that data has reloaded
    if (
      store.getState("isTagging") &&
      store.getState("taggingSource") === "transactions"
    ) {
      store.setState("isTagging", false);
      store.setState("taggingSource", null);
    }

    // If we were saving a split, turn it off now that data has reloaded
    if (store.getState("savingSplitTransaction")) {
      store.setState("savingSplitTransaction", false);
    }

    this.applyFilters();
  }

  updateSaveButtonState() {
    if (!this.canEdit) return;
    const container = this.element.querySelector(
      ".transaction-actions__primary",
    );
    if (!container) return;

    const existingBtn = container.querySelector("#save-changes-btn");
    const hasPendingChanges = this.pendingChanges.size > 0;

    if (hasPendingChanges) {
      const btnText = `Save Changes (${this.pendingChanges.size})`;
      if (existingBtn) {
        existingBtn.textContent = btnText;
      } else {
        // Insert button if it's missing (prepend to actions)
        const newBtn = el(
          "button",
          {
            id: "save-changes-btn",
            className: "action-btn",
            onclick: () => this.savePendingChanges(),
          },
          btnText,
        );
        container.prepend(newBtn);
      }
    } else {
      if (existingBtn) {
        existingBtn.remove();
      }
    }
  }

  handleTagsChange() {
    if (!this.filtersComponent || !this.bulkComponent) return;

    const tagsData = store.getState("tags") || {};

    // Update Main Filters
    this.filtersComponent.renderTagLists(
      tagsData,
      this.selectedCategories,
      this.selectedTrips,
      this.categorySearchTerm,
      this.tripSearchTerm,
    );

    // Update Bulk Dropdowns
    if (this.canEdit) {
      this.bulkComponent.renderBulkTagLists();
    }

    this.updateFiltersDisclosure();
  }

  // --- Filtering ---

  handleSearchChange(type, term) {
    if (type === "Category") this.categorySearchTerm = term.toLowerCase();
    if (type === "Trip/Event") this.tripSearchTerm = term.toLowerCase();
    this.handleTagsChange(); // Re-render lists with new search term
  }

  handleFilterChange(type, tag, checked) {
    const set =
      type === "Category" ? this.selectedCategories : this.selectedTrips;
    if (checked) set.add(tag);
    else set.delete(tag);
    this.handleTagsChange();
    this.applyFilters();
  }

  handleFilterSelectAll(type, tags, checked) {
    const set =
      type === "Category" ? this.selectedCategories : this.selectedTrips;
    tags.forEach((tag) => {
      if (checked) set.add(tag);
      else set.delete(tag);
    });
    this.handleTagsChange();
    this.applyFilters();
  }

  applyFilters() {
    // 1. Filter
    this.transactionData = TransactionsLogic.filterData(
      this.originalTransactionData,
      {
        selectedCategories: this.selectedCategories,
        selectedTrips: this.selectedTrips,
        descriptionSearch: this.descriptionSearchTerm,
      },
    );
    this.reconcileSelectionWithVisibleRows();

    // 2. Render (SortableTable handles sorting)
    if (this.tableComponent) {
      this.syncTableSelection();
      this.tableComponent.update(this.transactionData);
    }

    this.renderMobileTransactionsList();
  }

  // --- Bulk Actions & Selection ---

  toggleSelectionMode(active) {
    if (!this.canEdit) {
      active = false;
    }
    this.selectionMode = active;

    if (!active) {
      this.selectedRows.clear();
      if (this.tableComponent) this.tableComponent.clearSelection();
    }

    if (this.bulkComponent) {
      this.bulkComponent.toggleSelectionMode(active, this.selectedRows.size);
    }

    if (this.tableComponent) {
      this.tableComponent.enableSelection = active;
      this.syncTableSelection();
      // Re-render to show/hide checkboxes
      this.tableComponent.render();
    }

    this.renderMobileTransactionsList();
  }

  handleSelectionChange(selectedIds) {
    this.selectedRows = new Set(selectedIds.map((id) => String(id)));
    this.updateSelectionUI();
  }

  updateSelectionUI() {
    if (this.bulkComponent) {
      this.bulkComponent.updateSelectionCount(this.selectedRows.size);
    }
  }

  async savePendingChanges() {
    if (!this.canEdit) return;
    if (this.pendingChanges.size === 0) return;

    const changesList = [];
    this.pendingChanges.forEach((changes, rowId) => {
      const original = this.originalTransactionData.find(
        (t) => String(t.row) === String(rowId),
      );
      if (original) {
        // Merge pending changes with original data to get full update object
        // But API updateExpenses expects: { row, tripEvent, category }

        // Use original.row to ensure correct type (Number for standard, String for split)
        // instead of rowId which is always a string from Map keys
        const updateObj = { row: original.row };

        if (changes.hasOwnProperty("Trip/Event")) {
          updateObj.tripEvent = changes["Trip/Event"];
        } else {
          updateObj.tripEvent = original["Trip/Event"] || "";
        }

        if (changes.hasOwnProperty("Category")) {
          updateObj.category = changes["Category"];
        } else {
          updateObj.category = original["Category"] || "";
        }

        changesList.push(updateObj);
      }
    });

    if (changesList.length === 0) return;

    store.setState("taggingSource", "transactions");
    store.setState("isTagging", true);

    const CHUNK_SIZE = 20;
    const totalChunks = Math.ceil(changesList.length / CHUNK_SIZE);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = start + CHUNK_SIZE;
        const chunk = changesList.slice(start, end);

        store.setState(
          "taggingProgress",
          `Saving batch ${i + 1} of ${totalChunks}...`,
        );
        await ApiService.updateExpenses(chunk, { skipLoading: true });
      }

      document.dispatchEvent(new CustomEvent("dataUploaded"));
    } catch (error) {
      store.setState("taggingProgress", `Error: ${error.message}`);
      const timeoutId = setTimeout(() => {
        store.setState("isTagging", false);
        store.setState("taggingSource", null);
        const index = this.activeTimeouts.indexOf(timeoutId);
        if (index > -1) this.activeTimeouts.splice(index, 1);
      }, 3000);
      this.activeTimeouts.push(timeoutId);
    }
  }

  async applyBulkTags(tripVal, catVal) {
    if (!this.canEdit) return;
    if (this.selectedRows.size === 0) return;

    const changesList = [];

    this.selectedRows.forEach((rowId) => {
      const original = this.originalTransactionData.find(
        (t) => String(t.row) === String(rowId),
      );
      if (original) {
        let newTripEvent, newCategory;

        // Handle Trip/Event
        if (tripVal === "__REMOVE__") {
          newTripEvent = "";
        } else if (tripVal) {
          newTripEvent = tripVal;
        } else {
          newTripEvent = original["Trip/Event"] || "";
        }

        // Handle Category
        if (catVal === "__REMOVE__") {
          newCategory = "";
        } else if (catVal) {
          newCategory = catVal;
        } else {
          newCategory = original["Category"] || "";
        }

        const currentTripEvent = original["Trip/Event"] || "";
        const currentCategory = original["Category"] || "";

        if (
          newTripEvent !== currentTripEvent ||
          newCategory !== currentCategory
        ) {
          changesList.push({
            row: original.row,
            tripEvent: newTripEvent,
            category: newCategory,
          });
        }
      }
    });

    if (changesList.length === 0) {
      await new ModalComponent().alert("No changes detected.");
      return;
    }

    store.setState("taggingSource", "transactions");
    store.setState("isTagging", true);

    const CHUNK_SIZE = 20;
    const totalChunks = Math.ceil(changesList.length / CHUNK_SIZE);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = start + CHUNK_SIZE;
        const chunk = changesList.slice(start, end);

        store.setState(
          "taggingProgress",
          `Uploading batch ${i + 1} of ${totalChunks}...`,
        );
        await ApiService.updateExpenses(chunk, { skipLoading: true });
      }

      this.toggleSelectionMode(false);
      store.setState("taggingProgress", "Completed!");

      document.dispatchEvent(new CustomEvent("dataUploaded"));
    } catch (error) {
      console.error("Bulk tagging failed:", error);
      store.setState("taggingProgress", `Error: ${error.message}`);
      const timeoutId = setTimeout(() => {
        store.setState("isTagging", false);
        store.setState("taggingSource", null);
        const index = this.activeTimeouts.indexOf(timeoutId);
        if (index > -1) this.activeTimeouts.splice(index, 1);
      }, 3000);
      this.activeTimeouts.push(timeoutId);
    }
  }

  updateProgressDisplay() {
    const progressText = this.element.querySelector("#tagging-progress-text");
    if (progressText) {
      progressText.textContent = store.getState("taggingProgress");
    }
  }
}
export default TransactionsComponent;
