// src/features/dashboard/dashboard.component.js
import store from "../../core/state.js";
import SortableTable from "../../shared/sortable-table.component.js";
import {
  createMobileDataCard,
  createMobileDataDetail,
  createMobileDataEmptyState,
  createMobileDataList,
  createMobileDataMetric,
} from "../../shared/mobile-data-card.component.js";
import {
  formatCurrency,
  filterTransactionsByTimeframe,
  parseDate,
  parseAmount,
} from "../../core/utils.js";
import { calculateFinancials } from "../../core/financial.logic.js";
import { el, replace } from "../../core/dom.js";

class DashboardComponent {
  constructor(element) {
    this.element = element;
    this.timeframe = "past_30_days"; // Default timeframe
    this.mobileMediaQuery = window.matchMedia("(max-width: 768px)");
    this.isMobile = this.mobileMediaQuery.matches;
    this.tableSortField = "Date";
    this.tableSortAsc = false;
    this.filteredTransactions = [];
    this.render();
    this.subscriptions = [];
    this.subscriptions.push(
      store.subscribe("expenses", () => this.calculateAndDisplayStats()),
    );
    this.subscriptions.push(
      store.subscribe("openingBalance", () => this.calculateAndDisplayStats()),
    );
    this.subscriptions.push(
      store.subscribe("accessibilityMode", () =>
        this.handleAccessibilityChange(),
      ),
    );

    this.viewportChangeHandler = () => {
      const nextIsMobile = this.mobileMediaQuery.matches;
      if (nextIsMobile === this.isMobile) return;
      this.isMobile = nextIsMobile;
      this.renderRecentTransactionsView();
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
    if (
      this.transactionsTable &&
      typeof this.transactionsTable.destroy === "function"
    ) {
      this.transactionsTable.destroy();
    }
    if (typeof this.mobileMediaQuery.removeEventListener === "function") {
      this.mobileMediaQuery.removeEventListener(
        "change",
        this.viewportChangeHandler,
      );
    } else if (typeof this.mobileMediaQuery.removeListener === "function") {
      this.mobileMediaQuery.removeListener(this.viewportChangeHandler);
    }
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  handleAccessibilityChange() {
    const isAccessible = store.getState("accessibilityMode");

    // Update button state without full re-render
    const btn = this.element.querySelector(".accessibility-toggle");
    if (btn) {
      if (isAccessible) {
        btn.classList.add("active");
        btn.textContent = "👁️ Colourblind Access: On";
      } else {
        btn.classList.remove("active");
        btn.textContent = "👁️ Colourblind Access: Off";
      }
    }

    // Re-render table rows to update symbols, preserving sort state
    if (this.transactionsTable) {
      this.transactionsTable.render();
    }
    if (this.isMobile) {
      this.renderMobileRecentTransactions();
    }
  }

  render() {
    // Timeframe selector options
    const options = [
      { value: "current_month", text: "Current Month" },
      { value: "past_30_days", text: "Past 30 Days" },
      { value: "past_3_months", text: "Past 3 Months" },
      { value: "past_6_months", text: "Past 6 Months" },
      { value: "past_year", text: "Past Year" },
      { value: "all_time", text: "All Time" },
    ];

    // Mark selected option based on current state
    options.forEach((opt) => {
      if (opt.value === this.timeframe) {
        opt.selected = true;
      }
    });

    this.timeframeSelect = el(
      "select",
      { id: "dashboard-timeframe-select", "aria-label": "Timeframe" },
      ...options.map((opt) =>
        el("option", { value: opt.value, selected: opt.selected }, opt.text),
      ),
    );

    // Attach listener immediately
    this.timeframeSelect.addEventListener("change", (e) => {
      this.timeframe = e.target.value;
      this.calculateAndDisplayStats();
      this.updateTitle();
    });

    this.currentBalanceEl = el(
      "p",
      { id: "current-balance", className: "stat-value" },
      "£0.00",
    );
    this.totalIncomeEl = el(
      "p",
      { id: "total-income", className: "stat-value" },
      "£0.00",
    );
    this.totalExpensesEl = el(
      "p",
      { id: "total-expenses", className: "stat-value" },
      "£0.00",
    );
    this.netChangeEl = el(
      "p",
      { id: "net-change", className: "stat-value" },
      "£0.00",
    );

    this.transactionCountSubtitleEl = el("div", {
      className: "transaction-count-subtitle",
    });
    this.recentTransactionsContentEl = el("div", {
      id: "recent-transactions-content",
    });

    this.loadedContent = el(
      "div",
      { id: "dashboard-loaded-content" },
      el(
        "div",
        { className: "stats-container" },
        el(
          "div",
          { className: "stat-card" },
          el("h3", {}, "Current Balance"),
          this.currentBalanceEl,
        ),
        el(
          "div",
          { className: "stat-card" },
          el("h3", {}, "Total Income"),
          this.totalIncomeEl,
        ),
        el(
          "div",
          { className: "stat-card" },
          el("h3", {}, "Total Expenses"),
          this.totalExpensesEl,
        ),
        el(
          "div",
          { className: "stat-card" },
          el("h3", {}, "Net Change"),
          this.netChangeEl,
        ),
      ),
      el(
        "div",
        { className: "section" },
        el(
          "div",
          { className: "transactions-header" },
          el("h2", {}, "Recent Transactions"),
          this.transactionCountSubtitleEl,
        ),
        this.recentTransactionsContentEl,
      ),
    );

    const container = el(
      "div",
      { id: "dashboard-content-wrapper" },
      el(
        "div",
        {
          className: "dashboard-header",
          style: {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            marginBottom: "15px",
            gap: "15px",
          },
        },
        el(
          "button",
          {
            className: `secondary-btn accessibility-toggle ${
              store.getState("accessibilityMode") ? "active" : ""
            }`,
            title: "Toggle Accessibility Mode (Symbols for +/-)",
            onclick: () => {
              const current = store.getState("accessibilityMode");
              store.setState("accessibilityMode", !current);
            },
          },
          `👁️ Colourblind Access: ${
            store.getState("accessibilityMode") ? "On" : "Off"
          }`,
        ),
        el(
          "div",
          { className: "timeframe-selector" },
          el("label", { for: "dashboard-timeframe-select" }, "Timeframe: "),
          this.timeframeSelect,
        ),
      ),
      this.loadedContent,
    );

    replace(this.element, container);

    this.initializeTransactionsView();

    // Re-calculate stats to populate the new elements
    this.calculateAndDisplayStats();
  }

  initializeTransactionsView() {
    if (
      this.transactionsTable &&
      typeof this.transactionsTable.destroy === "function"
    ) {
      this.tableSortField =
        this.transactionsTable.sortField || this.tableSortField;
      this.tableSortAsc =
        this.transactionsTable.sortAsc !== undefined
          ? this.transactionsTable.sortAsc
          : this.tableSortAsc;
      this.transactionsTable.destroy();
    }

    this.transactionsTable = null;

    if (!this.isMobile) {
      this.transactionsTable = new SortableTable(
        this.recentTransactionsContentEl,
        {
          columns: [
            { key: "Date", label: "Date", type: "date" },
            { key: "Description", label: "Description", type: "text" },
            {
              key: "Amount",
              label: "Amount (£)",
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
          initialSortField: this.tableSortField,
          initialSortAsc: this.tableSortAsc,
        },
      );
    }
  }

  getTransactionNet(item) {
    return parseAmount(item.Income) - parseAmount(item.Expense);
  }

  getSortedRecentTransactions() {
    const field = this.tableSortField || "Date";
    const ascending = this.tableSortAsc;

    if (field === "Amount") {
      return [...this.filteredTransactions].sort((a, b) => {
        const delta = this.getTransactionNet(a) - this.getTransactionNet(b);
        if (delta < 0) return ascending ? -1 : 1;
        if (delta > 0) return ascending ? 1 : -1;
        return 0;
      });
    }

    if (this.transactionsTable) {
      this.transactionsTable.data = [...this.filteredTransactions];
      this.transactionsTable.sortField = field;
      this.transactionsTable.sortAsc = ascending;
      this.transactionsTable.sortData();
      return [...this.transactionsTable.data];
    }

    return [...this.filteredTransactions].sort((a, b) => {
      let valueA;
      let valueB;

      if (field === "Date") {
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

  createRecentTransactionCard(item) {
    const net = this.getTransactionNet(item);

    return createMobileDataCard({
      className: "dashboard-transaction-card",
      eyebrow: "Transaction",
      title: item.Description || "Transaction",
      details: [
        createMobileDataDetail({
          label: "Date",
          value: item.Date || "",
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

  renderMobileRecentTransactions() {
    if (!this.isMobile) return;

    if (this.filteredTransactions.length === 0) {
      replace(
        this.recentTransactionsContentEl,
        createMobileDataEmptyState({
          className: "dashboard-transactions-empty",
          text: "No transactions found for this timeframe.",
        }),
      );
      return;
    }

    replace(
      this.recentTransactionsContentEl,
      createMobileDataList({
        className: "dashboard-transactions-mobile-list",
        children: this.getSortedRecentTransactions().map((item) =>
          this.createRecentTransactionCard(item),
        ),
      }),
    );
  }

  renderRecentTransactionsView() {
    this.initializeTransactionsView();

    if (this.isMobile) {
      this.renderMobileRecentTransactions();
      return;
    }

    if (this.transactionsTable) {
      this.transactionsTable.update(this.filteredTransactions);
    }
  }

  updateTitle() {
    const titleEl = document.getElementById("page-title");
    if (titleEl) {
      titleEl.textContent = `Dashboard - ${this.getTimeframeLabel(
        this.timeframe,
      )}`;
    }
  }

  calculateAndDisplayStats() {
    const data = store.getState("expenses") || [];
    const openingBalance = store.getState("openingBalance") || 0;
    const filteredData = filterTransactionsByTimeframe(data, this.timeframe);

    let currentBalance = 0;
    let hasBalanceError = false;
    try {
      ({ currentBalance } = calculateFinancials(openingBalance, data));
    } catch (error) {
      console.error("Dashboard: Error calculating financials", error);
      hasBalanceError = true;
    }

    let totalIncome = 0;
    let totalExpenses = 0;

    filteredData.forEach((item) => {
      totalIncome += parseAmount(item.Income);
      totalExpenses += parseAmount(item.Expense);
    });

    const netChange = totalIncome - totalExpenses;

    if (hasBalanceError) {
      this.currentBalanceEl.textContent = "⚠️ Error";
      this.currentBalanceEl.title = "Failed to calculate balance";
    } else {
      this.currentBalanceEl.textContent = `£${formatCurrency(currentBalance)}`;
      this.currentBalanceEl.removeAttribute("title");
    }
    this.totalIncomeEl.textContent = `£${formatCurrency(totalIncome)}`;
    this.totalExpensesEl.textContent = `£${formatCurrency(totalExpenses)}`;
    this.netChangeEl.textContent = `£${formatCurrency(netChange)}`;

    this.displayRecentTransactions(filteredData);
  }

  displayRecentTransactions(transactions) {
    this.filteredTransactions = [...transactions];
    this.updateTransactionCountHeader(transactions.length);
    this.renderRecentTransactionsView();
  }

  updateTransactionCountHeader(count) {
    if (this.transactionCountSubtitleEl) {
      const timeframeLabel = this.getTimeframeLabel(
        this.timeframe,
      ).toLowerCase();
      const transactionWord = count === 1 ? "transaction" : "transactions";
      this.transactionCountSubtitleEl.textContent = `${count} ${transactionWord} in the ${timeframeLabel}`;
    }
  }

  getTimeframeLabel(timeframe) {
    const labels = {
      current_month: "Current Month",
      past_30_days: "Past 30 Days",
      past_3_months: "Past 3 Months",
      past_6_months: "Past 6 Months",
      past_year: "Past Year",
      all_time: "All Time",
    };
    return labels[timeframe] || "Past 30 Days";
  }
}

export default DashboardComponent;
