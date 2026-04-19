// src/services/excel.service.js

// This service depends on the 'read-excel-file' library.
// The library code is located in src/lib.

function normalizeDateString(dateValue) {
  if (dateValue === null || dateValue === undefined || dateValue === "") {
    return "";
  }

  // Handle JavaScript Date objects
  if (dateValue instanceof Date) {
    const yyyy = dateValue.getFullYear();
    const mm = String(dateValue.getMonth() + 1).padStart(2, "0");
    const dd = String(dateValue.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Convert to string and trim
  let dateString = String(dateValue).trim();

  // Handle DD/MM/YYYY format from Excel
  // Note: Assumes DD/MM/YYYY format. For MM/DD/YYYY, adjust the logic below.
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
    try {
      const parts = dateString.split("/");
      if (parts.length === 3) {
        // Assuming DD/MM/YYYY format - convert to YYYY-MM-DD
        const day = parts[0];
        const month = parts[1];
        const year = parts[2];
        // Format to YYYY-MM-DD with leading zeros
        const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(
          2,
          "0",
        )}`;

        // Validate the date is valid (e.g., prevent 31/02/2024)
        const dateObj = new Date(normalized);

        // Check if the components match after parsing to detect rollovers
        const parsedDay = dateObj.getUTCDate();
        const parsedMonth = dateObj.getUTCMonth() + 1;
        const parsedYear = dateObj.getUTCFullYear();

        if (
          dateObj.toString() === "Invalid Date" ||
          dateObj.toISOString().split("T")[0] !== normalized ||
          parsedDay !== parseInt(day, 10) ||
          parsedMonth !== parseInt(month, 10) ||
          parsedYear !== parseInt(year, 10)
        ) {
          return dateString; // Return original if invalid
        }
        return normalized;
      }
    } catch (e) {
      // If parsing fails, return the original string
      return dateString;
    }
  }

  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString; // Already in correct format
  }

  // Handle ISO date strings (YYYY-MM-DDTHH:MM:SS.mmmZ)
  if (dateString.includes("T") && dateString.includes("Z")) {
    try {
      // Extract just the date part (YYYY-MM-DD) before the 'T'
      return dateString.split("T")[0];
    } catch (e) {
      return dateString;
    }
  }

  // Handle date-time strings that might have been converted by Google Sheets (e.g., "2024-10-19 23:00:00")
  if (/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(dateString)) {
    try {
      // Extract just the date part (YYYY-MM-DD) before the time
      return dateString.split(" ")[0];
    } catch (e) {
      return dateString;
    }
  }

  // For other formats, return as-is
  return dateString;
}

function parseExcelNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return val;
  // Remove currency symbols and commas, then parse
  const cleaned = String(val)
    .replace(/[£$€¥,\s]/g, "")
    .replace(/[A-Z]{3}$/, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function parseAndCleanData(rows) {
  const transactions = [];
  let headerIndex = -1;

  // Find the header row index (scanning first 20 rows for "date" and "description")
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const rowStrings = row.map((cell) => String(cell || "").toLowerCase());
    const hasDate = rowStrings.some((s) => s.includes("date"));
    const hasDescription = rowStrings.some((s) => s.includes("description"));

    if (hasDate && hasDescription) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Couldn't find the header row in the Excel file.");
  }

  const headers = rows[headerIndex].map((h) => String(h || "").toLowerCase());

  const dateCol = headers.findIndex((h) => h.includes("date"));
  const documentCol = headers.findIndex(
    (h) => h.includes("document") || h.includes("ref"),
  );
  const descriptionCol = headers.findIndex((h) => h.includes("description"));

  // Robust matching for In/Out columns
  const cashInCol = headers.findIndex(
    (h) =>
      (/\bin\b/.test(h) && (h.includes("cash") || h.includes("amount"))) ||
      h.includes("credit") ||
      h.includes("deposit"),
  );
  const cashOutCol = headers.findIndex(
    (h) =>
      (/\bout\b/.test(h) && (h.includes("cash") || h.includes("amount"))) ||
      h.includes("debit") ||
      h.includes("withdrawal"),
  );

  if (dateCol === -1 || descriptionCol === -1) {
    throw new Error(
      "Required columns (date, description) not found in header row.",
    );
  }

  if (cashInCol === -1 && cashOutCol === -1) {
    throw new Error(
      "Neither 'cash in' nor 'cash out' columns found in header row.",
    );
  }

  let currentTransaction = null;

  const pushCurrentTransaction = () => {
    if (currentTransaction) {
      transactions.push({
        date: currentTransaction.date,
        document: currentTransaction.documentParts.join("\n"),
        description: currentTransaction.descriptionParts.join(" "),
        cashIn: currentTransaction.cashIn,
        cashOut: currentTransaction.cashOut,
      });
    }
  };

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // Convert row to text safely for footer detection
    const rowText = row
      .map((cell) => String(cell || ""))
      .join(" ")
      .toLowerCase();
    if (
      rowText.includes("please note recent transactions may not be included") ||
      rowText.includes("pending transactions")
    ) {
      break;
    }

    const date = row[dateCol];

    if (date) {
      pushCurrentTransaction();
      currentTransaction = {
        date: normalizeDateString(date),
        documentParts:
          documentCol !== -1 && row[documentCol]
            ? [String(row[documentCol])]
            : [],
        descriptionParts: row[descriptionCol]
          ? [String(row[descriptionCol])]
          : [],
        cashIn: cashInCol !== -1 ? parseExcelNumber(row[cashInCol]) : null,
        cashOut: cashOutCol !== -1 ? parseExcelNumber(row[cashOutCol]) : null,
      };
    } else if (currentTransaction) {
      if (documentCol !== -1 && row[documentCol]) {
        const val = String(row[documentCol]);
        if (!currentTransaction.documentParts.includes(val)) {
          currentTransaction.documentParts.push(val);
        }
      }
      if (row[descriptionCol]) {
        const val = String(row[descriptionCol]);
        if (!currentTransaction.descriptionParts.includes(val)) {
          currentTransaction.descriptionParts.push(val);
        }
      }
    }
  }

  pushCurrentTransaction();

  return transactions;
}

const ExcelService = {
  parseFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof readXlsxFile === "undefined") {
        return reject(new Error("The 'readXlsxFile' library is not loaded."));
      }
      readXlsxFile(file)
        .then((rows) => {
          const cleanedData = parseAndCleanData(rows);
          resolve(cleanedData);
        })
        .catch((error) => {
          reject(error);
        });
    });
  },
};

export default ExcelService;
