// src/features/analysis/analysis.logic.js

import store from "../../core/state.js";
import {
  getDateRange,
  formatDateForInput,
  parseAmount,
  parseDate,
} from "../../core/utils.js";
import { calculateFinancials } from "../../core/financial.logic.js";

class AnalysisLogic {
  constructor() {
    // This class will primarily contain static or utility methods,
    // so a constructor isn't strictly necessary for state, but useful for context.
  }

  /**
   * Calculates the start and end dates based on a given timeframe string.
   * @param {string} timeframe - The predefined timeframe (e.g., 'current_month', 'past_30_days', 'all_time').
   * @param {Array<Object>} expenses - The full list of expense items from the store.
   * @returns {{start: Date, end: Date}|null} An object with start and end Date objects, or null if custom.
   */
  calculateDateRange(timeframe, expenses) {
    if (timeframe === "custom") return null;

    if (timeframe === "all_time") {
      let start;
      if (expenses && expenses.length > 0) {
        let earliest = new Date();
        let found = false;
        expenses.forEach((item) => {
          const d = parseDate(item.Date);
          if (d) {
            if (!found || d < earliest) {
              earliest = d;
              found = true;
            }
          }
        });
        start = found ? earliest : new Date(2000, 0, 1);
      } else {
        start = new Date(2000, 0, 1);
      }
      return { start, end: new Date() };
    }

    return getDateRange(timeframe);
  }

  /**
   * Checks if a transaction belongs to a trip with the specified status.
   * @param {Object} item - The transaction item.
   * @param {Object} tripStatusMap - Map of trip names to their status ('Active', 'Completed', 'Investment').
   * @param {string} tripStatusFilter - The desired trip status to filter by ('Active', 'Completed', 'Investment', 'All').
   * @returns {boolean} True if the transaction matches the trip status filter, false otherwise.
   */
  isTransactionInTripStatus(item, tripStatusMap, tripStatusFilter) {
    const tripName = item["Trip/Event"];

    // If the filter is 'All' or empty, all transactions pass this filter
    if (tripStatusFilter === "All" || tripStatusFilter === "") {
      return true;
    }

    // If there's no trip name, and a specific filter is applied (not 'All' or empty),
    // then this transaction should not pass the filter.
    if (!tripName) {
      return false;
    }

    const actualStatus = tripStatusMap[tripName];

    // If the trip doesn't have a status in the map, and a specific filter is applied,
    // then this transaction should not pass the filter.
    if (!actualStatus) {
      return false;
    }

    // Now, a specific filter is applied, tripName exists, and actualStatus exists.
    // Check if the actual status matches the filter.
    return actualStatus === tripStatusFilter;
  }

  /**
   * Filters the raw expenses data based on date range, selected tags, and trip status.
   * @param {Array<Object>} expenses - The raw list of expense objects.
   * @param {Object} filterState - An object containing startDate, endDate, selectedCategories, selectedTrips, tripStatusFilter.
   * @param {Object} tripStatusMap - Map of trip names to their status ('Active', 'Completed', 'Investment').
   * @returns {Array<Object>} The filtered list of expense objects.
   */
  getFilteredData(expenses, filterState, tripStatusMap) {
    const {
      startDate,
      endDate,
      selectedCategories,
      selectedTrips,
      tripStatusFilter,
    } = filterState;
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      console.warn("getFilteredData: Invalid date range provided");
      return [];
    }

    end.setHours(23, 59, 59, 999); // Include the whole end day

    return expenses.filter((item) => {
      const date = parseDate(item.Date);
      if (!date) return false;
      if (date < start || date > end) return false;

      // Category Filter (AND logic)
      if (selectedCategories.size > 0) {
        const itemCategory = item.Category || "";
        if (!selectedCategories.has(itemCategory)) {
          return false;
        }
      }

      // Trip Filter (AND logic)
      if (selectedTrips.size > 0) {
        const itemTrip = item["Trip/Event"] || "";
        if (!selectedTrips.has(itemTrip)) {
          return false;
        }
      }

      // Trip Status Filter
      if (
        !this.isTransactionInTripStatus(item, tripStatusMap, tripStatusFilter)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Aggregates financial data based on primary and secondary grouping, and a specified metric.
   * @param {Array<Object>} data - The filtered list of expense objects.
   * @param {Object} aggregationState - State controlling aggregation (primaryGroup, secondaryGroup, metric, timeUnit, startDate).
   * @param {Array<Object>} allExpenses - All expenses (needed for balance calculation).
   * @param {string|number} openingBalance - The opening balance (needed for balance calculation).
   * @returns {{labels: Array<string>, datasets: Array<Object>}} Data structured for Chart.js.
   */
  aggregateData(data, aggregationState, allExpenses = [], openingBalance = 0) {
    const { primaryGroup, secondaryGroup, metric, timeUnit, startDate, endDate } =
      aggregationState;

    const generateAllDateKeys = (start, end, unit) => {
      const keys = [];
      const startD = parseDate(start);
      const endD = parseDate(end);
      if (!startD || !endD) return keys;

      if (unit === "day") {
        const cur = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
        while (cur <= endD) {
          keys.push(formatDateForInput(cur));
          cur.setDate(cur.getDate() + 1);
        }
      } else if (unit === "week") {
        // Align to Monday of startD's week
        const day = startD.getDay();
        const diff = startD.getDate() - day + (day === 0 ? -6 : 1);
        const cur = new Date(startD.getFullYear(), startD.getMonth(), diff);
        while (cur <= endD) {
          keys.push(formatDateForInput(cur));
          cur.setDate(cur.getDate() + 7);
        }
      } else if (unit === "year") {
        let year = startD.getFullYear();
        const endYear = endD.getFullYear();
        while (year <= endYear) {
          keys.push(year.toString());
          year++;
        }
      } else {
        // month (default)
        let year = startD.getFullYear();
        let month = startD.getMonth();
        const endYear = endD.getFullYear();
        const endMonth = endD.getMonth();
        while (year < endYear || (year === endYear && month <= endMonth)) {
          keys.push(`${year}-${String(month + 1).padStart(2, "0")}`);
          month++;
          if (month > 11) { month = 0; year++; }
        }
      }
      return keys;
    };

    const primaryMap = {};
    const allSecondaryKeys = new Set();

    const getVal = (item) => {
      const inc = parseAmount(item.Income);
      const exp = parseAmount(item.Expense);
      if (metric === "income") return inc;
      if (metric === "expense") return exp;
      if (metric === "net") return inc - exp;
      // For balance calculation, individual item value is always net
      return inc - exp;
    };

    const getKey = (item, type) => {
      if (type === "date") {
        const date = parseDate(item.Date);
        if (!date) return "Unknown";
        if (timeUnit === "day") return formatDateForInput(date);
        if (timeUnit === "week") {
          // Adjust date to the start of the week (Monday)
          const day = date.getDay();
          const diff = date.getDate() - day + (day === 0 ? -6 : 1); // If Sunday (0), go back 6 days to Monday
          const weekStart = new Date(date);
          weekStart.setDate(diff);
          return formatDateForInput(weekStart);
        }
        if (timeUnit === "year") return date.getFullYear().toString();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0",
        )}`; // Month format YYYY-MM
      }
      if (type === "category") return item.Category || "Uncategorized";
      if (type === "trip") return item["Trip/Event"] || "Uncategorized";
      return "Unknown";
    };

    data.forEach((item) => {
      const pKey = getKey(item, primaryGroup);
      const val = getVal(item);

      if (!primaryMap[pKey]) {
        primaryMap[pKey] = secondaryGroup === "none" ? 0 : {};
      }

      if (secondaryGroup === "none") {
        primaryMap[pKey] += val;
      } else {
        const sKey = getKey(item, secondaryGroup);
        allSecondaryKeys.add(sKey);
        if (!primaryMap[pKey][sKey]) primaryMap[pKey][sKey] = 0;
        primaryMap[pKey][sKey] += val;
      }
    });

    let sortedPKeys = Object.keys(primaryMap).sort();
    if (primaryGroup === "date" && startDate && endDate) {
      const allKeys = generateAllDateKeys(startDate, endDate, timeUnit);
      if (allKeys.length > 0) {
        const keySet = new Set(sortedPKeys);
        allKeys.forEach((k) => {
          if (!keySet.has(k)) {
            primaryMap[k] = secondaryGroup === "none" ? 0 : {};
          }
        });
        sortedPKeys = allKeys;
      }
    }

    // Special handling for 'balance' metric, which is cumulative
    if (
      metric === "balance" &&
      primaryGroup === "date" &&
      secondaryGroup === "none"
    ) {
      const labels = [];
      const values = [];

      const calculationStart = new Date(startDate);

      // Use adjustedOpeningBalance as the true starting point.
      // This accounts for Manual transactions (which adjust the start)
      // while the loop below accounts for their timeline effect.
      // Result: Correct running balance at any point in time.
      const parsedOpeningBalance = parseFloat(openingBalance) || 0;
      let adjustedOpeningBalance = parsedOpeningBalance;
      try {
        ({ adjustedOpeningBalance } = calculateFinancials(
          parsedOpeningBalance,
          allExpenses,
        ));
      } catch (error) {
        console.error(
          "AnalysisLogic: Error calculating financials. Using unadjusted opening balance.",
          { openingBalance: parsedOpeningBalance, error },
        );
        store.setState(
          "error",
          "Error calculating cumulative balance. Some metrics may be inaccurate.",
        );
      }
      let balance = adjustedOpeningBalance;

      // Pre-calculate balance for transactions *before* the current analysis window
      allExpenses.forEach((item) => {
        const itemDate = parseDate(item.Date);
        if (itemDate && itemDate < calculationStart) {
          balance += parseAmount(item.Income) - parseAmount(item.Expense);
        }
      });

      // Apply changes within the window
      sortedPKeys.forEach((key) => {
        balance += primaryMap[key];
        labels.push(key);
        values.push(balance);
      });

      return {
        labels,
        datasets: [
          {
            label: "Balance",
            data: values,
            backgroundColor: "#f0ad4e",
            borderColor: "#f0ad4e",
            fill: false,
            type: "line",
          },
        ],
      };
    }

    const labels = sortedPKeys;
    const datasets = [];

    // Helper for consistent color generation
    const CHART_COLORS = [
      "#f0ad4e", // Theme Orange
      "#5cb85c", // Bootstrap Green
      "#5bc0de", // Bootstrap Info
      "#d9534f", // Bootstrap Red
      "#f7f7f7", // White-ish
      "#9b59b6", // Purple
      "#e67e22", // Carrot
      "#3498db", // Blue
      "#1abc9c", // Turquoise
      "#34495e", // Dark Blue/Grey
      "#e74c3c", // Alizarin
      "#2ecc71", // Emerald
      "#f1c40f", // Sun Flower
      "#95a5a6", // Concrete
      "#16a085", // Green Sea
      "#27ae60", // Nephritis
      "#2980b9", // Belize Hole
      "#8e44ad", // Wisteria
      "#2c3e50", // Midnight Blue
      "#c0392b", // Pomegranate
    ];

    const getColor = (str, index) => {
      return CHART_COLORS[index % CHART_COLORS.length];
    };

    if (secondaryGroup === "none") {
      const dataPoints = labels.map((k) => primaryMap[k]);
      const colors = labels.map((k, i) => {
        // Apply conditional coloring (green for positive, red for negative) only for non-balance, date-grouped charts
        if (primaryGroup === "date" && metric !== "balance") {
          return dataPoints[i] >= 0 ? "#2ecc71" : "#d9534f";
        }
        return getColor(k, i);
      });

      datasets.push({
        label: metric.toUpperCase(),
        data: dataPoints,
        backgroundColor: colors,
        borderWidth: 1,
      });
    } else {
      const sortedSKeys = Array.from(allSecondaryKeys).sort();

      sortedSKeys.forEach((sKey, i) => {
        const dataPoints = labels.map((pKey) => primaryMap[pKey][sKey] || 0);
        datasets.push({
          label: sKey,
          data: dataPoints,
          backgroundColor: getColor(sKey, i),
          borderWidth: 1,
          stack: "stack1", // For stacked bar charts
        });
      });
    }

    return { labels, datasets };
  }

  /**
   * Calculates key summary statistics for the filtered data.
   * @param {Array<Object>} filteredData - The data after filtering by date and tags.
   * @returns {{totalIncome: number, totalExpense: number, netChange: number, transactionCount: number}}
   */
  calculateSummaryStats(filteredData) {
    let totalIncome = 0;
    let totalExpense = 0;

    filteredData.forEach((item) => {
      totalIncome += parseAmount(item.Income);
      totalExpense += parseAmount(item.Expense);
    });

    const netChange = totalIncome - totalExpense;
    const transactionCount = filteredData.length;

    return {
      totalIncome,
      totalExpense,
      netChange,
      transactionCount,
    };
  }

  /**
   * Calculates the "Effective Balance" (Safe-to-Spend).
   * Effective Balance = Current Balance - Net Contribution of Active Trips.
   * This removes money that is currently tied up in ongoing trips/events.
   * @param {number} currentBalance - The total current balance of the treasury.
   * @param {Array<Object>} expenses - The full list of expense objects.
   * @param {Object} tripStatusMap - Map of trip names to their status ('Active', 'Completed', 'Investment').
   * @returns {number} The effective balance.
   */
  calculateEffectiveBalance(currentBalance, expenses, tripStatusMap = {}) {
    // Filter expenses for active trips
    // We want transactions where Trip/Event matches a key in TripStatusMap with value 'Active'
    const activeTripExpenses = expenses.filter((item) => {
      const tripName = item["Trip/Event"];
      return tripName && tripStatusMap[tripName] === "Active";
    });

    // Calculate Net sum of active transactions
    let netActiveContribution = 0;
    activeTripExpenses.forEach((item) => {
      const inc = parseAmount(item.Income);
      const exp = parseAmount(item.Expense);
      netActiveContribution += inc - exp;
    });

    return currentBalance - netActiveContribution;
  }

  /**
   * Helper to filter trips based on status.
   * @param {string[]} allTrips - List of all trips.
   * @param {Object} tripStatusMap - Map of trip names to their status.
   * @param {string} tripStatusFilter - The status to filter by.
   * @returns {string[]} List of visible trips.
   */
  getVisibleTrips(allTrips, tripStatusMap, tripStatusFilter) {
    return allTrips.filter((trip) => {
      if (tripStatusFilter === "All" || tripStatusFilter === "") return true;
      const status = tripStatusMap[trip];
      return status === tripStatusFilter;
    });
  }

  /**
   * Calculates the state of tag filters (visible trips, types, and their checked status).
   * @param {Object} tagsData - The raw tags data from the store.
   * @param {string} tripStatusFilter - Current trip status filter ('All', 'Active', etc.).
   * @param {Set} selectedTrips - Set of currently selected trips.
   * @returns {Object} { visibleTrips, visibleTypes, typeStatusMap, filteredTagsData }
   */
  calculateTagFilterState(tagsData, tripStatusFilter, selectedTrips) {
    const tripStatusMap = tagsData.TripStatusMap || {};
    const tripTypeMap = tagsData.TripTypeMap || {};
    const allTrips = tagsData["Trip/Event"] || [];

    // Filter Trips based on Scope
    const visibleTrips = this.getVisibleTrips(
      allTrips,
      tripStatusMap,
      tripStatusFilter,
    );

    // Determine Visible Types based on Visible Trips
    const visibleTypesSet = new Set();
    visibleTrips.forEach((trip) => {
      const type = tripTypeMap[trip];
      if (type) visibleTypesSet.add(type);
    });
    const visibleTypes = Array.from(visibleTypesSet);

    // Calculate Type Status Map based on visible Trips
    const typeStatusMap = {};

    visibleTypes.forEach((type) => {
      // Only consider visible trips for this type calculation
      const tripsForType = visibleTrips.filter((t) => tripTypeMap[t] === type);

      if (tripsForType.length === 0) {
        typeStatusMap[type] = "unchecked";
        return;
      }

      const selectedCount = tripsForType.filter((t) =>
        selectedTrips.has(t),
      ).length;

      if (selectedCount === 0) {
        typeStatusMap[type] = "unchecked";
      } else if (selectedCount === tripsForType.length) {
        typeStatusMap[type] = "checked";
      } else {
        typeStatusMap[type] = "indeterminate";
      }
    });

    const filteredTagsData = {
      ...tagsData,
      "Trip/Event": visibleTrips,
      Type: visibleTypes,
    };

    return {
      visibleTrips,
      visibleTypes,
      typeStatusMap,
      filteredTagsData,
    };
  }

  /**
   * Generates a CSV string from the aggregated data.
   * @param {Array<string>} labels - The row labels (X-axis).
   * @param {Array<Object>} datasets - The datasets containing values.
   * @param {Object} options - formatting options (primaryGroup, secondaryGroup, metric, timeUnit).
   * @returns {string} The CSV content.
   */
  generateCSV(labels, datasets, options) {
    const { primaryGroup, secondaryGroup, metric, timeUnit } = options;

    const escapeCSV = (value) => {
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Header Row
    let header =
      primaryGroup === "date"
        ? `Date (${timeUnit})`
        : primaryGroup.charAt(0).toUpperCase() + primaryGroup.slice(1);

    header = escapeCSV(header);

    if (secondaryGroup !== "none") {
      const secondaryKeys = datasets.map((d) => d.label);
      header += "," + secondaryKeys.map(escapeCSV).join(",") + ",Total";
    } else {
      header +=
        "," + escapeCSV(metric.charAt(0).toUpperCase() + metric.slice(1));
    }
    header += "\n";

    // Data Rows
    const rows = labels
      .map((label, dataIndex) => {
        let rowStr = escapeCSV(label);

        if (secondaryGroup !== "none") {
          let rowTotal = 0;
          datasets.forEach((dataset) => {
            const value = dataset.data[dataIndex] || 0;
            rowStr += `,${escapeCSV(value)}`;
            rowTotal += value;
          });
          rowStr += `,${escapeCSV(rowTotal)}`;
        } else {
          const value = datasets[0].data[dataIndex] || 0;
          rowStr += `,${escapeCSV(value)}`;
        }
        return rowStr;
      })
      .join("\n");

    return header + rows;
  }

  /**
   * Returns the configuration state for a given preset.
   * @param {string} presetName - The name of the preset.
   * @returns {Object} Partial state object to be merged.
   */
  getPresetState(presetName) {
    const defaultState = {
      selectedCategories: new Set(),
      selectedTrips: new Set(),
      categorySearchTerm: "",
      tripSearchTerm: "",
      typeSearchTerm: "",
      tripStatusFilter: "All",
      secondaryGroup: "none",
    };

    switch (presetName) {
      case "trip_cost_completed":
        return {
          ...defaultState,
          timeframe: "all_time",
          metric: "net",
          chartType: "bar",
          primaryGroup: "trip",
          tripStatusFilter: "Completed",
        };
      case "category_breakdown":
        return {
          ...defaultState,
          timeframe: "past_year",
          metric: "expense",
          chartType: "bar",
          primaryGroup: "category",
          secondaryGroup: "trip",
        };
      case "monthly_trend":
        return {
          ...defaultState,
          timeframe: "past_year",
          metric: "net",
          chartType: "bar",
          primaryGroup: "date",
          timeUnit: "month",
        };
      case "active_trip_status":
        return {
          ...defaultState,
          timeframe: "all_time",
          metric: "net",
          chartType: "bar",
          primaryGroup: "trip",
          tripStatusFilter: "Active",
        };
      default:
        return defaultState;
    }
  }
}

export default new AnalysisLogic();
