import store from "../../core/state.js";
import { formatCurrency, parseAmount, parseDate } from "../../core/utils.js";
import SortableTable from "../../shared/sortable-table.component.js";
import { calculateDetailStats } from "./tags.logic.js";
import {
  createMobileDataCard,
  createMobileDataDetail,
  createMobileDataEmptyState,
  createMobileDataList,
  createMobileDataMetric,
} from "../../shared/mobile-data-card.component.js";
import { el, replace } from "../../core/dom.js";

export default class TagsDetails {
  constructor(element, callbacks) {
    this.element = element;
    this.callbacks = callbacks || {}; // { onBack, onAddTransactions, onAddTagsToType }

    this.tagType = null;
    this.tagName = null;
    this.transactionsData = [];
    this.mobileMediaQuery = window.matchMedia("(max-width: 768px)");
    this.isMobile = this.mobileMediaQuery.matches;
    this.tableSortField = "Date";
    this.tableSortAsc = false;
    this.table = null;
    this.canEdit = true;

    this.viewportChangeHandler = () => {
      const nextIsMobile = this.mobileMediaQuery.matches;
      if (nextIsMobile === this.isMobile) return;
      this.isMobile = nextIsMobile;
      if (this.tagType && this.tagName) {
        this.renderCurrentView();
      }
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
    if (this.table && typeof this.table.destroy === "function") {
      this.table.destroy();
      this.table = null;
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

  getTransactionNet(item) {
    return parseAmount(item.Income) - parseAmount(item.Expense);
  }

  render(tagType, tagName, canEdit = true) {
    this.tagType = tagType;
    this.tagName = tagName;
    this.canEdit = canEdit;

    const allExpenses = store.getState("expenses") || [];

    // Filter transactions based on tag type
    if (tagType === "Type") {
      // For "Type" tags, we need to find all expenses that have a Trip/Event which is of this Type.
      const tripTypeMap = store.getState("tags")?.TripTypeMap || {};
      this.transactionsData = allExpenses.filter((item) => {
        const trip = item["Trip/Event"];
        return trip && tripTypeMap[trip] === tagName;
      });
    } else {
      this.transactionsData = allExpenses.filter(
        (item) => item[tagType] === tagName,
      );
    }

    // Calculate stats
    const stats = calculateDetailStats(this.transactionsData);
    const netStr = formatCurrency(Math.abs(stats.income - stats.expense));
    const netClass =
      stats.income - stats.expense > 0
        ? "positive"
        : stats.income - stats.expense < 0
          ? "negative"
          : "";

    // Contextual Action Button
    let actionButton = null;
    if (canEdit && tagType === "Type") {
      // Use save-changes-btn for orange background
      actionButton = el(
        "button",
        {
          id: "add-tags-to-type-btn",
          className: "action-btn",
          onclick: () => {
            if (this.callbacks.onAddTagsToType)
              this.callbacks.onAddTagsToType(this.tagName);
          },
        },
        "Add Trip/Events",
      );
    } else if (canEdit) {
      actionButton = el(
        "button",
        {
          id: "add-transactions-btn",
          className: "action-btn",
          onclick: () => {
            if (this.callbacks.onAddTransactions)
              this.callbacks.onAddTransactions(this.tagType, this.tagName);
          },
        },
        "Add Transactions",
      );
    }

    const header = el(
      "div",
      {
        className: "tags-header-actions",
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        },
      },
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "15px" } },
        el(
          "button",
          {
            id: "back-tags-btn",
            className: "secondary-btn",
            style: { padding: "5px 10px" },
            onclick: () => {
              if (this.callbacks.onBack) this.callbacks.onBack();
            },
          },
          "← Back",
        ),
        el(
          "h2",
          { style: { margin: "0" } },
          tagName,
          el(
            "span",
            {
              style: { fontSize: "0.6em", color: "#aaa", fontWeight: "normal" },
            },
            ` (${tagType})`,
          ),
        ),
      ),
      actionButton,
    );

    const summary = el(
      "div",
      {
        className: "stats-summary",
        style: {
          display: "flex",
          gap: "30px",
          marginBottom: "20px",
          background: "rgba(0,0,0,0.2)",
          padding: "15px",
          borderRadius: "8px",
        },
      },
      el(
        "div",
        {},
        el("div", { style: { fontSize: "0.9em", color: "#aaa" } }, "Count"),
        el("div", { style: { fontSize: "1.2em" } }, stats.count),
      ),
      el(
        "div",
        {},
        el(
          "div",
          { style: { fontSize: "0.9em", color: "#aaa" } },
          "Total Income",
        ),
        el(
          "div",
          { style: { fontSize: "1.2em" }, className: "positive" },
          formatCurrency(stats.income),
        ),
      ),
      el(
        "div",
        {},
        el(
          "div",
          { style: { fontSize: "0.9em", color: "#aaa" } },
          "Total Expense",
        ),
        el(
          "div",
          { style: { fontSize: "1.2em" }, className: "negative" },
          formatCurrency(stats.expense),
        ),
      ),
      el(
        "div",
        {},
        el("div", { style: { fontSize: "0.9em", color: "#aaa" } }, "Net"),
        el(
          "div",
          { style: { fontSize: "1.2em" }, className: netClass },
          netStr,
        ),
      ),
    );

    const tableContainer = el("div", {
      id: "tag-transactions-table-container",
    });
    const mobileContainer = el("div", {
      id: "tag-transactions-mobile-container",
      className: "tags-detail-mobile-list",
    });

    const section = el(
      "div",
      { className: "section" },
      header,
      summary,
      tableContainer,
      mobileContainer,
    );

    replace(this.element, section);
    this.renderCurrentView();
  }

  renderCurrentView() {
    const tableContainer = this.element.querySelector(
      "#tag-transactions-table-container",
    );
    const mobileContainer = this.element.querySelector(
      "#tag-transactions-mobile-container",
    );
    if (!tableContainer || !mobileContainer) return;

    if (this.table && typeof this.table.destroy === "function") {
      this.tableSortField = this.table.sortField || this.tableSortField;
      this.tableSortAsc =
        this.table.sortAsc !== undefined
          ? this.table.sortAsc
          : this.tableSortAsc;
      this.table.destroy();
      this.table = null;
    }

    if (this.isMobile) {
      replace(tableContainer);
      this.renderMobileCards(mobileContainer);
      return;
    }

    replace(mobileContainer);

    // Render Table
    this.table = new SortableTable(tableContainer, {
      columns: [
        { key: "Date", label: "Date", type: "date" },
        { key: "Description", label: "Description", type: "text" },
        { key: "Trip/Event", label: "Trip/Event", type: "text" },
        { key: "Category", label: "Category", type: "text" },
        {
          key: "Amount",
          label: "Amount",
          type: "custom",
          sortValue: (item) => this.getTransactionNet(item),
          render: (item) => {
            const net = this.getTransactionNet(item);

            const classType = net > 0 ? "positive" : net < 0 ? "negative" : "";
            const span = el("span", {}, formatCurrency(Math.abs(net)));
            if (classType) span.className = classType;
            return span;
          },
        },
      ],
      initialSortField: this.tableSortField,
      initialSortAsc: this.tableSortAsc,
    });
    this.table.update(this.transactionsData);
  }

  getSortedTransactions() {
    const field = this.tableSortField || "Date";
    const ascending = this.tableSortAsc;

    return [...this.transactionsData].sort((a, b) => {
      let valueA;
      let valueB;

      if (field === "Amount") {
        valueA = this.getTransactionNet(a);
        valueB = this.getTransactionNet(b);
      } else if (field === "Date") {
        const dateA = parseDate(a.Date);
        const dateB = parseDate(b.Date);
        valueA = !dateA || isNaN(dateA.getTime()) ? Infinity : dateA.getTime();
        valueB = !dateB || isNaN(dateB.getTime()) ? Infinity : dateB.getTime();
      } else {
        valueA = String(a[field] || "").toLowerCase();
        valueB = String(b[field] || "").toLowerCase();
      }

      if (valueA < valueB) return ascending ? -1 : 1;
      if (valueA > valueB) return ascending ? 1 : -1;
      return 0;
    });
  }

  renderMobileCards(container) {
    const data = this.getSortedTransactions();

    if (data.length === 0) {
      replace(
        container,
        createMobileDataEmptyState({
          className: "tags-detail-mobile-empty",
          text: "No transactions found for this tag.",
        }),
      );
      return;
    }

    replace(
      container,
      createMobileDataList({
        className: "tags-detail-mobile-card-list",
        children: data.map((item) => this.createTransactionMobileCard(item)),
      }),
    );
  }

  createTransactionMobileCard(item) {
    const net = this.getTransactionNet(item);

    return createMobileDataCard({
      className: "tags-detail-mobile-card tags-detail-mobile-card--transaction",
      eyebrow: this.tagType,
      title: item.Description || "Transaction",
      headerAside: item["Split Group ID"]
        ? el(
            "div",
            {
              className:
                "mobile-data-card__badge tags-detail-mobile-card__split-badge",
            },
            "Split",
          )
        : null,
      details: [
        createMobileDataDetail({
          label: "Date",
          value: item.Date || "",
        }),
        createMobileDataDetail({
          label: "Trip/Event",
          value: item["Trip/Event"] || "None",
        }),
        createMobileDataDetail({
          label: "Category",
          value: item.Category || "None",
        }),
      ],
      metrics: [
        createMobileDataMetric({
          label: "Amount",
          value: formatCurrency(Math.abs(net)),
          tone: net > 0 ? "positive" : net < 0 ? "negative" : "",
        }),
      ],
    });
  }
}
