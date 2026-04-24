import {
  filterTransactionsByTimeframe,
  parseAmount,
} from "../../core/utils.js";

/**
 * Calculates a "virtual" TripTypeMap by applying pending queue operations
 * to the original map.
 *
 * @param {Object} originalMap - The original TripTypeMap from store
 * @param {Array} queue - Array of pending operations
 * @returns {Object} A new TripTypeMap with operations applied
 */
export const getVirtualTripTypeMap = (originalMap, queue) => {
  let virtualMap = { ...(originalMap || {}) };

  if (!queue || queue.length === 0) return virtualMap;

  queue.forEach((op) => {
    if (op.type === "updateTripType") {
      if (!op.newValue || op.newValue === "") {
        delete virtualMap[op.oldValue];
      } else {
        virtualMap[op.oldValue] = op.newValue;
      }
    }
    // Handle renames/deletes for Trip names in the Map
    if (op.type === "rename" && op.tagType === "Trip/Event") {
      if (virtualMap[op.oldValue]) {
        virtualMap[op.newValue] = virtualMap[op.oldValue];
        delete virtualMap[op.oldValue];
      }
    }
    if (op.type === "delete" && op.tagType === "Trip/Event") {
      delete virtualMap[op.value];
    }

    // Handle renames/deletes for the Types themselves (affects the map values)
    if (op.type === "rename" && op.tagType === "Type") {
      Object.keys(virtualMap).forEach((key) => {
        if (virtualMap[key] === op.oldValue) {
          virtualMap[key] = op.newValue;
        }
      });
    }
    if (op.type === "delete" && op.tagType === "Type") {
      Object.keys(virtualMap).forEach((key) => {
        if (virtualMap[key] === op.value) {
          delete virtualMap[key];
        }
      });
    }
  });

  return virtualMap;
};

/**
 * Calculates a virtual list of tags (Category, Type, etc) based on pending operations.
 * @param {Array} originalList
 * @param {Array} queue
 * @param {string} tagType
 * @returns {Array}
 */
export const getVirtualTagList = (originalList, queue, tagType) => {
  let virtualList = [...(originalList || [])];
  if (!queue || queue.length === 0) return virtualList;

  queue.forEach((op) => {
    if (op.tagType === tagType) {
      if (op.type === "add") {
        if (!virtualList.includes(op.value)) virtualList.push(op.value);
      } else if (op.type === "delete") {
        virtualList = virtualList.filter((v) => v !== op.value);
      } else if (op.type === "rename") {
        virtualList = virtualList
          .map((v) => (v === op.oldValue ? op.newValue : v))
          .filter((v, i, arr) => arr.indexOf(v) === i);
      }
    }
  });
  return virtualList;
};

/**
 * Calculates a "virtual" TripStatusMap by applying pending queue operations.
 *
 * @param {Object} originalMap - The original TripStatusMap from store
 * @param {Array} queue - Array of pending operations
 * @returns {Object} A new TripStatusMap with operations applied
 */
export const getVirtualTripStatusMap = (originalMap, queue) => {
  let virtualMap = { ...(originalMap || {}) };

  if (!queue || queue.length === 0) return virtualMap;

  queue.forEach((op) => {
    if (op.type === "updateTripStatus") {
      virtualMap[op.oldValue] = op.newValue;
    }
    // Handle renames/deletes for Status Map
    if (op.type === "rename" && op.tagType === "Trip/Event") {
      const status = virtualMap[op.oldValue] || "Active";
      delete virtualMap[op.oldValue];
      virtualMap[op.newValue] = status;
    }
    if (op.type === "delete" && op.tagType === "Trip/Event") {
      delete virtualMap[op.value];
    }
    // New trips default to Active
    if (op.type === "add" && op.tagType === "Trip/Event") {
      virtualMap[op.value] = "Active";
    }
  });

  return virtualMap;
};

/**
 * Calculates count, income, and expense stats for a list of transactions.
 * Used by TagsDetails.
 *
 * @param {Array} transactions
 * @returns {Object} { count, income, expense }
 */
export const calculateDetailStats = (transactions) => {
  let count = 0;
  let income = 0;
  let expense = 0;

  transactions.forEach((item) => {
    count++;
    income += parseAmount(item["Income"]);
    expense += parseAmount(item["Expense"]);
  });

  return { count, income, expense };
};

/**
 * aggregateStats
 * Core logic for aggregating transaction data into tags.
 */
export const calculateTagStats = (
  allExpenses,
  tagsData,
  timeframe,
  queue = [],
  isEditMode = false,
) => {
  const expenses = filterTransactionsByTimeframe(allExpenses, timeframe);
  const stats = { "Trip/Event": {}, Category: {}, Type: {} };

  // 1. Calculate Trip/Event and Category stats directly from expenses
  expenses.forEach((item) => {
    const tripEventTag = item["Trip/Event"];
    const categoryTag = item["Category"];
    const income = parseAmount(item["Income"]);
    const expense = parseAmount(item["Expense"]);

    if (tripEventTag) {
      if (!stats["Trip/Event"][tripEventTag])
        stats["Trip/Event"][tripEventTag] = { count: 0, income: 0, expense: 0 };
      stats["Trip/Event"][tripEventTag].count += 1;
      stats["Trip/Event"][tripEventTag].income += income;
      stats["Trip/Event"][tripEventTag].expense += expense;
    }
    if (categoryTag) {
      if (!stats["Category"][categoryTag])
        stats["Category"][categoryTag] = { count: 0, income: 0, expense: 0 };
      stats["Category"][categoryTag].count += 1;
      stats["Category"][categoryTag].income += income;
      stats["Category"][categoryTag].expense += expense;
    }
  });

  // 2. Handle Queue for Trip/Event and Category (Virtual Updates)
  // We do this BEFORE Type aggregation so Type stats are correct for renamed trips.
  if (queue && queue.length > 0) {
    queue.forEach((op) => {
      if (
        op.type === "rename" &&
        (op.tagType === "Trip/Event" || op.tagType === "Category")
      ) {
        const type = op.tagType;
        if (stats[type]) {
          const oldStats = stats[type][op.oldValue] || {
            count: 0,
            income: 0,
            expense: 0,
          };
          if (stats[type][op.newValue]) {
            stats[type][op.newValue].count += oldStats.count;
            stats[type][op.newValue].income += oldStats.income;
            stats[type][op.newValue].expense += oldStats.expense;
          } else {
            stats[type][op.newValue] = { ...oldStats };
          }
          delete stats[type][op.oldValue];
        }
      } else if (
        op.type === "delete" &&
        (op.tagType === "Trip/Event" || op.tagType === "Category")
      ) {
        if (stats[op.tagType]) delete stats[op.tagType][op.value];
      }
    });
  }

  // 3. Calculate Type stats by aggregating Trip/Event stats based on TripTypeMap
  const tripTypeMap = getVirtualTripTypeMap(tagsData.TripTypeMap, queue);
  const tripStatusMap = getVirtualTripStatusMap(tagsData.TripStatusMap, queue);

  Object.entries(stats["Trip/Event"]).forEach(([tripName, tripStats]) => {
    const type = tripTypeMap[tripName];
    if (type) {
      if (!stats["Type"][type])
        stats["Type"][type] = { count: 0, income: 0, expense: 0 };
      stats["Type"][type].count += tripStats.count;
      stats["Type"][type].income += tripStats.income;
      stats["Type"][type].expense += tripStats.expense;
    }
  });

  // 4. Handle Queue for Type renames (Virtual Updates)
  if (queue && queue.length > 0) {
    queue.forEach((op) => {
      if (op.type === "rename" && op.tagType === "Type") {
        if (stats["Type"]) {
          const oldStats = stats["Type"][op.oldValue] || {
            count: 0,
            income: 0,
            expense: 0,
          };
          if (stats["Type"][op.newValue]) {
            stats["Type"][op.newValue].count += oldStats.count;
            stats["Type"][op.newValue].income += oldStats.income;
            stats["Type"][op.newValue].expense += oldStats.expense;
          } else {
            stats["Type"][op.newValue] = { ...oldStats };
          }
          delete stats["Type"][op.oldValue];
        }
      } else if (op.type === "delete" && op.tagType === "Type") {
        if (stats["Type"]) delete stats["Type"][op.value];
      }
    });
  }

  // 5. Ensure all "Types" from virtual list exist in stats even if count is 0
  const virtualTypes = getVirtualTagList(tagsData["Type"], queue, "Type");
  virtualTypes.forEach((t) => {
    if (!stats["Type"][t])
      stats["Type"][t] = { count: 0, income: 0, expense: 0 };
  });

  return { stats, tripTypeMap, tripStatusMap };
};

/**
 * Optimizes the operation queue by removing redundant or cancelled operations.
 * e.g. Add A -> Delete A => []
 *      Rename A->B -> Rename B->C => Rename A->C
 *
 * @param {Array} queue
 * @param {Object} originalTags - Optional. Map of existing tags to check for redundancy.
 * @returns {Array} Optimized queue
 */
export const optimizeQueue = (queue, originalTags = null) => {
  if (!queue || queue.length === 0) return [];

  const optimized = [];

  for (const op of queue) {
    let merged = false;

    // Handle "add" followed by "delete"
    if (op.type === "delete") {
      const addIndex = optimized.findIndex(
        (o) =>
          o.type === "add" && o.value === op.value && o.tagType === op.tagType,
      );
      if (addIndex !== -1) {
        // Found corresponding add.

        // Check if item existed originally (meaning Add was redundant)
        let existedOriginally = false;
        if (
          originalTags &&
          originalTags[op.tagType] &&
          Array.isArray(originalTags[op.tagType])
        ) {
          existedOriginally = originalTags[op.tagType].includes(op.value);
        }

        if (existedOriginally) {
          // Add was redundant (no-op), but Delete is real.
          // Remove the Add, but do NOT set merged=true, so Delete is added to queue.
          optimized.splice(addIndex, 1);
          merged = false;
        } else {
          // Truly new item. Add + Delete = Cancel.
          optimized.splice(addIndex, 1);
          merged = true;
        }
      } else {
        // Check for Rename X -> A (where A is now being deleted)
        const renameIndex = optimized.findIndex(
          (o) =>
            o.type === "rename" &&
            o.newValue === op.value &&
            o.tagType === op.tagType,
        );
        if (renameIndex !== -1) {
          const prevOp = optimized[renameIndex];
          // Replace "Rename X -> A" + "Delete A" with "Delete X"
          optimized[renameIndex] = {
            ...op,
            value: prevOp.oldValue,
            type: "delete",
          };
          merged = true;
        }
      }
    }
    // Handle chained renames
    else if (op.type === "rename") {
      // Check if there was an Add A
      const addIndex = optimized.findIndex(
        (o) =>
          o.type === "add" &&
          o.value === op.oldValue &&
          o.tagType === op.tagType,
      );
      if (addIndex !== -1) {
        // "Add A" + "Rename A->B" = "Add B"
        optimized[addIndex] = { ...optimized[addIndex], value: op.newValue };
        merged = true;
      } else {
        // Check for previous rename X -> A
        const renameIndex = optimized.findIndex(
          (o) =>
            o.type === "rename" &&
            o.newValue === op.oldValue &&
            o.tagType === op.tagType,
        );
        if (renameIndex !== -1) {
          // "Rename X->A" + "Rename A->B" = "Rename X->B"
          const prevOp = optimized[renameIndex];
          // If X === B, then it's a circular rename back to start? Rename X->A->X.
          if (prevOp.oldValue === op.newValue) {
            optimized.splice(renameIndex, 1); // Remove both
          } else {
            optimized[renameIndex] = { ...prevOp, newValue: op.newValue };
          }
          merged = true;
        }
      }
    }
    // Handle multiple updates to same Trip
    else if (op.type === "updateTripType") {
      const existingIndex = optimized.findIndex(
        (o) =>
          o.type === "updateTripType" &&
          o.oldValue === op.oldValue &&
          (o.tagType || "Trip/Event") === (op.tagType || "Trip/Event"),
      );
      if (existingIndex !== -1) {
        optimized[existingIndex] = op;
        merged = true;
      }
    }
    // Handle multiple updates to same Trip Status
    else if (op.type === "updateTripStatus") {
      const existingIndex = optimized.findIndex(
        (o) => o.type === "updateTripStatus" && o.oldValue === op.oldValue,
      );
      if (existingIndex !== -1) {
        optimized[existingIndex] = op;
        merged = true;
      }
    }

    if (!merged) {
      optimized.push(op);
    }
  }

  return optimized;
};

/**
 * Formats the edit queue into API operations.
 * Intentionally does NOT call optimizeQueue so the output is 1:1 with
 * the input queue — required for accurate error-recovery slicing in handleSave.
 *
 * @param {Array} queue
 * @returns {Array} Array of operations for the API
 */
export const formatOperationsForApi = (queue) => {
  return queue
    .map((op) => {
      if (op.type === "add") return [null, op.value, "add", op.tagType];
      if (op.type === "delete") return [op.value, null, "delete", op.tagType];
      if (op.type === "rename")
        return [op.oldValue, op.newValue, "rename", op.tagType];
      if (op.type === "updateTripType")
        return [
          op.oldValue,
          op.newValue,
          "updateTripType",
          op.tagType || "Trip/Event",
        ];
      if (op.type === "updateTripStatus")
        return [op.oldValue, op.newValue, "updateTripStatus", "Trip/Event"];
      return null;
    })
    .filter((op) => op !== null);
};
