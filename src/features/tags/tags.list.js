import { formatCurrency } from "../../core/utils.js";
import ModalComponent from "../../shared/modal.component.js";
import SortableTable from "../../shared/sortable-table.component.js";
import TagSelector from "../../shared/tag-selector.component.js";
import {
  createMobileDataCard,
  createMobileDataDetail,
  createMobileDataEmptyState,
  createMobileDataList,
  createMobileDataMetric,
} from "../../shared/mobile-data-card.component.js";
import { withSearchInputAttributes } from "../../shared/search-input.js";
import { el, replace } from "../../core/dom.js";

export default class TagsList {
  constructor(element, callbacks) {
    this.element = element;
    this.callbacks = callbacks || {};
    // callbacks: { onEditModeToggle, onSave, onTagClick, onTagAdd, onTagDelete, onTagRename, onUpdateTripType, onUpdateTripStatus, onTimeframeChange }

    // Local state for filtering within the list view
    this.searchTerms = {
      "Trip/Event": "",
      Category: "",
      Type: "",
    };
    this.activeTab = "Type"; // Default tab
    this.modal = new ModalComponent();
    this.tagSelector = new TagSelector();
    this.mobileMediaQuery = window.matchMedia("(max-width: 768px)");
    this.isMobile = this.mobileMediaQuery.matches;

    // Table instances
    this.tables = {};

    // Global delegation for interactive clicks inside this component
    this.clickHandler = (e) => this.handleInteractiveClick(e);
    this.element.addEventListener("click", this.clickHandler);

    this.keydownHandler = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        // Only trigger if the target is interactive
        const target = e.target;
        if (
          target.classList.contains("tag-pill") ||
          target.classList.contains("add-tag-placeholder") ||
          target.classList.contains("remove-btn") ||
          target.classList.contains("status-toggle-btn")
        ) {
          e.preventDefault();
          this.handleInteractiveClick(e);
        }
      }
    };
    this.element.addEventListener("keydown", this.keydownHandler);

    this.viewportChangeHandler = () => {
      const nextIsMobile = this.mobileMediaQuery.matches;
      if (nextIsMobile === this.isMobile) return;
      this.isMobile = nextIsMobile;
      this.rerender();
    };

    if (typeof this.mobileMediaQuery.addEventListener === "function") {
      this.mobileMediaQuery.addEventListener(
        "change",
        this.viewportChangeHandler,
      );
    } else if (typeof this.mobileMediaQuery.addListener === "function") {
      this.mobileMediaQuery.addListener(this.viewportChangeHandler);
    }
  }

  destroy() {
    if (this.clickHandler) {
      this.element.removeEventListener("click", this.clickHandler);
    }
    if (this.keydownHandler) {
      this.element.removeEventListener("keydown", this.keydownHandler);
    }
    if (this.modal && typeof this.modal.destroy === "function") {
      this.modal.destroy();
    }
    if (this.tables) {
      Object.values(this.tables).forEach((table) => {
        if (table && typeof table.destroy === "function") {
          table.destroy();
        }
      });
    }
    if (this.tagSelector && typeof this.tagSelector.destroy === "function") {
      this.tagSelector.destroy();
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

  rerender() {
    if (!this.stats || !this.tagsData) return;
    this.render(
      this.isEditMode,
      this.localTags,
      this.queue,
      this.stats,
      this.tripTypeMap,
      this.tripStatusMap,
      this.timeframe,
      this.tagsData,
      this.canEdit,
    );
  }

  render(
    isEditMode,
    localTags,
    queue,
    stats,
    tripTypeMap,
    tripStatusMap,
    timeframe,
    tagsData,
    canEdit = this.canEdit,
  ) {
    this.isEditMode = isEditMode;
    this.localTags = localTags;
    this.queue = queue;
    this.stats = stats;
    this.tripTypeMap = tripTypeMap;
    this.tripStatusMap = tripStatusMap;
    this.timeframe = timeframe;
    this.tagsData = tagsData; // Used for type selector options and initial completed list
    this.canEdit = canEdit;

    let actionButtons = [];
    if (!this.canEdit) {
      actionButtons = [];
    } else if (this.isEditMode) {
      actionButtons.push(
        el(
          "button",
          {
            id: "cancel-tags-btn",
            className: "secondary-btn",
            style: {
              borderColor: "#d9534f",
              color: "#d9534f",
              marginRight: this.isMobile ? "0" : "10px",
            },
            onclick: () => {
              if (this.callbacks.onEditModeToggle) {
                this.callbacks.onEditModeToggle(false);
              }
            },
          },
          "Cancel",
        ),
        el(
          "button",
          {
            id: "save-tags-btn",
            className: "action-btn",
            onclick: () => {
              if (this.callbacks.onSave) {
                this.callbacks.onSave();
              }
            },
          },
          "Save Changes",
        ),
      );
    } else if (this.queue && this.queue.length > 0) {
      actionButtons.push(
        el(
          "button",
          {
            id: "save-tags-btn",
            className: "action-btn",
            onclick: () => {
              if (this.callbacks.onSave) {
                this.callbacks.onSave();
              }
            },
          },
          `Save Changes (${this.queue.length})`,
        ),
      );
    } else {
      actionButtons.push(
        el(
          "button",
          {
            id: "edit-tags-btn",
            className: "secondary-btn",
            onclick: () => {
              if (this.callbacks.onEditModeToggle) {
                this.callbacks.onEditModeToggle(true);
              }
            },
          },
          "Edit Tags",
        ),
      );
    }

    // Define Tabs
    const tabs = [
      { id: "Type", label: "Trip Types" },
      { id: "Trip/Event", label: "Trip/Event Tags" },
      { id: "Category", label: "Category Tags" },
    ];

    // Timeframe Selector options
    const timeframeOptions = [
      { value: "current_month", label: "Current Month" },
      { value: "past_30_days", label: "Past 30 Days" },
      { value: "past_3_months", label: "Past 3 Months" },
      { value: "past_6_months", label: "Past 6 Months" },
      { value: "past_year", label: "Past Year" },
      { value: "all_time", label: "All Time" },
    ];

    const createTimeframeSelect = (id = "tag-timeframe-select") => {
      const timeframeSelect = el(
        "select",
        { id: id, "aria-label": "Timeframe" },
        ...timeframeOptions.map((opt) =>
          el(
            "option",
            { value: opt.value, selected: this.timeframe === opt.value },
            opt.label,
          ),
        ),
      );
      timeframeSelect.addEventListener("change", (e) => {
        if (this.callbacks.onTimeframeChange) {
          this.callbacks.onTimeframeChange(e.target.value);
        }
      });
      return timeframeSelect;
    };

    const createSearchInput = (id = "search-tag") => {
      const searchInput = el(
        "input",
        withSearchInputAttributes({
          id: id,
          "aria-label": "Search Tags",
          className: "tag-search-input column-search",
          style: { flex: "1" },
          dataset: { type: this.activeTab },
          placeholder: `Search ${this.activeTab}...`,
          value: this.searchTerms[this.activeTab] || "",
        }),
      );
      searchInput.addEventListener("input", (e) => {
        const type = e.target.dataset.type;
        this.searchTerms[type] = e.target.value;
        this.renderActiveTable();
      });
      return searchInput;
    };

    const createAddTagButton = () =>
      this.isEditMode && this.canEdit
        ? el(
            "button",
            {
              className: "secondary-btn add-tag-icon-btn",
              dataset: { type: this.activeTab },
              style: {
                width: this.isMobile ? "44px" : "38px",
                minWidth: this.isMobile ? "44px" : "38px",
                padding: "0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2em",
              },
              title: `Add new ${this.activeTab}`,
              onclick: async (e) => {
                try {
                  const type = e.currentTarget.dataset.type;
                  const value = await this.modal.prompt(
                    `Enter new name for ${type} tag:`,
                    "",
                    "Add Tag",
                  );
                  if (value && value.trim() !== "") {
                    if (this.callbacks.onTagAdd)
                      this.callbacks.onTagAdd(type, value.trim());
                  }
                } catch (err) {
                  console.error("Failed to add tag:", err);
                }
              },
            },
            "+",
          )
        : null;

    const createTabsContainer = () =>
      el(
        "div",
        { className: "tags-tabs-container" },
        ...tabs.map((tab) =>
          el(
            "button",
            {
              className: `tab-btn ${this.activeTab === tab.id ? "active" : ""}`,
              dataset: { tab: tab.id },
            },
            tab.label,
          ),
        ),
      );

    const createMobileTabSelect = () => {
      const mobileTabSelect = el(
        "select",
        {
          id: "tag-view-select",
          className: "theme-select tags-mobile-select",
          "aria-label": "Tag view",
        },
        ...tabs.map((tab) =>
          el(
            "option",
            { value: tab.id, selected: this.activeTab === tab.id },
            tab.label,
          ),
        ),
      );
      mobileTabSelect.addEventListener("change", (e) => {
        this.activeTab = e.target.value;
        this.rerender();
      });
      return mobileTabSelect;
    };

    const createDesktopControls = () => {
      const timeframeSelect = createTimeframeSelect();
      const searchInput = createSearchInput();
      const addTagButton = createAddTagButton();

      return {
        headerControls: el(
          "div",
          { className: "header-controls-group" },
          el(
            "div",
            { className: "header-sort-controls" },
            el(
              "div",
              { className: "timeframe-selector" },
              el("label", { for: "tag-timeframe-select" }, "Timeframe: "),
              timeframeSelect,
            ),
          ),
          el("div", { className: "actions" }, ...actionButtons),
        ),
        tabsContainer: createTabsContainer(),
        searchRow: el(
          "div",
          { className: "tags-search-row" },
          searchInput,
          addTagButton,
        ),
      };
    };

    const createMobileToolbar = () => {
      const timeframeSelect = createTimeframeSelect("tag-timeframe-mobile");
      const searchInput = createSearchInput("search-tag-mobile");
      const addTagButton = createAddTagButton();

      return el(
        "div",
        { className: "tags-mobile-toolbar" },
        el(
          "div",
          {
            className:
              "tags-mobile-toolbar__row tags-mobile-toolbar__row--selectors",
          },
          el(
            "label",
            { className: "tags-mobile-field" },
            el("span", { className: "tags-mobile-field__label" }, "View"),
            createMobileTabSelect(),
          ),
          el(
            "label",
            { className: "tags-mobile-field" },
            el("span", { className: "tags-mobile-field__label" }, "Timeframe"),
            timeframeSelect,
          ),
        ),
        el(
          "div",
          {
            className:
              "tags-mobile-toolbar__row tags-mobile-toolbar__row--search",
          },
          el(
            "label",
            { className: "tags-mobile-field tags-mobile-field--search" },
            el("span", { className: "tags-mobile-field__label" }, "Search"),
            searchInput,
          ),
          addTagButton,
        ),
        actionButtons.length > 0
          ? el(
              "div",
              {
                className:
                  "tags-mobile-toolbar__row tags-mobile-toolbar__row--actions",
              },
              ...actionButtons,
            )
          : null,
      );
    };

    const desktopControls = !this.isMobile ? createDesktopControls() : null;
    const mobileToolbar = this.isMobile ? createMobileToolbar() : null;

    const section = el(
      "div",
      { className: "section tags-section" },
      el(
        "div",
        {
          className: "tags-header-actions tags-header-actions--list",
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
          },
        },
        el(
          "div",
          { className: "tags-heading-block" },
          el("h2", {}, "Manage Tags"),
          el(
            "p",
            { className: "tags-heading-caption" },
            "Review and maintain trip, type, and category tags.",
          ),
        ),
        desktopControls ? desktopControls.headerControls : null,
      ),
      mobileToolbar,
      desktopControls ? desktopControls.tabsContainer : null,
      desktopControls ? desktopControls.searchRow : null,
      el(
        "div",
        { className: "tags-container" },
        el("div", { id: "tags-content-container" }),
      ),
    );

    replace(this.element, section);
    this.renderActiveTable();
  }

  renderActiveTable() {
    const type = this.activeTab;
    const container = this.element.querySelector("#tags-content-container");
    if (!container) return;

    // Determine source of tag list (edit mode vs normal)
    const tagsSource = this.isEditMode ? this.localTags : this.tagsData;
    const tagsList = tagsSource && tagsSource[type] ? tagsSource[type] : [];

    // Use virtual tripStatusMap which includes queued changes
    const tripStatusMap = this.tripStatusMap || {};

    const searchTerm = this.searchTerms[type] || "";

    let visibleTags = tagsList.filter((tag) =>
      tag.toLowerCase().includes(searchTerm.toLowerCase()),
    );

    const data = visibleTags.map((tag) => {
      const tagStats = this.stats?.[type]?.[tag] || {
        count: 0,
        income: 0,
        expense: 0,
      };
      const net = tagStats.income - tagStats.expense;

      let row = {
        tag: tag,
        type: type, // for actions
        income: tagStats.income,
        expense: tagStats.expense,
        net: net,
        count: tagStats.count,
      };

      if (type === "Trip/Event") {
        row.tripType = this.tripTypeMap?.[tag] || "";
        row.status = tripStatusMap[tag] || "Active";
      }

      return row;
    });

    if (this.isMobile) {
      this.renderMobileCards(container, type, data);
      return;
    }

    const tableContainer = el("div", { id: "tags-table-container" });
    replace(container, tableContainer);

    const columns = [{ key: "tag", label: "Name", type: "text" }];

    if (type === "Trip/Event") {
      const canChangeStatus = this.canEdit && !this.isEditMode;
      const canAssignType = this.canEdit && !this.isEditMode;
      // Status Column
      const statusLabel = el(
        "span",
        {},
        "Status ",
        el(
          "span",
          {
            className: "info-icon no-sort",
            title: "What do these mean?",
            style: { cursor: "help", fontSize: "0.8em" },
          },
          "ℹ️",
        ),
      );

      columns.push({
        key: "status",
        label: statusLabel,
        type: "custom",
        class: "text-center",
        render: (item) => {
          const status = item.status || "Active";
          const styles = {
            Active: { icon: "◯", color: "#888", title: "Active" },
            Completed: { icon: "✅", color: "#5cb85c", title: "Completed" },
            Investment: { icon: "🚀", color: "#5bc0de", title: "Investment" },
          };
          const s = styles[status] || styles["Active"];

          const span = el(
            "span",
            {
              className: "status-toggle-btn",
              style: {
                color: s.color,
                fontWeight: "bold",
                fontSize: "1.2em",
                cursor: canChangeStatus ? "pointer" : "not-allowed",
                opacity: canChangeStatus ? "1" : "0.7",
              },
              title: canChangeStatus ? `${s.title} - Click to cycle` : s.title,
              dataset: { tag: item.tag, status: status },
              tabIndex: canChangeStatus ? "0" : "-1",
              role: "button",
            },
            s.icon,
          );

          return span;
        },
      });

      columns.push({
        key: "tripType",
        label: "Type",
        type: "custom",
        render: (item) => {
          if (!this.canEdit) {
            if (!item.tripType) {
              return el("span", {}, "");
            }
            return el(
              "span",
              {
                className: "tag-pill",
                style: { cursor: "default" },
              },
              el("span", { className: "tag-text" }, item.tripType),
            );
          }

          // In edit mode this remains non-interactive (original behavior),
          // but keeps the same visual affordances.
          if (!canAssignType) {
            if (item.tripType) {
              return el(
                "span",
                {
                  className: "tag-pill",
                  dataset: { tag: item.tag, type: "Type" },
                  tabIndex: "-1",
                  role: "button",
                  style: {
                    opacity: "0.7",
                    cursor: "not-allowed",
                  },
                },
                el("span", { className: "tag-text" }, item.tripType),
                el(
                  "span",
                  {
                    className: "remove-btn",
                    title: "Remove Type",
                    tabIndex: "-1",
                    role: "button",
                    style: { cursor: "not-allowed" },
                  },
                  "×",
                ),
              );
            }
            return el(
              "span",
              {
                className: "add-tag-placeholder",
                dataset: { tag: item.tag, type: "Type" },
                title: "Add Type",
                tabIndex: "-1",
                role: "button",
                style: {
                  opacity: "0.7",
                  cursor: "not-allowed",
                },
              },
              "+",
            );
          }

          if (item.tripType) {
            return el(
              "span",
              {
                className: "tag-pill",
                dataset: { tag: item.tag, type: "Type" },
                tabIndex: "0",
                role: "button",
                style: { cursor: "pointer" },
              },
              el("span", { className: "tag-text" }, item.tripType),
              el(
                "span",
                {
                  className: "remove-btn",
                  title: "Remove Type",
                  tabIndex: "0",
                  role: "button",
                  style: { cursor: "pointer" },
                },
                "×",
              ),
            );
          }

          return el(
            "span",
            {
              className: "add-tag-placeholder",
              dataset: { tag: item.tag, type: "Type" },
              title: "Add Type",
              tabIndex: "0",
              role: "button",
              style: { cursor: "pointer" },
            },
            "+",
          );
        },
      });
    }

    columns.push(
      {
        key: "income",
        label: "Income",
        type: "currency",
        class: "positive tags-table-num text-right",
      },
      {
        key: "expense",
        label: "Expense",
        type: "currency",
        class: "negative tags-table-num text-right",
      },
      {
        key: "net",
        label: "Net",
        type: "currency",
        class: "tags-table-num text-right",
        render: (item) => {
          const span = el("span", {});
          if (item.net > 0) span.className = "positive";
          else if (item.net < 0) span.className = "negative";
          span.textContent = formatCurrency(Math.abs(item.net));
          return span;
        },
      },
      { key: "count", label: "Uses", type: "number", class: "text-center" },
    );

    if (this.isEditMode && this.canEdit) {
      columns.push({
        key: "actions",
        label: "Actions",
        type: "custom",
        sortable: false,
        class: "text-right tags-actions-cell",
        render: (item) => {
          const div = el(
            "div",
            {},
            el(
              "button",
              {
                className: "icon-btn rename-btn",
                title: "Rename",
                onclick: (e) => {
                  e.stopPropagation();
                  if (this.callbacks.onTagRename)
                    this.callbacks.onTagRename(item.type, item.tag);
                },
              },
              "✏️",
            ),
            document.createTextNode(" "),
            el(
              "button",
              {
                className: "icon-btn delete-btn",
                title: "Delete",
                onclick: (e) => {
                  e.stopPropagation();
                  if (this.callbacks.onTagDelete)
                    this.callbacks.onTagDelete(item.type, item.tag);
                },
              },
              "🗑️",
            ),
          );
          return div;
        },
      });
    }

    let initialSortField = "tag";
    let initialSortAsc = true;

    // Preserve sort state if table already exists
    if (this.tables[type]) {
      initialSortField = this.tables[type].sortField;
      initialSortAsc = this.tables[type].sortAsc;

      // Destroy old table before creating new one
      if (typeof this.tables[type].destroy === "function") {
        this.tables[type].destroy();
      }
    }

    const table = new SortableTable(tableContainer, {
      columns: columns,
      initialSortField: initialSortField,
      initialSortAsc: initialSortAsc,
      onRowClick: (item, event) => {
        // Check if the click originated from an interactive element within the row
        const target = event.target;
        const isInteractiveElement =
          target.classList.contains("add-tag-placeholder") ||
          target.closest(".tag-pill") ||
          target.classList.contains("remove-btn") ||
          target.classList.contains("status-toggle-btn");

        if (
          !isInteractiveElement &&
          !this.isEditMode &&
          this.callbacks.onTagClick
        ) {
          this.callbacks.onTagClick(type, item.tag);
        }
      },
    });
    table.update(data);

    // Store reference for potential future updates
    this.tables[type] = table;
  }

  renderMobileCards(container, type, data) {
    if (data.length === 0) {
      replace(
        container,
        createMobileDataEmptyState({
          className: "tags-mobile-empty-state",
          text: "No matching tags found.",
        }),
      );
      return;
    }

    replace(
      container,
      createMobileDataList({
        className: "tags-mobile-card-list",
        children: data.map((item) => this.createMobileCard(type, item)),
      }),
    );
  }

  createMobileCard(type, item) {
    const status = item.status || "Active";
    const canOpenDetails =
      !this.isEditMode && typeof this.callbacks.onTagClick === "function";

    const details = [];

    if (type === "Trip/Event") {
      details.push(
        createMobileDataDetail({
          label: "Status",
          value: el(
            "span",
            {
              className: "status-toggle-btn",
              style: {
                color:
                  {
                    Active: "#888",
                    Completed: "#5cb85c",
                    Investment: "#5bc0de",
                  }[status] || "#888",
                fontWeight: "bold",
                fontSize: "1.2em",
                cursor:
                  this.canEdit && !this.isEditMode ? "pointer" : "default",
              },
              title:
                this.canEdit && !this.isEditMode
                  ? `${status} - Click to cycle`
                  : status,
              dataset: { tag: item.tag, status: status },
              tabindex: this.canEdit && !this.isEditMode ? "0" : "-1",
              role: "button",
            },
            { Active: "◯", Completed: "✅", Investment: "🚀" }[status] || "◯",
          ),
        }),
        createMobileDataDetail({
          label: "Type",
          value: this.createTripTypeControl(item),
        }),
      );
    }

    const metrics = [
      createMobileDataMetric({
        label: "Income",
        value: formatCurrency(item.income),
        tone: "positive",
      }),
      createMobileDataMetric({
        label: "Expense",
        value: formatCurrency(item.expense),
        tone: "negative",
      }),
      createMobileDataMetric({
        label: "Net",
        value: formatCurrency(Math.abs(item.net)),
        tone: item.net > 0 ? "positive" : item.net < 0 ? "negative" : "",
      }),
    ];

    const actions =
      this.isEditMode && this.canEdit
        ? [
            el(
              "button",
              {
                className: "icon-btn rename-btn tag-mobile-card__action-btn",
                title: "Rename",
                onclick: (e) => {
                  e.stopPropagation();
                  if (this.callbacks.onTagRename)
                    this.callbacks.onTagRename(item.type, item.tag);
                },
              },
              "Rename",
            ),
            el(
              "button",
              {
                className: "icon-btn delete-btn tag-mobile-card__action-btn",
                title: "Delete",
                onclick: (e) => {
                  e.stopPropagation();
                  if (this.callbacks.onTagDelete)
                    this.callbacks.onTagDelete(item.type, item.tag);
                },
              },
              "Delete",
            ),
          ]
        : [];

    const card = createMobileDataCard({
      className: "tag-mobile-card",
      interactive: canOpenDetails,
      eyebrow: type === "Type" ? "Trip Type" : type,
      title: item.tag,
      headerAside: el(
        "div",
        {
          className: "mobile-data-card__badge tag-mobile-card__count",
        },
        `${item.count} use${item.count === 1 ? "" : "s"}`,
      ),
      details,
      metrics,
      actions,
    });

    if (canOpenDetails) {
      const openDetails = (event) => {
        const target = event.target;
        const isInteractiveElement =
          target.classList.contains("add-tag-placeholder") ||
          target.closest(".tag-pill") ||
          target.classList.contains("remove-btn") ||
          target.classList.contains("status-toggle-btn");

        if (!isInteractiveElement) {
          this.callbacks.onTagClick(type, item.tag);
        }
      };

      card.addEventListener("click", openDetails);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDetails(event);
      });
    }

    return card;
  }

  createTripTypeControl(item) {
    if (!this.canEdit) {
      return item.tripType
        ? el(
            "span",
            {
              className: "tag-pill",
              style: { cursor: "default" },
            },
            el("span", { className: "tag-text" }, item.tripType),
          )
        : el("span", { className: "tag-mobile-card__meta-value" }, "No Type");
    }

    if (this.isEditMode) {
      return item.tripType
        ? el(
            "span",
            {
              className: "tag-pill",
              dataset: { tag: item.tag, type: "Type" },
              tabIndex: "-1",
              role: "button",
              style: {
                opacity: "0.7",
                cursor: "not-allowed",
              },
            },
            el("span", { className: "tag-text" }, item.tripType),
          )
        : el(
            "span",
            {
              className: "tag-mobile-card__meta-value",
              style: { opacity: "0.7" },
            },
            "No Type",
          );
    }

    if (item.tripType) {
      return el(
        "span",
        {
          className: "tag-pill",
          dataset: { tag: item.tag, type: "Type" },
          tabIndex: "0",
          role: "button",
          style: { cursor: "pointer" },
        },
        el("span", { className: "tag-text" }, item.tripType),
        el(
          "span",
          {
            className: "remove-btn",
            title: "Remove Type",
            tabIndex: "0",
            role: "button",
            style: { cursor: "pointer" },
          },
          "×",
        ),
      );
    }

    return el(
      "span",
      {
        className: "add-tag-placeholder",
        dataset: { tag: item.tag, type: "Type" },
        title: "Add Type",
        tabIndex: "0",
        role: "button",
        style: { cursor: "pointer" },
      },
      "+ Add Type",
    );
  }
  handleInteractiveClick(e) {
    const target = e.target;

    // Status Info Icon
    if (target.classList.contains("info-icon")) {
      e.stopPropagation();
      const message = el(
        "div",
        { style: { textAlign: "left" } },
        el("p", {}, el("strong", {}, "Status Meanings:")),
        el(
          "ul",
          { style: { listStyle: "none", paddingLeft: "0" } },
          el(
            "li",
            { style: { marginBottom: "8px" } },
            el(
              "span",
              {
                style: { color: "#888", fontWeight: "bold", fontSize: "1.2em" },
              },
              "◯",
            ),
            el("strong", {}, " Active:"),
            " The trip or event is currently being planned or is in progress.",
          ),
          el(
            "li",
            { style: { marginBottom: "8px" } },
            el(
              "span",
              {
                style: {
                  color: "#5cb85c",
                  fontWeight: "bold",
                  fontSize: "1.2em",
                },
              },
              "✅",
            ),
            el("strong", {}, " Completed:"),
            " The trip is finished and all expenses are finalized.",
          ),
          el(
            "li",
            { style: { marginBottom: "8px" } },
            el(
              "span",
              {
                style: {
                  color: "#5bc0de",
                  fontWeight: "bold",
                  fontSize: "1.2em",
                },
              },
              "🚀",
            ),
            el("strong", {}, " Investment:"),
            " This tag tracks a long-term investment or asset, not a regular trip.",
          ),
        ),
        el(
          "p",
          {},
          el(
            "em",
            {},
            "Click the status icon to cycle through these options (not available in Edit Mode).",
          ),
        ),
      );

      this.modal.alert(message, "Trip/Event Status Legend");
      return;
    }

    // Tab Switching
    if (target.classList.contains("tab-btn")) {
      this.activeTab = target.dataset.tab;
      this.render(
        this.isEditMode,
        this.localTags,
        this.queue,
        this.stats,
        this.tripTypeMap,
        this.tripStatusMap,
        this.timeframe,
        this.tagsData,
        this.canEdit,
      );
      return;
    }

    // Toggle Status
    if (
      target.classList.contains("status-toggle-btn") &&
      !this.isEditMode &&
      this.canEdit
    ) {
      e.stopPropagation();
      const tag = target.dataset.tag;
      const currentStatus = target.dataset.status;
      const nextStatus =
        {
          Active: "Completed",
          Completed: "Investment",
          Investment: "Active",
        }[currentStatus] || "Active";

      if (this.callbacks.onUpdateTripStatus) {
        this.callbacks.onUpdateTripStatus(tag, nextStatus);
      }
      return;
    }

    // Remove Tag
    if (target.classList.contains("remove-btn")) {
      e.stopPropagation();
      if (this.isEditMode || !this.canEdit) return;
      const pill = target.closest(".tag-pill");
      if (!pill) return;
      const tag = pill.dataset.tag;
      if (this.callbacks.onUpdateTripType) {
        this.callbacks.onUpdateTripType(tag, ""); // Clear type
      }
      return;
    }

    // Add Tag (+)
    if (target.classList.contains("add-tag-placeholder")) {
      e.stopPropagation();
      if (this.isEditMode || !this.canEdit) return;
      const tag = target.dataset.tag;
      this.openTagSelector(target, tag, "");
      return;
    }

    // Edit Tag (Click pill body)
    const pill = target.closest(".tag-pill");
    if (pill) {
      e.stopPropagation();
      if (this.isEditMode || !this.canEdit) return;
      const tag = pill.dataset.tag;
      const tagTextEl = pill.querySelector(".tag-text");
      if (!tagTextEl) return;
      const currentVal = tagTextEl.textContent;
      this.openTagSelector(pill, tag, currentVal);
    }
  }

  openTagSelector(target, tag, currentVal) {
    if (!this.canEdit) return;
    const typeOptions = this.tagsData?.["Type"] || [];
    this.tagSelector.show(
      target,
      "Type",
      currentVal,
      (newType) => {
        if (this.callbacks.onUpdateTripType)
          this.callbacks.onUpdateTripType(tag, newType);
      },
      typeOptions,
    );
  }
}
