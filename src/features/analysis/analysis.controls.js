import { el, replace } from "../../core/dom.js";
import MobileDisclosureComponent from "../../shared/mobile-disclosure.component.js";

export default class AnalysisControls {
  constructor(element, callbacks, options = {}) {
    this.element = element;
    this.callbacks = callbacks || {};
    this.options = options || {};
    this.disclosures = {};
    // callbacks: { onTimeframeChange, onStatusChange, onDateChange, onMetricChange, onChartTypeChange, onGroupChange, onPresetClick, onToggleTable, onDownload }
    this.render();
  }

  createOptions(options, selectedValue) {
    return options.map((opt) =>
      el(
        "option",
        { value: opt.value, selected: opt.value === selectedValue },
        opt.label,
      ),
    );
  }

  render() {
    // 1. Scope Section
    const timeframeSelect = el(
      "select",
      { id: "analysis-timeframe-select", className: "control-input" },
      ...this.createOptions([
        { value: "current_month", label: "Current Month" },
        { value: "past_30_days", label: "Past 30 Days" },
        { value: "past_3_months", label: "Past 3 Months" },
        { value: "past_6_months", label: "Past 6 Months" },
        { value: "past_year", label: "Past Year" },
        { value: "all_time", label: "All Time" },
        { value: "custom", label: "Custom" },
      ]),
    );
    timeframeSelect.addEventListener("change", (e) => {
      if (this.callbacks.onTimeframeChange)
        this.callbacks.onTimeframeChange(e.target.value);
    });

    const statusSelect = el(
      "select",
      { id: "analysis-trip-status-select", className: "control-input" },
      ...this.createOptions([
        { value: "All", label: "All" },
        { value: "Active", label: "Active Only" },
        { value: "Completed", label: "Completed Only" },
        { value: "Investment", label: "Investment Only" },
      ]),
    );
    statusSelect.addEventListener("change", (e) => {
      if (this.callbacks.onStatusChange)
        this.callbacks.onStatusChange(e.target.value);
    });

    const startDateInput = el("input", {
      type: "date",
      id: "analysis-start-date",
      "aria-label": "Start Date",
      className: "control-input",
    });
    startDateInput.addEventListener("change", (e) => {
      if (this.callbacks.onDateChange)
        this.callbacks.onDateChange("start", e.target.value);
    });

    const endDateInput = el("input", {
      type: "date",
      id: "analysis-end-date",
      "aria-label": "End Date",
      className: "control-input",
    });
    endDateInput.addEventListener("change", (e) => {
      if (this.callbacks.onDateChange)
        this.callbacks.onDateChange("end", e.target.value);
    });

    const scopeSection = el(
      "div",
      { className: "analysis-control-section analysis-control-section--scope" },
      el(
        "div",
        { className: "control-row" },
        el(
          "div",
          { className: "control-group" },
          el("label", { for: "analysis-timeframe-select" }, "Timeframe"),
          timeframeSelect,
        ),
        el(
          "div",
          { className: "control-group" },
          el("label", { for: "analysis-trip-status-select" }, "Trip Status"),
          statusSelect,
        ),
      ),
      el(
        "div",
        { className: "control-row dates-row", style: { marginTop: "10px" } },
        startDateInput,
        el("span", { style: { color: "#ccc", alignSelf: "center" } }, "to"),
        endDateInput,
      ),
    );

    // 2. Presets Section
    const presetButtons = [
      { id: "trip_cost_completed", label: "🏁 Trip Cost (Completed)" },
      { id: "category_breakdown", label: "📊 Category Breakdown" },
      { id: "monthly_trend", label: "📅 Monthly Trend" },
      { id: "active_trip_status", label: "✈️ Active Trip Status" },
    ].map((p) => {
      const btn = el(
        "button",
        { className: "quick-report-btn", dataset: { preset: p.id } },
        p.label,
      );
      btn.addEventListener("click", (e) => {
        if (this.callbacks.onPresetClick)
          this.callbacks.onPresetClick(e.currentTarget.dataset.preset);
      });
      return btn;
    });

    const presetsSection = el(
      "div",
      {
        className:
          "analysis-control-section analysis-control-section--quick-views",
      },
      el("div", { className: "quick-reports-grid" }, ...presetButtons),
    );

    // 3. Customization Section
    const metricSelect = el(
      "select",
      { id: "analysis-metric-select", className: "control-input" },
      ...this.createOptions([
        { value: "balance", label: "Cumulative Balance" },
        { value: "income", label: "Income" },
        { value: "expense", label: "Expenses" },
        { value: "net", label: "Net Income" },
      ]),
    );
    metricSelect.addEventListener("change", (e) => {
      if (this.callbacks.onMetricChange)
        this.callbacks.onMetricChange(e.target.value);
    });

    const chartTypeSelect = el(
      "select",
      { id: "analysis-chart-type-select", className: "control-input" },
      ...this.createOptions([
        { value: "bar", label: "Bar" },
        { value: "line", label: "Line" },
        { value: "pie", label: "Pie" },
        { value: "doughnut", label: "Doughnut" },
      ]),
    );
    chartTypeSelect.addEventListener("change", (e) => {
      if (this.callbacks.onChartTypeChange)
        this.callbacks.onChartTypeChange(e.target.value);
    });

    const primaryGroupSelect = el(
      "select",
      { id: "analysis-primary-group-select", className: "control-input" },
      ...this.createOptions([
        { value: "date", label: "Date" },
        { value: "category", label: "Category" },
        { value: "trip", label: "Trip/Event" },
        { value: "tripType", label: "Trip Type" },
      ]),
    );
    primaryGroupSelect.addEventListener("change", (e) => {
      if (this.callbacks.onGroupChange)
        this.callbacks.onGroupChange("primary", e.target.value);
    });

    const secondaryGroupSelect = el(
      "select",
      { id: "analysis-secondary-group-select", className: "control-input" },
      ...this.createOptions([
        { value: "none", label: "None" },
        { value: "category", label: "Category" },
        { value: "trip", label: "Trip/Event" },
      ]),
    );
    secondaryGroupSelect.addEventListener("change", (e) => {
      if (this.callbacks.onGroupChange)
        this.callbacks.onGroupChange("secondary", e.target.value);
    });

    const timeUnitSelect = el(
      "select",
      { id: "analysis-time-unit-select", className: "control-input" },
      ...this.createOptions([
        { value: "day", label: "Daily" },
        { value: "week", label: "Weekly" },
        { value: "month", label: "Monthly" },
        { value: "year", label: "Yearly" },
      ]),
    );
    timeUnitSelect.addEventListener("change", (e) => {
      if (this.callbacks.onGroupChange)
        this.callbacks.onGroupChange("timeUnit", e.target.value);
    });

    const customizationSection = el(
      "div",
      {
        className:
          "analysis-control-section analysis-control-section--customization",
      },
      el(
        "div",
        { className: "control-grid" },
        el(
          "div",
          { className: "control-group" },
          el("label", { for: "analysis-metric-select" }, "Metric"),
          metricSelect,
        ),
        el(
          "div",
          { className: "control-group" },
          el("label", { for: "analysis-chart-type-select" }, "Chart Type"),
          chartTypeSelect,
        ),
        el(
          "div",
          { className: "control-group", id: "primary-group-container" },
          el("label", { for: "analysis-primary-group-select" }, "X-Axis Group"),
          primaryGroupSelect,
        ),
        el(
          "div",
          { className: "control-group", id: "secondary-group-container" },
          el(
            "label",
            { for: "analysis-secondary-group-select" },
            "Sub-Group (Stack)",
          ),
          secondaryGroupSelect,
        ),
        el(
          "div",
          {
            className: "control-group",
            id: "time-unit-container",
            style: { display: "none" },
          },
          el("label", { for: "analysis-time-unit-select" }, "Time Unit"),
          timeUnitSelect,
        ),
      ),
      el(
        "div",
        {
          id: "trip-type-expansion-container",
          className: "control-group",
          style: { display: "none" },
        },
        el("label", {}, "Expand trip types into individual trips:"),
        el("div", {
          id: "trip-type-expansion-list",
          className: "tag-selector",
        }),
      ),
    );

    const scopeMount = el("div", {
      className: "analysis-disclosure-mount analysis-disclosure-mount--scope",
    });
    const quickViewsMount = el("div", {
      className:
        "analysis-disclosure-mount analysis-disclosure-mount--quick-views",
    });
    const customizationMount = el("div", {
      className:
        "analysis-disclosure-mount analysis-disclosure-mount--customization",
    });

    replace(this.element, scopeMount, quickViewsMount, customizationMount);

    this.disclosures.scope = new MobileDisclosureComponent(scopeMount, {
      title: "Scope",
      summary: this.options.scopeSummary || {},
      expanded: this.options.scopeExpanded,
      collapseMode: "mobile",
      className: "analysis-disclosure analysis-disclosure--scope",
      bodyClassName:
        "analysis-disclosure__body analysis-disclosure__body--scope",
      bodyChildren: [scopeSection],
      onToggle: (expanded) => {
        if (typeof this.options.onScopeToggle === "function") {
          this.options.onScopeToggle(expanded);
        }
      },
    });

    this.disclosures.quickViews = new MobileDisclosureComponent(
      quickViewsMount,
      {
        title: "Quick Views",
        summary: this.options.quickViewsSummary || {},
        expanded: this.options.quickViewsExpanded,
        collapseMode: "mobile",
        className: "analysis-disclosure analysis-disclosure--quick-views",
        bodyClassName:
          "analysis-disclosure__body analysis-disclosure__body--quick-views",
        bodyChildren: [presetsSection],
        onToggle: (expanded) => {
          if (typeof this.options.onQuickViewsToggle === "function") {
            this.options.onQuickViewsToggle(expanded);
          }
        },
      },
    );

    this.disclosures.customization = new MobileDisclosureComponent(
      customizationMount,
      {
        title: "Customization",
        summary: this.options.customizationSummary || {},
        expanded: this.options.customizationExpanded,
        collapseMode: "mobile",
        className: "analysis-disclosure analysis-disclosure--customization",
        bodyClassName:
          "analysis-disclosure__body analysis-disclosure__body--customization",
        bodyChildren: [customizationSection],
        onToggle: (expanded) => {
          if (typeof this.options.onCustomizationToggle === "function") {
            this.options.onCustomizationToggle(expanded);
          }
        },
      },
    );
  }

  update(state) {
    const setVal = (id, val) => {
      const input = this.element.querySelector(id);
      if (input && document.activeElement !== input) input.value = val;
    };

    setVal("#analysis-timeframe-select", state.timeframe);
    setVal("#analysis-trip-status-select", state.tripStatusFilter);
    setVal("#analysis-start-date", state.startDate);
    setVal("#analysis-end-date", state.endDate);
    setVal("#analysis-metric-select", state.metric);

    // Update Chart Type Options based on Metric
    const chartTypeSelect = this.element.querySelector(
      "#analysis-chart-type-select",
    );
    let stateAdjustment = null;
    if (chartTypeSelect) {
      let options = [];
      if (state.metric === "balance") {
        options = [{ value: "line", label: "Line" }];
      } else {
        options = [
          { value: "bar", label: "Bar" },
          { value: "pie", label: "Pie" },
          { value: "doughnut", label: "Doughnut" },
        ];
      }

      // Validate chartType against available options, default to first valid option
      const validValues = options.map((opt) => opt.value);
      const chartTypeValue = validValues.includes(state.chartType)
        ? state.chartType
        : options[0].value;

      // Re-populate options
      chartTypeSelect.innerHTML = "";
      const optionEls = this.createOptions(options, chartTypeValue);
      optionEls.forEach((opt) => chartTypeSelect.appendChild(opt));

      // Store adjusted value if it changed, let caller handle state update
      if (chartTypeValue !== state.chartType) {
        stateAdjustment = { chartType: chartTypeValue };
      }
    }

    setVal("#analysis-primary-group-select", state.primaryGroup);

    const primaryGroupSelect = this.element.querySelector(
      "#analysis-primary-group-select",
    );
    if (primaryGroupSelect) {
      primaryGroupSelect.disabled = state.metric === "balance";
    }

    // Update Secondary Group options, excluding whichever value is selected as primary
    const secondaryGroupSelect = this.element.querySelector(
      "#analysis-secondary-group-select",
    );
    if (secondaryGroupSelect) {
      const allSecondaryOptions = [
        { value: "none", label: "None" },
        { value: "category", label: "Category" },
        { value: "trip", label: "Trip/Event" },
      ];
      const secondaryOptions = allSecondaryOptions.filter(
        (opt) => opt.value === "none" || opt.value !== state.primaryGroup,
      );
      const validSecondaryValues = secondaryOptions.map((opt) => opt.value);
      const secondaryGroupValue = validSecondaryValues.includes(
        state.secondaryGroup,
      )
        ? state.secondaryGroup
        : "none";
      secondaryGroupSelect.innerHTML = "";
      this.createOptions(secondaryOptions, secondaryGroupValue).forEach((opt) =>
        secondaryGroupSelect.appendChild(opt),
      );
      if (secondaryGroupValue !== state.secondaryGroup) {
        stateAdjustment = {
          ...stateAdjustment,
          secondaryGroup: secondaryGroupValue,
        };
      }
    }

    setVal("#analysis-time-unit-select", state.timeUnit);

    const timeUnitContainer = this.element.querySelector(
      "#time-unit-container",
    );
    if (timeUnitContainer) {
      timeUnitContainer.style.display =
        state.primaryGroup === "date" ? "flex" : "none";
    }

    const secondaryGroupContainer = this.element.querySelector(
      "#secondary-group-container",
    );
    if (secondaryGroupContainer) {
      const isPieOrDoughnut =
        state.chartType === "pie" || state.chartType === "doughnut";
      const isBalance = state.metric === "balance";
      secondaryGroupContainer.style.display =
        isPieOrDoughnut || isBalance ? "none" : "flex";
    }

    const expansionContainer = this.element.querySelector(
      "#trip-type-expansion-container",
    );
    if (expansionContainer) {
      const show = state.primaryGroup === "tripType";
      expansionContainer.style.display = show ? "block" : "none";
      if (show) {
        this.renderTripTypeExpansionList(
          state.tripTypes || [],
          state.expandedTripTypes || new Set(),
          this.callbacks.onTripTypeExpansionToggle,
        );
      }
    }

    return stateAdjustment;
  }

  renderTripTypeExpansionList(tripTypes, expandedTripTypes, onToggle) {
    const list = this.element.querySelector("#trip-type-expansion-list");
    if (!list) return;

    const sorted = [...tripTypes].sort();
    if (sorted.length === 0) {
      replace(
        list,
        el(
          "div",
          { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
          "No trip types found",
        ),
      );
      return;
    }

    const children = sorted.map((type, index) => {
      const uid = `expansion-type-${index}`;
      const input = el("input", {
        type: "checkbox",
        id: uid,
        value: type,
        className: "tag-item-input",
      });
      input.checked = expandedTripTypes.has(type);
      input.addEventListener("change", (e) => {
        if (onToggle) onToggle(type, e.target.checked);
      });
      return el(
        "div",
        { className: "tag-checkbox-item" },
        input,
        el("label", { for: uid }, type),
      );
    });

    const previousScrollTop = list.scrollTop;
    replace(list, ...children);
    list.scrollTop = previousScrollTop;
  }

  updateDisclosureSummaries(summaries = {}) {
    if (summaries.scope && this.disclosures.scope) {
      this.disclosures.scope.update({ summary: summaries.scope });
    }
    if (summaries.quickViews && this.disclosures.quickViews) {
      this.disclosures.quickViews.update({ summary: summaries.quickViews });
    }
    if (summaries.customization && this.disclosures.customization) {
      this.disclosures.customization.update({
        summary: summaries.customization,
      });
    }
  }

  destroy() {
    Object.values(this.disclosures).forEach((disclosure) => {
      if (disclosure && typeof disclosure.destroy === "function") {
        disclosure.destroy();
      }
    });
    this.disclosures = {};
  }
}
