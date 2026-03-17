import { formatCurrency } from "../../core/utils.js";
import { CONFIG } from "../../core/config.js";

export default class AnalysisChart {
  constructor(element) {
    this.element = element; // The canvas element or container
    this.chartInstance = null;
    this.libLoaded = false;
    this.pendingRender = null;
    this.handleLoad = null;
    this.handleError = null;
    this.loadLib();
  }

  loadLib() {
    if (
      this.libLoaded ||
      (window.Chart && typeof window.Chart === "function")
    ) {
      this.libLoaded = true;
      return;
    }

    const scriptSrc = CONFIG.CHART_LIB_PATH;
    let script = document.querySelector(`script[src="${scriptSrc}"]`);

    this.handleLoad = () => {
      if (this.libLoaded) return;
      this.libLoaded = true;
      if (this.pendingRender) {
        this.render(this.pendingRender.data, this.pendingRender.options);
        this.pendingRender = null;
      }
    };

    this.handleError = () => {
      console.error("Failed to load Chart.js");
      this.pendingRender = null;
      if (script) {
        script.dataset.loadFailed = "true";
      }
    };

    if (script) {
      // Check if script previously failed
      if (script.dataset.loadFailed === "true") {
        this.handleError();
        return;
      }

      script.addEventListener("load", this.handleLoad);
      script.addEventListener("error", this.handleError);

      // Race condition fix: Check if it finished loading while we were attaching listeners
      if (typeof window.Chart === "function") {
        script.removeEventListener("load", this.handleLoad);
        script.removeEventListener("error", this.handleError);
        this.handleLoad();
      }
    } else {
      script = document.createElement("script");
      script.src = scriptSrc;
      script.addEventListener("load", this.handleLoad);
      script.addEventListener("error", this.handleError);
      document.head.appendChild(script);
    }
  }

  render(data, options) {
    if (!this.libLoaded) {
      this.pendingRender = { data, options };
      return;
    }

    if (!this.element || this.element.tagName !== "CANVAS") {
      console.error("AnalysisChart requires a canvas element");
      return;
    }

    const ctx = this.element.getContext("2d");
    if (!ctx) {
      console.error("Failed to get 2D context from canvas element");
      return;
    }
    const { labels, datasets } = data;
    const { type, metric, primaryGroup, secondaryGroup, hasBalanceError } =
      options;

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    // Determine actual chart type based on config
    let chartType = type;
    if (secondaryGroup !== "none" && (type === "pie" || type === "doughnut")) {
      chartType = "bar";
    }
    if (
      metric === "balance" &&
      primaryGroup === "date" &&
      secondaryGroup === "none"
    ) {
      chartType = "line";
    }

    const titleText = `Analysis: ${metric.toUpperCase()} by ${primaryGroup}${
      secondaryGroup !== "none" ? " & " + secondaryGroup : ""
    }${
      hasBalanceError && metric === "balance" ? " (⚠️ CALCULATION ERROR)" : ""
    }`;

    const subtitleText =
      hasBalanceError && metric === "balance"
        ? "Warning: Balance calculation failed. Chart may be inaccurate."
        : undefined;

    const config = {
      type: chartType,
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#fff" },
            display: true,
          },
          title: {
            display: true,
            text: titleText,
            color:
              hasBalanceError && metric === "balance" ? "#ff4444" : "#f0ad4e",
            font: { size: 16 },
          },
          subtitle: {
            display: !!subtitleText,
            text: subtitleText,
            color: "#ff4444",
            font: { size: 12, style: "italic" },
            padding: { bottom: 10 },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              label: function (context) {
                const value =
                  context.parsed.y !== undefined
                    ? context.parsed.y
                    : context.parsed;
                if (value === null || value === 0) return null;
                let label = context.dataset.label || "";
                if (label) label += ": ";
                label += formatCurrency(value);
                return label;
              },
              footer: function (tooltipItems) {
                const nonZeroItems = tooltipItems.filter((item) => {
                  const value =
                    item.parsed.y !== undefined ? item.parsed.y : item.parsed;
                  return value !== null && value !== undefined && value !== 0;
                });
                if (nonZeroItems.length <= 1) return "";
                const sum = nonZeroItems.reduce((acc, item) => {
                  return (
                    acc +
                    (item.parsed.y !== undefined ? item.parsed.y : item.parsed)
                  );
                }, 0);
                return "Total: " + formatCurrency(sum);
              },
            },
          },
        },
        scales:
          chartType === "pie" || chartType === "doughnut"
            ? {}
            : {
                y: {
                  stacked: secondaryGroup !== "none",
                  ticks: { color: "#ccc" },
                  grid: { color: "rgba(255,255,255,0.1)" },
                },
                x: {
                  stacked: secondaryGroup !== "none",
                  ticks: { color: "#ccc" },
                  grid: { color: "rgba(255,255,255,0.1)" },
                },
              },
      },
    };

    this.chartInstance = new Chart(ctx, config);
  }

  toBase64Image() {
    if (!this.chartInstance) return null;
    return this.chartInstance.toBase64Image();
  }

  destroy() {
    // Clean up script event listeners

    if (this.handleLoad || this.handleError) {
      const scriptSrc = CONFIG.CHART_LIB_PATH;

      const script = document.querySelector(`script[src="${scriptSrc}"]`);

      if (script) {
        if (this.handleLoad)
          script.removeEventListener("load", this.handleLoad);

        if (this.handleError)
          script.removeEventListener("error", this.handleError);
      }

      this.handleLoad = null;

      this.handleError = null;
    }

    if (this.chartInstance) {
      this.chartInstance.destroy();

      this.chartInstance = null;
    }

    this.pendingRender = null;

    this.element = null;
  }
}
