const Service_Split = {
  SPLIT_SHEET_NAME: "Split Transactions",
  SPLIT_TYPE_SOURCE: "SOURCE",
  SPLIT_TYPE_CHILD: "CHILD",
  SPLIT_TYPE_PENDING: "PENDING",
  PENDING_SWEEP_MS: 10 * 60 * 1000,

  /**
   * Processes a split transaction by archiving the original and creating child entries.
   * @param {Object} e - Event object with parameter.data containing JSON payload
   * @param {Object} e.parameter.data.original - Original transaction with row index
   * @param {Array} e.parameter.data.splits - Array of split transactions
   * @returns {Object} Response object with success, message, and optional splitGroupId
   */
  processSplit: function (e) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      if (!e || !e.parameter || !e.parameter.data) {
        return { success: false, message: "Missing request data." };
      }

      const data = JSON.parse(e.parameter.data);
      if (!data || !data.original || !data.splits) {
        return { success: false, message: "Invalid data structure." };
      }
      const original = data.original;
      const splits = data.splits;

      const financeSheet = _getFinanceSheet();
      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      return _processSplitCore(financeSheet, splitSheet, original, splits);
    } catch (error) {
      console.error("Split error", error);
      return {
        success: false,
        message: "Failed to split transaction. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Removes a specific tag from all split transactions.
   * @param {string} type - Type of tag ("Trip/Event" or "Category")
   * @param {string} value - Value of the tag to remove
   * @returns {Object} Response object with success and message
   */
  removeTagFromSplits: function (type, value) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;
      const lastRow = splitSheet.getLastRow();
      if (lastRow <= 1)
        return { success: true, message: "No splits to check." };

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      let colIndex; // 1-based column index
      if (type === "Trip/Event") {
        const idx = CONFIG.HEADERS.indexOf("Trip/Event");
        if (idx === -1)
          return { success: false, message: "Trip/Event column not found." };
        colIndex = idx + 1;
      } else if (type === "Category") {
        const idx = CONFIG.HEADERS.indexOf("Category");
        if (idx === -1)
          return { success: false, message: "Category column not found." };
        colIndex = idx + 1;
      } else return { success: false, message: "Invalid tag type." };

      const range = splitSheet.getRange(2, colIndex, lastRow - 1, 1);
      const values = range.getValues();
      const modifiedRows = [];

      for (let i = 0; i < values.length; i++) {
        if (values[i][0] === value) {
          values[i][0] = "";
          modifiedRows.push(i + 2); // 1-based sheet row
        }
      }

      if (modifiedRows.length > 0) {
        range.setValues(values);
      }
      return { success: true, modifiedRows: modifiedRows };
    } catch (error) {
      console.error("Remove tag error", error);
      return {
        success: false,
        message: "Failed to remove tag. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Restores a tag value to specific split rows. Used as the inverse of
   * removeTagFromSplits during batch rollback.
   * @param {string} type - Type of tag ("Trip/Event" or "Category")
   * @param {string} value - Value to restore
   * @param {number[]} rowIndices - 1-based sheet row indices to restore
   * @returns {Object} Response object with success and message
   */
  restoreTagInSplits: function (type, value, rowIndices) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!Array.isArray(rowIndices) || rowIndices.length === 0) {
        return { success: true, message: "No rows to restore." };
      }

      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;
      const lastRow = splitSheet.getLastRow();
      if (lastRow <= 1) {
        return {
          success: false,
          message: "Splits sheet is empty; cannot restore tag.",
        };
      }

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      let colIndex;
      if (type === "Trip/Event") {
        const idx = CONFIG.HEADERS.indexOf("Trip/Event");
        if (idx === -1)
          return { success: false, message: "Trip/Event column not found." };
        colIndex = idx + 1;
      } else if (type === "Category") {
        const idx = CONFIG.HEADERS.indexOf("Category");
        if (idx === -1)
          return { success: false, message: "Category column not found." };
        colIndex = idx + 1;
      } else return { success: false, message: "Invalid tag type." };

      for (let i = 0; i < rowIndices.length; i++) {
        const row = rowIndices[i];
        if (row < 2 || row > lastRow) {
          return {
            success: false,
            message: "Row index out of range: " + row,
          };
        }
      }

      for (let i = 0; i < rowIndices.length; i++) {
        splitSheet.getRange(rowIndices[i], colIndex).setValue(value);
      }

      return { success: true, message: "Tag restored successfully." };
    } catch (error) {
      console.error("Error restoring tag in splits:", error);
      return {
        success: false,
        message: "Failed to restore tag. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Updates a specific tag in all split transactions.
   * @param {string} oldTag - The old tag value to be replaced
   * @param {string} newTag - The new tag value
   * @param {string} type - Type of tag ("Trip/Event" or "Category")
   * @returns {Object} Response object with success and message
   */
  updateTagInSplits: function (oldTag, newTag, type) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;
      const lastRow = splitSheet.getLastRow();
      if (lastRow <= 1)
        return { success: true, message: "No splits to check." };

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      let colIndex; // 1-based column index
      if (type === "Trip/Event") {
        const idx = CONFIG.HEADERS.indexOf("Trip/Event");
        if (idx === -1)
          return { success: false, message: "Trip/Event column not found." };
        colIndex = idx + 1;
      } else if (type === "Category") {
        const idx = CONFIG.HEADERS.indexOf("Category");
        if (idx === -1)
          return { success: false, message: "Category column not found." };
        colIndex = idx + 1;
      } else return { success: false, message: "Invalid tag type." };

      const range = splitSheet.getRange(2, colIndex, lastRow - 1, 1);
      const values = range.getValues();
      let changed = false;

      for (let i = 0; i < values.length; i++) {
        if (values[i][0] === oldTag) {
          values[i][0] = newTag;
          changed = true;
        }
      }

      if (changed) {
        range.setValues(values);
      }
      return { success: true };
    } catch (error) {
      console.error("Update tag error", error);
      return {
        success: false,
        message: "Failed to update tag. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Updates tags for a specific split transaction row.
   * @param {string} rowId - The unique identifier for the split row (e.g., "S-2")
   * @param {string} tripEvent - The new Trip/Event tag value
   * @param {string} category - The new Category tag value
   * @returns {Object} Response object with success and message
   */
  updateSplitRowTag: function (rowId, tripEvent, category) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      // rowId format: "S-<rowIndex>"
      const rowIndex = parseInt(rowId.replace("S-", ""), 10);

      if (
        isNaN(rowIndex) ||
        rowIndex < 2 ||
        rowIndex > splitSheet.getLastRow()
      ) {
        return { success: false, message: "Invalid split row index." };
      }

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      const tripEventIndex = CONFIG.HEADERS.indexOf("Trip/Event");
      const categoryIndex = CONFIG.HEADERS.indexOf("Category");

      if (tripEventIndex === -1 || categoryIndex === -1) {
        return {
          success: false,
          message:
            "Configuration Error: Required columns missing in CONFIG.HEADERS.",
        };
      }

      // Validate tag values against the known taxonomy (issue 12)
      const tripVal = tripEvent || "";
      const catVal = category || "";
      if (tripVal || catVal) {
        const validTags = Service_Tags.getTags();
        const validTripEvents = new Set(validTags["Trip/Event"]);
        const validCategories = new Set(validTags["Category"]);
        if (tripVal && !validTripEvents.has(tripVal)) {
          console.warn("Invalid Trip/Event tag rejected:", tripVal);
          return { success: false, message: "Invalid Trip/Event tag." };
        }
        if (catVal && !validCategories.has(catVal)) {
          console.warn("Invalid Category tag rejected:", catVal);
          return { success: false, message: "Invalid Category tag." };
        }
      }

      // Trip/Event is col tripEventIndex + 1, Category is col categoryIndex + 1
      splitSheet
        .getRange(rowIndex, tripEventIndex + 1)
        .setValue(_sanitizeForSheet(tripVal));
      splitSheet
        .getRange(rowIndex, categoryIndex + 1)
        .setValue(_sanitizeForSheet(catVal));

      return { success: true };
    } catch (error) {
      console.error("Update split row tag error", error);
      return {
        success: false,
        message: "Failed to update split row tag. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Reverts a split transaction, removing child entries and clearing the split ID from the original.
   * @param {Object} e - Event object with parameter.groupId containing the split group ID
   * @returns {Object} Response object with success and message
   */
  revertSplit: function (e) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;
      if (!e || !e.parameter || !e.parameter.groupId) {
        return { success: false, message: "No Group ID provided." };
      }
      const groupId = e.parameter.groupId;

      const financeSheet = _getFinanceSheet();
      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      return _revertSplitCore(financeSheet, splitSheet, groupId);
    } catch (error) {
      console.error("Revert error", error);
      return {
        success: false,
        message: "Failed to revert split. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Edits an existing split transaction by reverting the old one and processing the new one.
   * @param {Object} e - Event object with parameter.groupId and parameter.data (new split data)
   * @returns {Object} Response object with success, message, and optional splitGroupId
   */
  editSplit: function (e) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      if (!e || !e.parameter) {
        return { success: false, message: "Missing request parameters." };
      }

      const groupId = e.parameter.groupId;
      // 1. Resolve Finance Sheet Row Index
      const financeSheet = _getFinanceSheet();
      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;
      const idIndex = CONFIG.HEADERS.indexOf("Split Group ID");

      if (idIndex === -1) {
        return {
          success: false,
          message: "Configuration Error: 'Split Group ID' column missing.",
        };
      }

      const financeData = financeSheet.getDataRange().getValues();
      let financeRowIndex = -1;

      // Skip header (index 0), row 1 is index 0 in array but Row 1 in sheet
      for (let i = 1; i < financeData.length; i++) {
        if (financeData[i][idIndex] === groupId) {
          financeRowIndex = i + 1; // 1-based index
          break;
        }
      }

      if (financeRowIndex === -1) {
        return {
          success: false,
          message:
            "Original transaction not found in Finance Sheet for ID: " +
            groupId,
        };
      }

      // 2. Inject Row Index into Data Payload
      if (!e || !e.parameter || !e.parameter.data) {
        return { success: false, message: "Missing request data." };
      }

      let data;
      try {
        data = JSON.parse(e.parameter.data);
        data.original.row = financeRowIndex;
      } catch (err) {
        return { success: false, message: "Invalid JSON data." };
      }

      // 3. Prepare New Split Data (VALIDATION & PREPARATION)
      // This step ensures we can successfully generate the new split data BEFORE destroying the old data.
      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      const preparation = _prepareSplitData(
        financeSheet,
        data.original,
        data.splits,
      );

      if (!preparation.success) {
        return preparation;
      }

      // 4. Capture existing split data for potential rollback
      const existingSplitData = _getSplitGroupData(splitSheet, groupId);

      // 5. Perform Revert (Clean up old split artifacts)
      // Now that preparation succeeded, we can safely remove the old data.
      const revertRes = _revertSplitCore(
        financeSheet,
        splitSheet,
        groupId,
        financeRowIndex,
      );
      if (!revertRes.success) return revertRes;

      // 6. Perform Process (Write New Split)
      // Writing the prepared data.
      const writeRes = _writeSplitData(financeSheet, splitSheet, preparation);

      if (writeRes.success) {
        return {
          success: true,
          message: "Transaction split edited successfully.",
          splitGroupId: writeRes.splitGroupId,
        };
      } else {
        // Attempt to restore the old split data if write fails
        try {
          _restoreSplitData(
            financeSheet,
            splitSheet,
            existingSplitData,
            groupId,
            financeRowIndex,
          );
        } catch (restoreError) {
          console.error(
            "Failed to restore split data after write failure",
            restoreError,
          );
          return {
            success: false,
            message:
              writeRes.message +
              " CRITICAL: Rollback also failed: " +
              restoreError.message,
          };
        }
        return writeRes;
      }
    } catch (error) {
      console.error("Edit split error", error);
      return {
        success: false,
        message: "Failed to edit split. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Retrieves a split group (source transaction and child splits) by ID.
   * @param {Object} e - Event object with parameter.groupId
   * @returns {Object} Response object with success and data {source, children}
   */
  getSplitGroup: function (e) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      // Returns Source + Children for a specific Group ID from the Split Sheet
      if (!e || !e.parameter) {
        return { success: false, message: "Missing request parameters." };
      }
      const groupId = e.parameter.groupId;
      const splitSheetRes = _getSplitSheet(); // Use helper function
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      const data = splitSheet.getDataRange().getValues();
      if (data.length < 2)
        return { success: false, message: "Split group not found." };

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      const headers = data[0];
      const idIndex = headers.indexOf("Split Group ID");
      const typeIndex = headers.indexOf("Split Type");
      const dateIndex = headers.indexOf("Split Date");

      if (idIndex === -1 || typeIndex === -1) {
        return {
          success: false,
          message: "Split sheet corrupted: missing headers.",
        };
      }

      let source = null;
      const children = [];

      for (let i = 1; i < data.length; i++) {
        if (data[i][idIndex] === groupId) {
          const row = data[i];
          if (row[typeIndex] === Service_Split.SPLIT_TYPE_PENDING) continue;
          const obj = {};

          // Map based on CONFIG.HEADERS if present in sheet headers
          CONFIG.HEADERS.forEach((header) => {
            const hIndex = headers.indexOf(header);
            if (hIndex !== -1) {
              obj[header] = row[hIndex];
            }
          });

          if (obj["Date"] instanceof Date) {
            const tz = splitSheet.getParent().getSpreadsheetTimeZone();
            obj["Date"] = Utilities.formatDate(obj["Date"], tz, "yyyy-MM-dd");
          }

          // Map split headers
          if (typeIndex !== -1) obj["Split Type"] = row[typeIndex];
          if (dateIndex !== -1) {
            let sDate = row[dateIndex];
            if (sDate instanceof Date) {
              const tz = splitSheet.getParent().getSpreadsheetTimeZone();
              sDate = Utilities.formatDate(sDate, tz, "yyyy-MM-dd HH:mm:ss");
            }
            obj["Split Date"] = sDate;
          }

          if (row[typeIndex] === Service_Split.SPLIT_TYPE_SOURCE) {
            source = obj;
          } else if (row[typeIndex] === Service_Split.SPLIT_TYPE_CHILD) {
            children.push(obj);
          }
        }
      }

      if (!source) return { success: false, message: "Split group not found." };

      return { success: true, data: { source, children } };
    } catch (error) {
      console.error("Get split group error", error);
      return {
        success: false,
        message: "Failed to fetch split group. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Retrieves a paginated history of split transactions.
   * @param {Object} e - Event object with parameter.page and parameter.pageSize
   * @returns {Object} Response object with success, data array, pagination info
   */
  getSplitHistory: function (e) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      if (!e || !e.parameter) {
        return { success: false, message: "Missing request parameters." };
      }

      const page = parseInt(e.parameter.page) || 1;

      const splitSheetRes = _getSplitSheet(); // Use helper function
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      const lastRow = splitSheet.getLastRow();
      if (lastRow <= 1) {
        // Check if there's any data beyond headers
        return { success: true, data: [], hasMore: false, total: 0 };
      }

      const totalRows = lastRow - 1; // Exclude header
      // Cap pageSize to the actual number of rows so a caller cannot request
      // more data than exists, regardless of what they send.
      const rawPageSize = parseInt(e.parameter.pageSize) || 500;
      const pageSize = Math.min(
        Math.max(1, rawPageSize),
        Math.max(totalRows, 1),
      );

      // Calculate indices
      // 1-based rows. Data starts at row 2.
      // Page 1: start 2, end 2 + 500 - 1
      const startRowIndex = (page - 1) * pageSize + 2;
      const numRows = Math.min(pageSize, lastRow - startRowIndex + 1);

      if (numRows <= 0) {
        return { success: true, data: [], hasMore: false, total: totalRows };
      }

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      // Get Headers first to map correctly
      const headers = splitSheet
        .getRange(1, 1, 1, splitSheet.getLastColumn())
        .getValues()[0];
      const values = splitSheet
        .getRange(startRowIndex, 1, numRows, splitSheet.getLastColumn())
        .getValues();
      const data = [];

      const typeIndex = headers.indexOf("Split Type");
      const dateIndex = headers.indexOf("Split Date");

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (
          typeIndex !== -1 &&
          row[typeIndex] === Service_Split.SPLIT_TYPE_PENDING
        ) {
          continue;
        }
        const obj = {};
        const currentRowIndex = startRowIndex + i;

        obj.row = "S-" + currentRowIndex; // Add unique Split Row ID

        // Map standard headers
        for (let h = 0; h < CONFIG.HEADERS.length; h++) {
          const headerName = CONFIG.HEADERS[h];
          const colIndex = headers.indexOf(headerName);
          if (colIndex !== -1) {
            obj[headerName] = row[colIndex];
          }
        }

        // Map split headers
        if (typeIndex !== -1) obj["Split Type"] = row[typeIndex];
        if (dateIndex !== -1) {
          let sDate = row[dateIndex];
          if (sDate instanceof Date) {
            const tz = splitSheet.getParent().getSpreadsheetTimeZone();
            sDate = Utilities.formatDate(sDate, tz, "yyyy-MM-dd HH:mm:ss");
          }
          obj["Split Date"] = sDate;
        }

        if (obj["Date"] instanceof Date) {
          const tz = splitSheet.getParent().getSpreadsheetTimeZone();
          obj["Date"] = Utilities.formatDate(obj["Date"], tz, "yyyy-MM-dd");
        }

        data.push(obj);
      }

      const hasMore = startRowIndex + numRows - 1 < lastRow;

      return {
        success: true,
        data: data,
        hasMore: hasMore,
        total: totalRows,
        page: page,
      };
    } catch (error) {
      console.error("Get split history error", error);
      return {
        success: false,
        message: "Failed to fetch split history. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },

  /**
   * Retrieves the complete history of all split transactions.
   * @returns {Object} Response object with success and data array
   */
  getAllSplitHistory: function () {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      if (!lock.tryLock(30000)) {
        return { success: false, message: "System is busy. Please try again." };
      }
      lockAcquired = true;

      const splitSheetRes = _getSplitSheet();
      if (!splitSheetRes.success) return splitSheetRes;
      const splitSheet = splitSheetRes.sheet;

      const lastRow = splitSheet.getLastRow();
      if (lastRow <= 1) {
        return { success: true, data: [] };
      }

      const configValidation = _validateConfig();
      if (!configValidation.success) return configValidation;

      const headers = splitSheet
        .getRange(1, 1, 1, splitSheet.getLastColumn())
        .getValues()[0];
      const values = splitSheet
        .getRange(2, 1, lastRow - 1, splitSheet.getLastColumn())
        .getValues();
      const data = [];

      const typeIndex = headers.indexOf("Split Type");
      const dateIndex = headers.indexOf("Split Date");

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (
          typeIndex !== -1 &&
          row[typeIndex] === Service_Split.SPLIT_TYPE_PENDING
        ) {
          continue;
        }
        const obj = {};
        const currentRowIndex = i + 2; // Data starts at row 2, so add 2

        obj.row = "S-" + currentRowIndex; // Add unique Split Row ID

        // Map standard headers
        for (let h = 0; h < CONFIG.HEADERS.length; h++) {
          const headerName = CONFIG.HEADERS[h];
          const colIndex = headers.indexOf(headerName);
          if (colIndex !== -1) {
            obj[headerName] = row[colIndex];
          }
        }

        // Map split headers
        if (typeIndex !== -1) obj["Split Type"] = row[typeIndex];
        if (dateIndex !== -1) {
          let sDate = row[dateIndex];
          if (sDate instanceof Date) {
            const tz = splitSheet.getParent().getSpreadsheetTimeZone();
            sDate = Utilities.formatDate(sDate, tz, "yyyy-MM-dd HH:mm:ss");
          }
          obj["Split Date"] = sDate;
        }

        if (obj["Date"] instanceof Date) {
          const tz = splitSheet.getParent().getSpreadsheetTimeZone();
          obj["Date"] = Utilities.formatDate(obj["Date"], tz, "yyyy-MM-dd");
        }

        data.push(obj);
      }

      return { success: true, data: data };
    } catch (error) {
      console.error("Get all split history error", error);
      return {
        success: false,
        message: "Failed to fetch split history. Please try again.",
      };
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  },
};

// --- HELPER FUNCTIONS (Internal) ---

function _validateConfig() {
  if (
    typeof CONFIG === "undefined" ||
    !CONFIG ||
    !CONFIG.HEADERS ||
    !Array.isArray(CONFIG.HEADERS)
  ) {
    return {
      success: false,
      message: "Configuration error: CONFIG.HEADERS not defined.",
    };
  }
  return { success: true };
}

function _getSplitSheet() {
  const configValidation = _validateConfig();
  if (!configValidation.success) return configValidation;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let splitSheet = spreadsheet.getSheetByName(Service_Split.SPLIT_SHEET_NAME);
  const expectedHeaders = [...CONFIG.HEADERS, "Split Type", "Split Date"];

  if (!splitSheet) {
    splitSheet = spreadsheet.insertSheet(Service_Split.SPLIT_SHEET_NAME);
    splitSheet.appendRow(expectedHeaders);
  } else {
    const lastRow = splitSheet.getLastRow();
    if (lastRow === 0) {
      // Empty sheet, just headers
      splitSheet.appendRow(expectedHeaders);
    } else {
      const currentHeadersRange = splitSheet.getRange(
        1,
        1,
        1,
        splitSheet.getLastColumn(),
      );
      const currentHeaders = currentHeadersRange.getValues()[0];

      // Check if current headers are a prefix of expected headers
      let headersAreConsistent = true;
      for (let i = 0; i < expectedHeaders.length; i++) {
        // If current headers are shorter, or a specific header doesn't match
        if (
          i >= currentHeaders.length ||
          currentHeaders[i] !== expectedHeaders[i]
        ) {
          headersAreConsistent = false;
          break;
        }
      }

      // Also check if current headers are too long (contain extra columns not in expectedHeaders)
      if (currentHeaders.length > expectedHeaders.length) {
        headersAreConsistent = false;
      }

      // If headers don't match, update them
      if (!headersAreConsistent) {
        if (lastRow > 1) {
          return {
            success: false,
            message:
              "Header mismatch detected in Split Sheet. Automatic update blocked because data exists. Please align headers manually or archive existing data.",
          };
        }

        // Clear old headers and set new ones
        // Use clearContent() to remove any extra columns not in expectedHeaders
        splitSheet.getRange(1, 1, 1, splitSheet.getLastColumn()).clearContent();
        splitSheet
          .getRange(1, 1, 1, expectedHeaders.length)
          .setValues([expectedHeaders]);
      }
    }
  }
  return { success: true, sheet: splitSheet };
}

// --- HELPER FUNCTIONS (Internal) ---

function _validateSplitRequest(original, splits) {
  const configValidation = _validateConfig();
  if (!configValidation.success) return configValidation;

  if (!original || !splits || !Array.isArray(splits) || splits.length < 2) {
    return { success: false, message: "Invalid split data." };
  }

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    if (
      !split.Description ||
      split.Amount === undefined ||
      split.Amount === null ||
      split.Amount === ""
    ) {
      return {
        success: false,
        message: "Each split must have a description and amount.",
      };
    }
    if (split.Type !== "Income" && split.Type !== "Expense") {
      return {
        success: false,
        message: 'Each split must have Type "Income" or "Expense".',
      };
    }
    const amt = parseFloat(split.Amount);
    if (isNaN(amt) || amt < 0) {
      return {
        success: false,
        message: "Each split amount must be a positive number.",
      };
    }
  }

  const rowIndex = parseInt(original.row);
  if (isNaN(rowIndex) || rowIndex < 2) {
    return { success: false, message: "Invalid row index." };
  }

  // Validate split amounts sum to original
  const incomeVal =
    original.Income != null && original.Income !== ""
      ? parseFloat(original.Income)
      : null;
  const expenseVal =
    original.Expense != null && original.Expense !== ""
      ? parseFloat(original.Expense)
      : null;

  if (incomeVal !== null && expenseVal !== null) {
    return {
      success: false,
      message:
        "Cannot split a transaction with both Income and Expense populated.",
    };
  }
  if (incomeVal === null && expenseVal === null) {
    return {
      success: false,
      message: "Cannot split a transaction with no Income or Expense amount.",
    };
  }

  // Signed-net check: each split contributes +Amount (Income) or -Amount
  // (Expense). Their signed sum must match the parent's signed net.
  const parentNet = (incomeVal !== null ? incomeVal : 0) -
    (expenseVal !== null ? expenseVal : 0);
  const signedSum = splits.reduce(
    (sum, split) =>
      sum +
      (split.Type === "Income"
        ? parseFloat(split.Amount)
        : -parseFloat(split.Amount)),
    0,
  );
  const tolerance = 0.01; // Allow for rounding errors

  if (Math.abs(parentNet - signedSum) > tolerance) {
    return {
      success: false,
      message: `Split net (${signedSum.toFixed(
        2,
      )}) must equal original net (${parentNet.toFixed(2)}).`,
    };
  }

  const idIndex = CONFIG.HEADERS.indexOf("Split Group ID");
  const descIndex = CONFIG.HEADERS.indexOf("Description");
  const tripEventIndex = CONFIG.HEADERS.indexOf("Trip/Event");
  const categoryIndex = CONFIG.HEADERS.indexOf("Category");
  const incomeIndex = CONFIG.HEADERS.indexOf("Income");
  const expenseIndex = CONFIG.HEADERS.indexOf("Expense");

  if (
    idIndex === -1 ||
    descIndex === -1 ||
    tripEventIndex === -1 ||
    categoryIndex === -1 ||
    incomeIndex === -1 ||
    expenseIndex === -1
  ) {
    return {
      success: false,
      message:
        "Configuration Error: Required columns missing in CONFIG.HEADERS.",
    };
  }

  return { success: true };
}

function _revertSplitCore(financeSheet, splitSheet, groupId, financeRowIndex) {
  const configValidation = _validateConfig();
  if (!configValidation.success) return configValidation;
  const idIndex = CONFIG.HEADERS.indexOf("Split Group ID");
  if (idIndex === -1) {
    return {
      success: false,
      message: "Configuration Error: 'Split Group ID' column missing.",
    };
  }

  // 1. Remove ID from Finance Sheet
  if (!financeRowIndex || financeRowIndex === -1) {
    const financeData = financeSheet.getDataRange().getValues();
    financeRowIndex = -1;

    for (let i = 1; i < financeData.length; i++) {
      if (financeData[i][idIndex] === groupId) {
        financeRowIndex = i + 1;
        break;
      }
    }
  }

  if (financeRowIndex !== -1) {
    financeSheet.getRange(financeRowIndex, idIndex + 1).setValue("");
  }

  // 2. Remove from Split Sheet
  const splitData = splitSheet.getDataRange().getValues();
  const rowsToDelete = [];

  for (let i = splitData.length - 1; i >= 1; i--) {
    if (splitData[i][idIndex] === groupId) {
      rowsToDelete.push(i + 1);
    }
  }

  // Rows are collected in descending order (highest index first) due to the backward iteration above.
  // Deleting rows from bottom to top prevents index shifting from affecting subsequent deletions.

  for (const rowIndex of rowsToDelete) {
    splitSheet.deleteRow(rowIndex);
  }

  return { success: true, message: "Split reverted successfully." };
}

function _processSplitCore(financeSheet, splitSheet, original, splits) {
  // 1. Prepare Data
  const preparation = _prepareSplitData(financeSheet, original, splits);
  if (!preparation.success) return preparation;

  // 2. Write Data
  return _writeSplitData(financeSheet, splitSheet, preparation);
}

function _prepareSplitData(financeSheet, original, splits) {
  const validation = _validateSplitRequest(original, splits);
  if (!validation.success) return validation;

  const rowIndex = parseInt(original.row);
  const splitGroupId = Utilities.getUuid();
  const splitDate = new Date();

  const idIndex = CONFIG.HEADERS.indexOf("Split Group ID");
  const descIndex = CONFIG.HEADERS.indexOf("Description");
  const tripEventIndex = CONFIG.HEADERS.indexOf("Trip/Event");
  const categoryIndex = CONFIG.HEADERS.indexOf("Category");
  const incomeIndex = CONFIG.HEADERS.indexOf("Income");
  const expenseIndex = CONFIG.HEADERS.indexOf("Expense");

  // Get Finance Sheet Row Data
  const originalRowRange = financeSheet.getRange(
    rowIndex,
    1,
    1,
    CONFIG.HEADERS.length,
  );
  const originalRowValues = originalRowRange.getValues()[0];

  const hasIncome =
    originalRowValues[incomeIndex] != null &&
    originalRowValues[incomeIndex] !== "";
  const hasExpense =
    originalRowValues[expenseIndex] != null &&
    originalRowValues[expenseIndex] !== "";
  if (hasIncome === hasExpense) {
    return {
      success: false,
      message: hasIncome
        ? "Sheet row has both Income and Expense populated; cannot determine split sign."
        : "Sheet row has no Income or Expense amount to split.",
    };
  }

  // Update ID in the in-memory array for archive rows
  originalRowValues[idIndex] = splitGroupId;

  const PENDING = Service_Split.SPLIT_TYPE_PENDING;
  const SOURCE = Service_Split.SPLIT_TYPE_SOURCE;
  const CHILD = Service_Split.SPLIT_TYPE_CHILD;

  const archiveRows = [];
  const finalTypes = [];
  archiveRows.push([...originalRowValues, PENDING, splitDate]);
  finalTypes.push(SOURCE);

  splits.forEach((split) => {
    const childRow = [...originalRowValues];
    childRow[descIndex] = split.Description;
    if (split.TripEvent !== undefined)
      childRow[tripEventIndex] = split.TripEvent;
    if (split.Category !== undefined) childRow[categoryIndex] = split.Category;

    if (split.Type === "Income") {
      childRow[incomeIndex] = split.Amount;
      childRow[expenseIndex] = "";
    } else {
      childRow[incomeIndex] = "";
      childRow[expenseIndex] = split.Amount;
    }
    archiveRows.push([...childRow, PENDING, splitDate]);
    finalTypes.push(CHILD);
  });

  // Split Type / Split Date columns sit immediately after CONFIG.HEADERS.
  const splitTypeColIndex = CONFIG.HEADERS.length + 1; // 1-based

  return {
    success: true,
    splitGroupId: splitGroupId,
    rowIndex: rowIndex,
    archiveRows: archiveRows,
    finalTypes: finalTypes,
    splitTypeColIndex: splitTypeColIndex,
    idIndex: idIndex,
  };
}

function _writeSplitData(financeSheet, splitSheet, preparation) {
  // Opportunistically clear any stale PENDING rows left by prior failures.
  // Safe under the script lock and bounded by PENDING_SWEEP_MS so an in-flight
  // write cannot delete its own rows.
  try {
    _sweepStalePending(splitSheet);
  } catch (sweepError) {
    console.warn("Stale-pending sweep failed (non-fatal):", sweepError);
  }

  const {
    splitGroupId,
    rowIndex,
    archiveRows,
    finalTypes,
    splitTypeColIndex,
    idIndex,
  } = preparation;

  if (!archiveRows || archiveRows.length === 0) {
    return {
      success: false,
      message: "Failed to write split data: no rows to write.",
    };
  }

  // Phase 1: append rows as PENDING. Readers ignore PENDING, so even if the
  // process dies right here the rows are inert.
  let startRow = 0;
  let numRows = 0;
  try {
    startRow = splitSheet.getLastRow() + 1;
    numRows = archiveRows.length;
    splitSheet
      .getRange(startRow, 1, numRows, archiveRows[0].length)
      .setValues(archiveRows);
  } catch (phase1Error) {
    console.error("Phase 1 (append pending) failed:", phase1Error);
    return {
      success: false,
      message: "Failed to write split data. Please try again.",
    };
  }

  // Phase 2: stamp the Split Group ID onto the Finance sheet.
  try {
    financeSheet.getRange(rowIndex, idIndex + 1).setValue(splitGroupId);
  } catch (phase2Error) {
    console.error("Phase 2 (finance stamp) failed:", phase2Error);
    _safeDeletePending(splitSheet, startRow, numRows);
    return {
      success: false,
      message: "Failed to write split data. Please try again.",
    };
  }

  // Phase 3: promote PENDING → SOURCE/CHILD in one setValues call.
  try {
    const typeValues = finalTypes.map((t) => [t]);
    splitSheet
      .getRange(startRow, splitTypeColIndex, numRows, 1)
      .setValues(typeValues);
  } catch (phase3Error) {
    console.error("Phase 3 (promote) failed:", phase3Error);
    // Finance was committed but children never promoted. Clear the Finance ID
    // so the user can retry from a clean state; the pending rows are inert and
    // will be swept on the next successful write.
    try {
      financeSheet.getRange(rowIndex, idIndex + 1).setValue("");
    } catch (clearError) {
      console.error(
        "Failed to clear Finance ID after promotion failure:",
        clearError,
      );
    }
    _safeDeletePending(splitSheet, startRow, numRows);
    return {
      success: false,
      message: "Failed to write split data. Please try again.",
    };
  }

  return {
    success: true,
    message: "Transaction split successfully.",
    splitGroupId: splitGroupId,
  };
}

/**
 * Best-effort deletion of a contiguous block of pending rows. On failure the
 * rows are left in place — they are inert (readers filter PENDING) and will
 * be swept by _sweepStalePending once they age past PENDING_SWEEP_MS.
 */
function _safeDeletePending(splitSheet, startRow, numRows) {
  if (!numRows || numRows <= 0) return;
  try {
    splitSheet.deleteRows(startRow, numRows);
  } catch (rollbackError) {
    console.error(
      "Rollback delete failed; leaving rows PENDING for sweep:",
      rollbackError,
    );
  }
}

/**
 * Retrieves raw row data for a split group from the Split Sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} splitSheet
 * @param {string} groupId
 * @returns {Array<Array>} Array of row values
 */
function _getSplitGroupData(splitSheet, groupId) {
  const data = splitSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const idIndex = headers.indexOf("Split Group ID");
  if (idIndex === -1) return [];

  const groupRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIndex] === groupId) {
      groupRows.push(data[i]);
    }
  }
  return groupRows;
}

/**
 * Restores split data from captured row values.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} financeSheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} splitSheet
 * @param {Array<Array>} existingSplitData
 * @param {string} groupId
 * @param {number} financeRowIndex
 */
function _restoreSplitData(
  financeSheet,
  splitSheet,
  existingSplitData,
  groupId,
  financeRowIndex,
) {
  const configValidation = _validateConfig();
  if (!configValidation.success) {
    console.error("Config validation failed in _restoreSplitData");
    throw new Error("Config validation failed in _restoreSplitData");
  }

  if (existingSplitData && existingSplitData.length > 0) {
    const lastRow = splitSheet.getLastRow();
    splitSheet
      .getRange(
        lastRow + 1,
        1,
        existingSplitData.length,
        existingSplitData[0].length,
      )
      .setValues(existingSplitData);
  }

  if (financeRowIndex && financeRowIndex !== -1) {
    const idIndex = CONFIG.HEADERS.indexOf("Split Group ID");
    if (idIndex !== -1) {
      financeSheet.getRange(financeRowIndex, idIndex + 1).setValue(groupId);
    }
  }
}

/**
 * Deletes any PENDING rows older than Service_Split.PENDING_SWEEP_MS.
 * The age threshold is well past the script-lock budget so an in-flight
 * write can never have its own rows swept. Bottom-up deletion avoids
 * index shifting (same idiom as _revertSplitCore).
 */
function _sweepStalePending(splitSheet) {
  const lastRow = splitSheet.getLastRow();
  if (lastRow <= 1) return;

  const headers = splitSheet
    .getRange(1, 1, 1, splitSheet.getLastColumn())
    .getValues()[0];
  const typeCol = headers.indexOf("Split Type") + 1; // 1-based
  const dateCol = headers.indexOf("Split Date") + 1;
  if (typeCol === 0 || dateCol === 0) return;

  // Only read the two columns we need — full-sheet reads dominate latency
  // for large Split sheets.
  const numDataRows = lastRow - 1;
  const types = splitSheet
    .getRange(2, typeCol, numDataRows, 1)
    .getValues();

  const PENDING = Service_Split.SPLIT_TYPE_PENDING;
  const pendingOffsets = [];
  for (let i = 0; i < types.length; i++) {
    if (types[i][0] === PENDING) pendingOffsets.push(i);
  }
  if (pendingOffsets.length === 0) return; // Fast path: nothing to sweep.

  const dates = splitSheet
    .getRange(2, dateCol, numDataRows, 1)
    .getValues();

  const cutoff = Date.now() - Service_Split.PENDING_SWEEP_MS;
  // Delete bottom-up so row indices stay stable.
  for (let i = pendingOffsets.length - 1; i >= 0; i--) {
    const offset = pendingOffsets[i];
    const rawDate = dates[offset][0];
    const ts = rawDate instanceof Date ? rawDate.getTime() : Date.parse(rawDate);
    if (isNaN(ts) || ts < cutoff) {
      splitSheet.deleteRow(offset + 2);
    }
  }
}
