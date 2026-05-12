import { parseAmount } from "./utils.js";

/**
 * Calculates financial totals and balances, accounting for "Manual" transactions as historical adjustments.
 *
 * Logic:
 * - "Manual" transactions represent activity that occurred prior to the configured Opening Balance.
 * - They are INCLUDED in `totalIncome` and `totalExpenses` so they appear in reports and charts.
 * - To prevent these historical amounts from double-counting against the start balance, the
 *   Opening Balance is adjusted inversely:
 *     - Manual Expense: Increases Adjusted Opening Balance.
 *     - Manual Income: Decreases Adjusted Opening Balance.
 *
 * This ensures:
 *   Current Balance = Adjusted Opening Balance + Total Income - Total Expenses
 *   (Where the net effect of manual transactions on the Current Balance is zero).
 *
 * NOTE: `adjustedOpeningBalance` is the "pre-Manual" seed
 * (= openingBalance − netManual). When reconstructing a running balance over
 * time, Manual rows are still expected to be summed on top of it — that is
 * what brings the balance back to `openingBalance` at the Manual→Excel
 * boundary. See analysis.logic.js#aggregateData (balance branch).
 *
 * @param {number|string} openingBalance - The configured initial balance.
 * @param {Array} transactions - List of all transactions.
 * @returns {object} - { manualOffset, adjustedOpeningBalance, currentBalance, totalIncome, totalExpenses }
 */
export function calculateFinancials(openingBalance, transactions) {
  const safeOpeningBalance = parseFloat(openingBalance) || 0;

  let manualIncome = 0;
  let manualExpense = 0;
  let totalIncome = 0;
  let totalExpenses = 0;

  const safeTransactions = transactions || [];

  safeTransactions.forEach((item) => {
    const safeInc = parseAmount(item.Income);
    const safeExp = parseAmount(item.Expense);

    if (item.Type === "Manual") {
      manualIncome += safeInc;
      manualExpense += safeExp;
    }

    // Totals include EVERYTHING (Regular + Manual)
    totalIncome += safeInc;
    totalExpenses += safeExp;
  });

  // Adjust opening balance inversely to neutralize the effect of historical manual transactions on the current balance.
  const manualOffset = manualExpense - manualIncome;
  const adjustedOpeningBalance = safeOpeningBalance + manualOffset;
  const currentBalance = adjustedOpeningBalance + totalIncome - totalExpenses;

  return {
    manualOffset,
    adjustedOpeningBalance,
    currentBalance,
    totalIncome,
    totalExpenses,
  };
}
