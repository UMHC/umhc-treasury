import { formatCurrency } from "../../core/utils.js";
import SortableTable from "../../shared/sortable-table.component.js";
import {
  createMobileDataCard,
  createMobileDataDetail,
  createMobileDataEmptyState,
  createMobileDataList,
  createMobileDataMetric,
} from "../../shared/mobile-data-card.component.js";
import { el, replace } from "../../core/dom.js";

export default class TagsSubList {
  constructor(element, callbacks) {
    this.element = element;
    this.callbacks = callbacks || {};
    // callbacks: { onBack, onTagClick }
    this.mobileMediaQuery = window.matchMedia("(max-width: 768px)");
    this.isMobile = this.mobileMediaQuery.matches;
    this.currentData = [];
    this.currentTypeName = "";
    this.tableSortField = "tag";
    this.tableSortAsc = true;
    this.table = null;

    this.viewportChangeHandler = () => {
      const nextIsMobile = this.mobileMediaQuery.matches;
      if (nextIsMobile === this.isMobile) return;
      this.isMobile = nextIsMobile;
      if (this.currentTypeName) {
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

  render(typeName, stats, tripTypeMap, tripStatusMap) {
    // Validate parameters
    if (!typeName || !stats || !tripTypeMap || !tripStatusMap) {
      console.warn("TagsSubList: Missing required parameters");
      const errorEl = el("div", {}, "Unable to load data");
      replace(this.element, errorEl);
      return;
    }

    // Filter trips that belong to this type
    const tripStats = stats["Trip/Event"] || {};
    const relevantTrips = Object.keys(tripStats).filter(
      (trip) => tripTypeMap[trip] === typeName,
    );

    const data = relevantTrips
      .map((trip) => {
        const s = tripStats[trip];
        if (!s) return null;
        const income = s.income || 0;
        const expense = s.expense || 0;
        const net = income - expense;
        return {
          tag: trip,
          status: tripStatusMap[trip] || "Active",
          income: income,
          expense: expense,
          net: net,
          count: s.count || 0,
        };
      })
      .filter(Boolean);
    this.currentTypeName = typeName;
    this.currentData = data;

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
            id: "back-sublist-btn",
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
          typeName,
          el(
            "span",
            {
              style: { fontSize: "0.6em", color: "#aaa", fontWeight: "normal" },
            },
            " (Trip Type)",
          ),
        ),
      ),
    );

    const container = el("div", { id: "sublist-table-container" });
    const mobileContainer = el("div", {
      id: "sublist-mobile-container",
      className: "tags-detail-mobile-list",
    });

    const section = el(
      "div",
      { className: "section" },
      header,
      container,
      mobileContainer,
    );

    replace(this.element, section);
    this.renderCurrentView();
  }

  renderCurrentView() {
    const container = this.element.querySelector("#sublist-table-container");
    const mobileContainer = this.element.querySelector(
      "#sublist-mobile-container",
    );
    if (!container || !mobileContainer) return;

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
      replace(container);
      this.renderMobileCards(mobileContainer);
      return;
    }

    replace(mobileContainer);
    const columns = [
      { key: "tag", label: "Trip/Event Name", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "custom",
        class: "text-center",
        render: (item) => {
          const styles = {
            Active: { icon: "◯", color: "#888", title: "Active" },
            Completed: { icon: "✅", color: "#5cb85c", title: "Completed" },
            Investment: { icon: "🚀", color: "#5bc0de", title: "Investment" },
          };
          const s = styles[item.status] || styles["Active"];

          const span = el(
            "span",
            {
              title: s.title,
              style: { color: s.color, fontWeight: "bold", fontSize: "1.2em" },
            },
            s.icon,
          );
          return span;
        },
      },
      {
        key: "income",
        label: "Income",
        type: "currency",
        class: "positive text-right",
      },
      {
        key: "expense",
        label: "Expense",
        type: "currency",
        class: "negative text-right",
      },
      {
        key: "net",
        label: "Net",
        type: "currency",
        class: "text-right",
        render: (item) => {
          const span = el("span", {}, formatCurrency(Math.abs(item.net)));
          if (item.net > 0) span.className = "positive";
          else if (item.net < 0) span.className = "negative";
          else span.className = "neutral";
          return span;
        },
      },
      { key: "count", label: "Uses", type: "number", class: "text-center" },
    ];

    this.table = new SortableTable(container, {
      columns: columns,
      initialSortField: this.tableSortField,
      initialSortAsc: this.tableSortAsc,
      onRowClick: (item) => {
        if (this.callbacks.onTagClick) {
          // When clicking a trip here, we want to go to details for that Trip/Event
          this.callbacks.onTagClick("Trip/Event", item.tag);
        }
      },
    });
    this.table.update(this.currentData);
  }

  getSortedData() {
    const field = this.tableSortField || "tag";
    const ascending = this.tableSortAsc;

    return [...this.currentData].sort((a, b) => {
      let valueA = a[field];
      let valueB = b[field];

      if (typeof valueA === "number" && typeof valueB === "number") {
        if (valueA < valueB) return ascending ? -1 : 1;
        if (valueA > valueB) return ascending ? 1 : -1;
        return 0;
      }

      valueA = String(valueA || "").toLowerCase();
      valueB = String(valueB || "").toLowerCase();
      if (valueA < valueB) return ascending ? -1 : 1;
      if (valueA > valueB) return ascending ? 1 : -1;
      return 0;
    });
  }

  renderMobileCards(container) {
    const data = this.getSortedData();

    if (data.length === 0) {
      replace(
        container,
        createMobileDataEmptyState({
          className: "tags-detail-mobile-empty",
          text: "No trip/event tags found for this type.",
        }),
      );
      return;
    }

    replace(
      container,
      createMobileDataList({
        className: "tags-detail-mobile-card-list",
        children: data.map((item) => this.createMobileCard(item)),
      }),
    );
  }

  createMobileCard(item) {
    const statusConfig = {
      Active: { icon: "◯", color: "#888", title: "Active" },
      Completed: { icon: "✅", color: "#5cb85c", title: "Completed" },
      Investment: { icon: "🚀", color: "#5bc0de", title: "Investment" },
    };
    const status = statusConfig[item.status] || statusConfig.Active;

    const card = createMobileDataCard({
      className: "tags-detail-mobile-card tags-detail-mobile-card--sublist",
      interactive: typeof this.callbacks.onTagClick === "function",
      eyebrow: "Trip/Event",
      title: item.tag,
      headerAside: el(
        "div",
        {
          className: "mobile-data-card__badge tag-mobile-card__count",
          title: `${item.count} uses`,
        },
        `${item.count} use${item.count === 1 ? "" : "s"}`,
      ),
      details: [
        createMobileDataDetail({
          label: "Status",
          value: el(
            "span",
            {
              title: status.title,
              style: {
                color: status.color,
                fontWeight: "bold",
                fontSize: "1.2em",
              },
            },
            status.icon,
          ),
        }),
      ],
      metrics: [
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
      ],
    });

    if (typeof this.callbacks.onTagClick === "function") {
      const openDetails = () =>
        this.callbacks.onTagClick("Trip/Event", item.tag);
      card.addEventListener("click", openDetails);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDetails();
      });
    }

    return card;
  }
}
