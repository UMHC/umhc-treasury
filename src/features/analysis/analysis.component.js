import store from "../../core/state.js";
import {
  formatCurrency,
  formatDateForInput,
  debounce,
} from "../../core/utils.js";
import ModalComponent from "../../shared/modal.component.js";
import AnalysisLogic from "./analysis.logic.js";
import { calculateFinancials } from "../../core/financial.logic.js";

import AnalysisControls from "./analysis.controls.js";
import AnalysisFilters from "./analysis.filters.js";
import AnalysisChart from "./analysis.chart.js";
import AnalysisTable from "./analysis.table.js";
import { el, replace } from "../../core/dom.js";

const TIMEFRAME_LABELS = {
  current_month: "Current Month",
  past_30_days: "Past 30 Days",
  past_3_months: "Past 3 Months",
  past_6_months: "Past 6 Months",
  past_year: "Past Year",
  all_time: "All Time",
  custom: "Custom",
};

const STATUS_LABELS = {
  All: "All Trips",
  Active: "Active Only",
  Completed: "Completed Only",
  Investment: "Investment Only",
};

const METRIC_LABELS = {
  balance: "Balance",
  income: "Income",
  expense: "Expenses",
  net: "Net Income",
};

const CHART_TYPE_LABELS = {
  bar: "Bar",
  line: "Line",
  pie: "Pie",
  doughnut: "Doughnut",
};

const GROUP_LABELS = {
  date: "Date",
  category: "Category",
  trip: "Trip",
  tripType: "Trip Type",
  none: "None",
};

const TIME_UNIT_LABELS = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

const formatSummaryDate = (value) => {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

class AnalysisComponent {
  constructor(element) {
    this.element = element;
    this.modal = new ModalComponent();
    this.analysisLogic = AnalysisLogic;
    this.unsubscribeHandlers = [];
    this.timeouts = [];
    this.eventListeners = [];
    this.scopeExpanded = false;
    this.quickViewsExpanded = false;
    this.customizationExpanded = false;
    this.filtersExpanded = false;

    // Default State
    this.state = {
      timeframe: "past_30_days",
      startDate: "",
      endDate: "",
      tripStatusFilter: "All", // 'All', 'Active', 'Completed', 'Investment'

      // Split Tag Filters
      selectedCategories: new Set(),
      selectedTrips: new Set(),
      // selectedTypes is derived from selectedTrips

      categorySearchTerm: "",
      tripSearchTerm: "",
      typeSearchTerm: "",

      metric: "balance", // income, expense, net, balance
      chartType: "line",
      primaryGroup: "date",
      secondaryGroup: "none",
      expandedTripTypes: new Set(),
      timeUnit: "day",

      // Summary Statistics
      summaryStats: {
        totalIncome: 0,
        totalExpense: 0,
        netChange: 0,
        transactionCount: 0,
        effectiveBalance: 0,
      },
      showDataTable: false,
      skipEmptyPeriods: false,
    };

    this.debouncedGenerateChart = debounce(() => this.generateChart(), 600);

    this.render();

    this.unsubscribeHandlers.push(
      store.subscribe("expenses", () => {
        this.updateTagSelectors();
        this.generateChart();
      }),
    );
    this.unsubscribeHandlers.push(
      store.subscribe("tags", () => {
        this.updateTagSelectors();
        this.updateControls();
        this.generateChart();
      }),
    );
  }

  render() {
    // Initialize dates if needed (on first render)
    if (this.state.timeframe !== "custom" && !this.state.startDate) {
      const expenses = store.getState("expenses") || [];
      const range = this.analysisLogic.calculateDateRange(
        this.state.timeframe,
        expenses,
      );
      if (range) {
        this.state.startDate = formatDateForInput(range.start);
        this.state.endDate = formatDateForInput(range.end);
      }
    }

    const header = el(
      "div",
      { className: "header-section" },
      el("h2", {}, "Financial Analysis"),
      el("p", {}, "Generate custom reports and visualize your treasury data."),
    );

    const summaryCards = el("div", {
      className: "summary-cards-container",
      id: "analysis-summary-cards",
    });
    const controlsContainer = el("div", {
      className: "main-control-panel",
      id: "analysis-controls-container",
    });
    const filtersContainer = el("div", {
      className: "analysis-filters-panel",
      id: "analysis-filters-container",
    });

    const actionsBar = el(
      "div",
      { className: "analysis-actions-bar", id: "analysis-actions-bar" },
      el(
        "button",
        { id: "btn-skip-empty", className: "btn-action" },
        "Skip Empty Periods",
      ),
      el(
        "button",
        { id: "btn-toggle-view", className: "btn-action" },
        "Show Data Table",
      ),
      el(
        "button",
        { id: "btn-download-image", className: "btn-action" },
        "Download Image",
      ),
      el(
        "button",
        {
          id: "btn-download-data",
          className: "btn-action",
          style: { display: "none" },
        },
        "Download Data (CSV)",
      ),
    );

    const chartContainer = el(
      "div",
      { className: "chart-container", id: "analysis-chart-container" },
      el("canvas", { id: "analysis-chart" }),
    );

    const tableContainer = el("div", {
      className: "analysis-data-table-panel",
      id: "analysis-data-table-container",
      style: { display: "none" },
    });

    const container = el(
      "div",
      { className: "analysis-container" },
      header,
      summaryCards,
      controlsContainer,
      filtersContainer,
      actionsBar,
      chartContainer,
      tableContainer,
    );

    const cssLink = el("link", {
      rel: "stylesheet",
      href: new URL("./analysis.css", import.meta.url).href,
    });

    replace(this.element, cssLink, container);

    // Initialize Sub-components
    this.initializeSubComponents();
    this.initializeActionButtons();

    // Initial Updates
    this.updateStatsDOM(false);
    this.timeouts.push(setTimeout(() => this.updateTagSelectors(), 0));
    this.timeouts.push(setTimeout(() => this.generateChart(), 0));
  }

  initializeSubComponents() {
    // 1. Controls
    const controlsContainer = this.element.querySelector(
      "#analysis-controls-container",
    );
    if (!controlsContainer) {
      console.error("Analysis: Controls container not found");
    } else {
      this.controlsComponent = new AnalysisControls(
        controlsContainer,
        {
          onTimeframeChange: (val) => this.handleTimeframeChange(val),
          onStatusChange: (val) => {
            this.state.tripStatusFilter = val;
            this.updateTagSelectors();
            this.generateChart();
          },
          onDateChange: (type, val) => {
            if (type === "start") this.state.startDate = val;
            else this.state.endDate = val;
            this.state.timeframe = "custom";
            this.updateControls();
            this.debouncedGenerateChart();
          },
          onMetricChange: (val) => {
            this.state.metric = val;
            if (val === "balance") {
              this.state.chartType = "line";
              this.state.primaryGroup = "date";
              this.state.secondaryGroup = "none";
            }
            this.updateControls();
            this.generateChart();
          },
          onChartTypeChange: (val) => {
            this.state.chartType = val;
            if (val === "pie" || val === "doughnut") {
              this.state.secondaryGroup = "none";
            }
            this.updateControls();
            this.generateChart();
          },
          onGroupChange: (type, val) => this.handleGroupChange(type, val),
          onTripTypeExpansionToggle: (type, isExpanded) =>
            this.handleTripTypeExpansionToggle(type, isExpanded),
          onPresetClick: (preset) => this.applyPreset(preset),
        },
        {
          scopeSummary: this.getScopeSummaryConfig(),
          scopeExpanded: this.scopeExpanded,
          onScopeToggle: (expanded) => {
            this.scopeExpanded = expanded;
          },
          quickViewsSummary: this.getQuickViewsSummaryConfig(),
          quickViewsExpanded: this.quickViewsExpanded,
          onQuickViewsToggle: (expanded) => {
            this.quickViewsExpanded = expanded;
          },
          customizationSummary: this.getCustomizationSummaryConfig(),
          customizationExpanded: this.customizationExpanded,
          onCustomizationToggle: (expanded) => {
            this.customizationExpanded = expanded;
          },
        },
      );
      this.updateControls();
    }

    // 2. Filters
    const filtersContainer = this.element.querySelector(
      "#analysis-filters-container",
    );
    if (!filtersContainer) {
      console.error("Analysis: Filters container not found");
    } else {
      this.filtersComponent = new AnalysisFilters(
        filtersContainer,
        {
          onFilterChange: () => {
            this.generateChart();
            this.updateTagSelectors();
          },
          onSearchChange: (type, term) => {
            if (type === "Category") {
              this.state.categorySearchTerm = term.toLowerCase();
            } else if (type === "Type") {
              this.state.typeSearchTerm = term.toLowerCase();
            } else {
              this.state.tripSearchTerm = term.toLowerCase();
            }
            this.updateTagSelectors();
          },
          onTypeChange: (typeTag, isChecked) => {
            this.handleTypeChange(typeTag, isChecked);
          },
        },
        {
          summary: this.getFiltersSummaryConfig(),
          expanded: this.filtersExpanded,
          onToggle: (expanded) => {
            this.filtersExpanded = expanded;
          },
        },
      );
    }

    // 3. Chart
    const chartEl = this.element.querySelector("#analysis-chart");
    if (!chartEl) {
      console.error("Analysis: Chart canvas not found");
    } else {
      this.chartComponent = new AnalysisChart(chartEl);
    }

    // 4. Table
    const tableContainer = this.element.querySelector(
      "#analysis-data-table-container",
    );
    if (!tableContainer) {
      console.error("Analysis: Data table container not found");
    } else {
      this.tableComponent = new AnalysisTable(tableContainer);
    }
  }

  initializeActionButtons() {
    const skipBtn = this.element.querySelector("#btn-skip-empty");
    if (skipBtn) {
      const handler = () => {
        this.state.skipEmptyPeriods = !this.state.skipEmptyPeriods;
        skipBtn.classList.toggle("active", this.state.skipEmptyPeriods);
        this.generateChart();
      };
      skipBtn.addEventListener("click", handler);
      this.eventListeners.push({ element: skipBtn, type: "click", handler });
    }

    const toggleBtn = this.element.querySelector("#btn-toggle-view");
    if (toggleBtn) {
      const handler = () => {
        this.state.showDataTable = !this.state.showDataTable;
        this.updateViewVisibility();
      };
      toggleBtn.addEventListener("click", handler);
      this.eventListeners.push({ element: toggleBtn, type: "click", handler });
    }

    const downloadImgBtn = this.element.querySelector("#btn-download-image");
    if (downloadImgBtn) {
      const handler = () => {
        if (this.chartComponent) {
          const base64 = this.chartComponent.toBase64Image();
          if (base64) {
            const link = document.createElement("a");
            const timestamp = new Date()
              .toISOString()
              .replace(/[:.]/g, "-")
              .slice(0, -5);
            link.download = `analysis-chart-${timestamp}.png`;
            link.href = base64;
            link.click();
          } else {
            this.modal.alert("Chart not ready.", "Download Error");
          }
        }
      };
      downloadImgBtn.addEventListener("click", handler);
      this.eventListeners.push({
        element: downloadImgBtn,
        type: "click",
        handler,
      });
    }

    const downloadDataBtn = this.element.querySelector("#btn-download-data");
    if (downloadDataBtn) {
      const handler = () => {
        if (this.chartData) {
          const csvContent = this.analysisLogic.generateCSV(
            this.chartData.labels,
            this.chartData.datasets,
            {
              primaryGroup: this.state.primaryGroup,
              secondaryGroup: this.state.secondaryGroup,
              metric: this.state.metric,
              timeUnit: this.state.timeUnit,
            },
          );
          const blob = new Blob([csvContent], {
            type: "text/csv;charset=utf-8;",
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, -5);
          link.setAttribute("href", url);
          link.setAttribute("download", `analysis-data-${timestamp}.csv`);
          link.style.visibility = "hidden";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          this.modal.alert("No data available to download.", "Download Error");
        }
      };
      downloadDataBtn.addEventListener("click", handler);
      this.eventListeners.push({
        element: downloadDataBtn,
        type: "click",
        handler,
      });
    }
  }

  handleTypeChange(typeTag, isChecked) {
    // Find associated Trips and update Trip Selection
    const tags = store.getState("tags") || {};
    const tripTypeMap = tags.TripTypeMap || {};
    const tripStatusMap = tags.TripStatusMap || {};
    const allTrips = tags["Trip/Event"] || [];

    // Filter Trips based on Scope (same logic as updateTagSelectors)
    const visibleTrips = this.analysisLogic.getVisibleTrips(
      allTrips,
      tripStatusMap,
      this.state.tripStatusFilter,
    );

    const tripsToUpdate = visibleTrips.filter(
      (trip) => tripTypeMap[trip] === typeTag,
    );

    tripsToUpdate.forEach((trip) => {
      if (isChecked) {
        this.state.selectedTrips.add(trip);
      } else {
        this.state.selectedTrips.delete(trip);
      }
    });

    // Update UI is handled by onFilterChange callback
  }

  updateControls() {
    if (!this.controlsComponent) return;
    const tags = store.getState("tags") || {};
    const adjustments = this.controlsComponent.update({
      ...this.state,
      tripTypes: tags["Type"] || [],
    });
    if (adjustments && adjustments.chartType) {
      this.state.chartType = adjustments.chartType;
    }
    if (adjustments && adjustments.secondaryGroup) {
      this.state.secondaryGroup = adjustments.secondaryGroup;
    }

    const skipBtn = this.element.querySelector("#btn-skip-empty");
    if (skipBtn) {
      skipBtn.style.display = this.state.metric === "balance" ? "" : "none";
    }

    this.controlsComponent.updateDisclosureSummaries({
      scope: this.getScopeSummaryConfig(),
      quickViews: this.getQuickViewsSummaryConfig(),
      customization: this.getCustomizationSummaryConfig(),
    });
  }

  handleTimeframeChange(newTimeframe) {
    this.state.timeframe = newTimeframe;
    if (newTimeframe !== "custom") {
      const expenses = store.getState("expenses") || [];
      const range = this.analysisLogic.calculateDateRange(
        newTimeframe,
        expenses,
      );
      if (range) {
        this.state.startDate = formatDateForInput(range.start);
        this.state.endDate = formatDateForInput(range.end);
      }
    }
    this.updateControls();
    this.generateChart();
  }

  handleGroupChange(type, val) {
    if (type === "primary") {
      if (val !== "tripType") this.state.expandedTripTypes = new Set();
      this.state.primaryGroup = val;
    } else if (type === "secondary") {
      this.state.secondaryGroup = val;
    } else if (type === "timeUnit") {
      this.state.timeUnit = val;
    }
    this.updateControls();
    this.generateChart();
  }

  handleTripTypeExpansionToggle(type, isExpanded) {
    if (isExpanded) this.state.expandedTripTypes.add(type);
    else this.state.expandedTripTypes.delete(type);
    this.generateChart();
  }

  applyPreset(presetName) {
    const presetState = this.analysisLogic.getPresetState(presetName);
    Object.assign(this.state, presetState);

    // Ensure Sets remain Sets after preset merge
    if (!(this.state.selectedCategories instanceof Set)) {
      this.state.selectedCategories = new Set(
        this.state.selectedCategories || [],
      );
    }
    if (!(this.state.selectedTrips instanceof Set)) {
      this.state.selectedTrips = new Set(this.state.selectedTrips || []);
    }
    if (!(this.state.expandedTripTypes instanceof Set)) {
      this.state.expandedTripTypes = new Set(
        this.state.expandedTripTypes || [],
      );
    }
    if (this.state.primaryGroup !== "tripType") {
      this.state.expandedTripTypes = new Set();
    }

    // Recalculate date range
    const expenses = store.getState("expenses") || [];
    const range = this.analysisLogic.calculateDateRange(
      this.state.timeframe,
      expenses,
    );
    if (range) {
      this.state.startDate = formatDateForInput(range.start);
      this.state.endDate = formatDateForInput(range.end);
    }
    this.updateControls();
    this.updateTagSelectors();
    this.generateChart();
  }

  updateTagSelectors() {
    if (!this.filtersComponent) return;

    const tagsData = store.getState("tags") || {};

    // Delegate logic to AnalysisLogic
    const { visibleTrips, visibleTypes, typeStatusMap, filteredTagsData } =
      this.analysisLogic.calculateTagFilterState(
        tagsData,
        this.state.tripStatusFilter,
        this.state.selectedTrips,
      );

    this.filtersComponent.renderTagLists(
      filteredTagsData,
      this.state.selectedCategories,
      this.state.selectedTrips,
      typeStatusMap, // Pass calculated map instead of set
      this.state.categorySearchTerm,
      this.state.tripSearchTerm,
      this.state.typeSearchTerm,
    );
    this.filtersComponent.updateInputs(
      this.state.categorySearchTerm,
      this.state.tripSearchTerm,
      this.state.typeSearchTerm,
    );
    this.filtersComponent.updateDisclosure(this.getFiltersSummaryConfig());
  }

  getScopeSummaryConfig() {
    const items = [
      { label: TIMEFRAME_LABELS[this.state.timeframe] || "Custom" },
      { label: STATUS_LABELS[this.state.tripStatusFilter] || "All Trips" },
    ];

    if (
      this.state.timeframe === "custom" &&
      this.state.startDate &&
      this.state.endDate
    ) {
      items.push({
        label: `${formatSummaryDate(this.state.startDate)} to ${formatSummaryDate(this.state.endDate)}`,
        tone: "muted",
      });
    }

    return {
      items,
      emptyText: "All available data",
    };
  }

  getQuickViewsSummaryConfig() {
    return {
      text: "4 preset reports",
    };
  }

  getCustomizationSummaryConfig() {
    const items = [
      { label: METRIC_LABELS[this.state.metric] || "Metric" },
      { label: CHART_TYPE_LABELS[this.state.chartType] || "Chart" },
      {
        label: `By ${GROUP_LABELS[this.state.primaryGroup] || "Date"}`,
        tone: "muted",
      },
    ];

    if (this.state.secondaryGroup !== "none") {
      items.push({
        label: `Stack ${GROUP_LABELS[this.state.secondaryGroup] || "Group"}`,
        tone: "muted",
      });
    }

    if (this.state.primaryGroup === "date") {
      items.push({
        label: TIME_UNIT_LABELS[this.state.timeUnit] || "Daily",
        tone: "muted",
      });
    }

    return {
      items,
      emptyText: "Default chart settings",
    };
  }

  getFiltersSummaryConfig() {
    const items = [];

    if (this.state.selectedTrips.size > 0) {
      items.push({
        label: `${this.state.selectedTrips.size} trip${this.state.selectedTrips.size === 1 ? "" : "s"}`,
      });
    }

    if (this.state.selectedCategories.size > 0) {
      items.push({
        label: `${this.state.selectedCategories.size} categor${this.state.selectedCategories.size === 1 ? "y" : "ies"}`,
      });
    }

    const activeSearchCount = [
      this.state.categorySearchTerm,
      this.state.tripSearchTerm,
      this.state.typeSearchTerm,
    ].filter((term) => term && term.trim().length > 0).length;

    if (activeSearchCount > 0) {
      items.push({
        label: `${activeSearchCount} search${activeSearchCount === 1 ? "" : "es"}`,
        tone: "muted",
      });
    }

    return {
      items,
      emptyText: "No tag filters active",
    };
  }

  updateStatsDOM(hasBalanceError = false) {
    const stats = this.state.summaryStats;
    const container = this.element.querySelector("#analysis-summary-cards");
    if (!container) return;

    const cards = [
      {
        title: "Total Income",
        value: formatCurrency(stats.totalIncome),
        class: "",
      },
      {
        title: "Total Expense",
        value: formatCurrency(stats.totalExpense),
        class: "",
      },
      {
        title: "Net Change",
        value: formatCurrency(stats.netChange),
        class: "",
      },
      {
        title: "Effective Balance",
        value: hasBalanceError
          ? "⚠️ Error"
          : formatCurrency(stats.effectiveBalance),
        class: "",
        tooltip: hasBalanceError ? "Failed to calculate balance" : "",
      },
      { title: "Transactions", value: stats.transactionCount, class: "" },
    ];

    const cardElements = cards.map((card) => {
      const props = { className: "summary-card", title: card.tooltip || "" };
      if (card.title === "Effective Balance" && hasBalanceError) {
        props.role = "alert";
      }
      return el(
        "div",
        props,
        el("h3", {}, card.title),
        el("p", { className: card.class }, card.value),
      );
    });

    replace(container, ...cardElements);
  }

  updateViewVisibility() {
    const isTable = this.state.showDataTable;
    const chartContainer = this.element.querySelector(
      "#analysis-chart-container",
    );
    const tableContainer = this.element.querySelector(
      "#analysis-data-table-container",
    );
    const toggleBtn = this.element.querySelector("#btn-toggle-view");
    const downloadImgBtn = this.element.querySelector("#btn-download-image");
    const downloadDataBtn = this.element.querySelector("#btn-download-data");

    if (
      !chartContainer ||
      !tableContainer ||
      !toggleBtn ||
      !downloadImgBtn ||
      !downloadDataBtn
    ) {
      console.error(
        "Analysis: Required elements not found in updateViewVisibility",
      );
      return;
    }

    if (isTable) {
      chartContainer.style.display = "none";
      tableContainer.style.display = "block";
      toggleBtn.textContent = "Show Graph";
      downloadImgBtn.style.display = "none";
      downloadDataBtn.style.display = "inline-block";
    } else {
      chartContainer.style.display = "block";
      tableContainer.style.display = "none";
      toggleBtn.textContent = "Show Data Table";
      downloadImgBtn.style.display = "inline-block";
      downloadDataBtn.style.display = "none";
    }

    // Force table render if switching to table view and we have data
    if (isTable && this.chartData && this.tableComponent) {
      this.tableComponent.render(
        this.chartData.labels,
        this.chartData.datasets,
        {
          primaryGroup: this.state.primaryGroup,
          secondaryGroup: this.state.secondaryGroup,
          metric: this.state.metric,
          timeUnit: this.state.timeUnit,
          show: true,
        },
      );
    }
  }

  generateChart() {
    const expenses = store.getState("expenses") || [];
    const tags = store.getState("tags") || {};
    const tripStatusMap = tags.TripStatusMap || {};

    const filteredData = this.analysisLogic.getFilteredData(
      expenses,
      {
        startDate: this.state.startDate,
        endDate: this.state.endDate,
        selectedCategories: this.state.selectedCategories,
        selectedTrips: this.state.selectedTrips,
        tripStatusFilter: this.state.tripStatusFilter,
      },
      tripStatusMap,
    );

    this.state.summaryStats =
      this.analysisLogic.calculateSummaryStats(filteredData);

    const allExpenses = store.getState("expenses") || [];
    const openingBalance = store.getState("openingBalance") || 0;

    let currentBalance = 0;
    let hasBalanceError = false;
    try {
      ({ currentBalance } = calculateFinancials(openingBalance, allExpenses));
    } catch (error) {
      console.error("Analysis: Error calculating financials", error);
      hasBalanceError = true;
    }

    this.state.summaryStats.effectiveBalance =
      this.analysisLogic.calculateEffectiveBalance(
        currentBalance,
        allExpenses,
        tripStatusMap,
      );

    this.updateStatsDOM(hasBalanceError);

    this.chartData = this.analysisLogic.aggregateData(
      filteredData,
      {
        primaryGroup: this.state.primaryGroup,
        secondaryGroup: this.state.secondaryGroup,
        metric: this.state.metric,
        timeUnit: this.state.timeUnit,
        startDate: this.state.startDate,
        endDate: this.state.endDate,
        skipEmptyPeriods: this.state.skipEmptyPeriods,
        tripTypeMap: tags.TripTypeMap || {},
        expandedTripTypes: this.state.expandedTripTypes,
        tripTypes: tags["Type"] || [],
        allTripNames: tags["Trip/Event"] || [],
      },
      allExpenses,
      openingBalance,
    );

    // Render Chart
    if (this.chartComponent) {
      this.chartComponent.render(this.chartData, {
        type: this.state.chartType,
        metric: this.state.metric,
        primaryGroup: this.state.primaryGroup,
        secondaryGroup: this.state.secondaryGroup,
        hasBalanceError: hasBalanceError,
      });
    }

    this.updateViewVisibility();
  }

  destroy() {
    this.debouncedGenerateChart.cancel();
    this.unsubscribeHandlers.forEach((handler) => handler.unsubscribe());
    this.unsubscribeHandlers = [];
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts = [];
    this.eventListeners.forEach(({ element, type, handler }) => {
      element.removeEventListener(type, handler);
    });
    this.eventListeners = [];
    if (this.controlsComponent) {
      this.controlsComponent.destroy();
      this.controlsComponent = null;
    }
    if (this.filtersComponent) {
      this.filtersComponent.destroy();
      this.filtersComponent = null;
    }
    if (this.chartComponent) {
      this.chartComponent.destroy();
    }
  }
}

export default AnalysisComponent;
