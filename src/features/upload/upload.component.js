// src/features/upload/upload.component.js
import store from "../../core/state.js";
import ApiService from "../../services/api.service.js";
import ExcelService from "../../services/excel.service.js";
import SortableTable from "../../shared/sortable-table.component.js";
import { formatCurrency } from "../../core/utils.js";
import { el, replace } from "../../core/dom.js";

class UploadComponent {
  static RECORDS_PER_CHUNK = 20;

  isReadOnly() {
    const currentUser = store.getState("currentUser");
    return currentUser && currentUser.canEdit === false;
  }

  constructor(element) {
    this.element = element;
    this.parsedData = [];
    this.subscriptions = [];
    this.render();
    this.attachEventListeners();
    this.subscriptions.push(
      store.subscribe("isUploading", this.handleUploadingState.bind(this)),
    );
    this.subscriptions.push(
      store.subscribe("currentUser", () =>
        this.handleUploadingState(store.getState("isUploading")),
      ),
    );
    this.subscriptions.push(
      store.subscribe("rawExpenses", () => {
        if (this.parsedData && this.parsedData.length > 0) {
          const existingData = store.getState("rawExpenses") || [];
          this.markDuplicates(this.parsedData, existingData);
          this.displayExtractedData();
        }
      }),
    );
    this.handleUploadingState(store.getState("isUploading"));
  }

  destroy() {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];

    // Remove event listeners
    if (this._handlers) {
      if (this.chooseFileBtn)
        this.chooseFileBtn.removeEventListener(
          "click",
          this._handlers.chooseFile,
        );
      if (this.fileUpload)
        this.fileUpload.removeEventListener(
          "change",
          this._handlers.fileSelect,
        );
      if (this.uploadButton)
        this.uploadButton.removeEventListener("click", this._handlers.upload);
      if (this.tableViewButton)
        this.tableViewButton.removeEventListener(
          "click",
          this._handlers.switchTable,
        );
      if (this.jsonViewButton)
        this.jsonViewButton.removeEventListener(
          "click",
          this._handlers.switchJson,
        );
      if (this.showNewOnlyCheckbox)
        this.showNewOnlyCheckbox.removeEventListener(
          "change",
          this._handlers.filterChange,
        );
    }

    // Clear DOM references
    this.element = null;
    this.fileUpload = null;
    this.chooseFileBtn = null;
    this.fileNameDisplay = null;
    this.uploadButton = null;
    this.uploadStatus = null;
    this.tableViewButton = null;
    this.jsonViewButton = null;
    this.tableViewContent = null;
    this.fileContentJson = null;
    this.jsonViewContent = null;
    this.showNewOnlyCheckbox = null;
    this.extractedContentSection = null;
    this.table = null;
    this.parsedData = [];
  }

  render() {
    this.fileUpload = el("input", {
      type: "file",
      id: "file-upload",
      accept: ".xlsx, .xls",
      style: { display: "none" },
    });
    this.chooseFileBtn = el("button", { id: "choose-file-btn" }, "Choose File");
    this.fileNameDisplay = el(
      "span",
      { id: "file-name-display" },
      "No file chosen",
    );
    this.uploadButton = el(
      "button",
      { id: "upload-to-sheet-btn" },
      "Upload to Sheet",
    );
    this.uploadStatus = el("div", { id: "upload-status" });

    this.tableViewButton = el(
      "button",
      { id: "table-view-btn", className: "active view-toggle-btn" },
      "Table View",
    );
    this.jsonViewButton = el(
      "button",
      { id: "json-view-btn", className: "view-toggle-btn" },
      "JSON View",
    );

    this.tableViewContent = el("div", { id: "table-view-content" });
    this.fileContentJson = el("code", { id: "file-content-json" });
    this.jsonViewContent = el(
      "div",
      { id: "json-view-content", style: { display: "none" } },
      el("pre", {}, this.fileContentJson),
    );

    this.showNewOnlyCheckbox = el("input", {
      type: "checkbox",
      id: "show-new-only",
    });

    this.extractedContentSection = el(
      "div",
      { id: "extracted-content-section", style: { display: "none" } },
      el("h4", {}, "Extracted Data"),
      el(
        "div",
        { className: "view-toggle" },
        this.tableViewButton,
        this.jsonViewButton,
      ),
      el(
        "div",
        { className: "filter-controls", style: { margin: "10px 0" } },
        el(
          "label",
          { className: "checkbox-label", for: "show-new-only" },
          this.showNewOnlyCheckbox,
          " Show New Transactions Only",
        ),
      ),
      this.tableViewContent,
      this.jsonViewContent,
    );

    const container = el(
      "div",
      { className: "upload-container section" },
      el("h2", {}, "Upload Excel File"),
      el(
        "p",
        {},
        "Select an Excel file with transaction data to upload to the sheet.",
      ),
      el(
        "label",
        {
          for: "file-upload",
          className: "visually-hidden",
          style: {
            position: "absolute",
            width: "1px",
            height: "1px",
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          },
        },
        "Choose Excel File",
      ),
      el(
        "div",
        { className: "upload-actions" },
        this.fileUpload,
        this.chooseFileBtn,
        this.fileNameDisplay,
        this.uploadButton,
      ),
      this.uploadStatus,
      this.extractedContentSection,
    );

    replace(this.element, container);

    // Initialize SortableTable
    this.table = new SortableTable(this.tableViewContent, {
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "description", label: "Description", type: "text" },
        { key: "document", label: "Document", type: "text" },
        {
          key: "cashIn",
          label: "Cash In",
          type: "currency",
          class: "positive",
        },
        {
          key: "cashOut",
          label: "Cash Out",
          type: "currency",
          class: "negative",
        },
        {
          key: "status",
          label: "Status",
          type: "custom",
          render: (row) => {
            return el(
              "span",
              {
                className: row.isDuplicate ? "status-duplicate" : "status-new",
              },
              row.isDuplicate ? "Duplicate" : "New",
            );
          },
        },
      ],
      initialSortField: "date",
      initialSortAsc: false,
    });
  }

  attachEventListeners() {
    // Store references for cleanup
    this._handlers = {
      chooseFile: () => this.fileUpload.click(),
      fileSelect: this.handleFileSelect.bind(this),
      upload: this.handleUpload.bind(this),
      switchTable: this.switchToTableView.bind(this),
      switchJson: this.switchToJsonView.bind(this),
      filterChange: () => this.displayExtractedData(),
    };

    this.chooseFileBtn.addEventListener("click", this._handlers.chooseFile);
    this.fileUpload.addEventListener("change", this._handlers.fileSelect);
    this.uploadButton.addEventListener("click", this._handlers.upload);
    this.tableViewButton.addEventListener("click", this._handlers.switchTable);
    this.jsonViewButton.addEventListener("click", this._handlers.switchJson);
    this.showNewOnlyCheckbox.addEventListener(
      "change",
      this._handlers.filterChange,
    );
  }

  handleUploadingState(isUploading) {
    const isReadOnly = this.isReadOnly();
    if (this.fileUpload) {
      this.fileUpload.disabled = isUploading;
    }
    if (this.chooseFileBtn) {
      this.chooseFileBtn.disabled = isUploading;
    }
    if (this.uploadButton) {
      this.uploadButton.disabled = isUploading || isReadOnly;
      if (isUploading) {
        this.uploadButton.textContent = "Uploading...";
      } else {
        this.uploadButton.textContent = "Upload to Sheet";
      }
    }
  }

  async handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      this.fileNameDisplay.textContent = "No file chosen";
      this.displayUploadStatus("Please select a file.", "info");
      this.extractedContentSection.style.display = "none";
      return;
    }

    this.fileNameDisplay.textContent = file.name;

    try {
      this.parsedData = await ExcelService.parseFile(file);

      // Mark duplicates immediately against RAW expenses (ignoring splits)
      const existingData = store.getState("rawExpenses") || [];
      this.markDuplicates(this.parsedData, existingData);

      this.displayExtractedData();
      this.switchToTableView();
      this.extractedContentSection.style.display = "block";
    } catch (error) {
      console.error("File parsing error:", error.message);
      this.displayUploadStatus(`Error reading file: ${error.message}`, "error");
      this.extractedContentSection.style.display = "none";
    }
  }

  _createDuplicateKey(record, schema) {
    // schema maps field names: { date, description, document, cashIn, cashOut }
    const dateStr = this._normalizeDateString(
      schema.date ? record[schema.date] : record.date,
    );
    const descriptionStr = this._normalizeValue(
      schema.description ? record[schema.description] : record.description,
    );
    const documentStr = this._normalizeValue(
      schema.document ? record[schema.document] : record.document,
    );
    const incomeStr = this._normalizeValue(
      this._formatNumberForComparison(
        schema.cashIn ? record[schema.cashIn] : record.cashIn,
      ),
    );
    const expenseStr = this._normalizeValue(
      this._formatNumberForComparison(
        schema.cashOut ? record[schema.cashOut] : record.cashOut,
      ),
    );
    // Use JSON.stringify for safer serialization or use a delimiter that can't appear in normalized values
    return JSON.stringify([
      dateStr,
      descriptionStr,
      documentStr,
      incomeStr,
      expenseStr,
    ]);
  }

  markDuplicates(newData, existingData) {
    const existingKeys = new Set(
      existingData.map((row) =>
        this._createDuplicateKey(row, {
          date: "Date",
          description: "Description",
          document: "Document",
          cashIn: "Income",
          cashOut: "Expense",
        }),
      ),
    );

    newData.forEach((row) => {
      const key = this._createDuplicateKey(row, {
        date: "date",
        description: "description",
        document: "document",
        cashIn: "cashIn",
        cashOut: "cashOut",
      });
      row.isDuplicate = existingKeys.has(key);
    });
  }

  displayExtractedData() {
    const showNewOnly = this.showNewOnlyCheckbox.checked;
    const dataToShow = showNewOnly
      ? this.parsedData.filter((r) => !r.isDuplicate)
      : this.parsedData;

    this.fileContentJson.textContent = JSON.stringify(dataToShow, null, 2);
    this.table.update(dataToShow);
  }

  switchToTableView() {
    this.tableViewContent.style.display = "block";
    this.jsonViewContent.style.display = "none";
    this.tableViewButton.classList.add("active");
    this.jsonViewButton.classList.remove("active");
  }

  switchToJsonView() {
    this.jsonViewContent.style.display = "block";
    this.tableViewContent.style.display = "none";
    this.jsonViewButton.classList.add("active");
    this.tableViewButton.classList.remove("active");
  }

  async handleUpload() {
    if (this.isReadOnly()) {
      return;
    }

    if (!this.parsedData || this.parsedData.length === 0) {
      this.displayUploadStatus("No data to upload.", "error");
      return;
    }

    // Re-check duplicates against the latest data in the store
    // This ensures we don't re-upload data if the store has been updated
    // (e.g. by a previous upload) but the file is still loaded.
    const existingData = store.getState("rawExpenses") || [];
    this.markDuplicates(this.parsedData, existingData);
    this.displayExtractedData(); // Update UI to reflect current duplicate status

    // Filter for new records only
    const newRecords = this.parsedData
      .filter((r) => !r.isDuplicate)
      .map((r) => ({ ...r, isUploaded: true }));

    if (newRecords.length === 0) {
      this.displayUploadStatus("No new records to upload.", "success");
      return;
    }

    this.displayUploadStatus(
      `Uploading ${newRecords.length} new records...`,
      "info",
    );

    try {
      store.setState("isUploading", true);
      await this._uploadInChunks(newRecords);
    } catch (error) {
      this.displayUploadStatus(
        `Error uploading data: ${error.message}`,
        "error",
      );
    } finally {
      store.setState("isUploading", false);
    }
  }

  async _uploadInChunks(records) {
    const totalChunks = Math.ceil(
      records.length / UploadComponent.RECORDS_PER_CHUNK,
    );
    let successfulCount = 0;
    let failedChunkError = null;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * UploadComponent.RECORDS_PER_CHUNK;
      const end = start + UploadComponent.RECORDS_PER_CHUNK;
      const chunk = records.slice(start, end);
      this.displayUploadStatus(
        `Uploading chunk ${i + 1} of ${totalChunks}...`,
        "info",
      );

      try {
        await ApiService.saveData(chunk, { skipLoading: true });
        successfulCount += chunk.length;
      } catch (error) {
        failedChunkError = new Error(
          `Upload interrupted at chunk ${i + 1}. ${successfulCount} of ${
            records.length
          } records were saved. Error: ${error.message}`,
        );
        break;
      }
    }

    // Always dispatch event if any records were uploaded
    if (successfulCount > 0) {
      document.dispatchEvent(new CustomEvent("dataUploaded"));
    }

    if (failedChunkError) {
      throw failedChunkError;
    }

    this.displayUploadStatus(
      `Successfully uploaded ${records.length} records!`,
      "success",
    );
  }

  displayUploadStatus(message, type) {
    const props = { className: `status-message ${type}` };
    if (type === "error") {
      props.role = "alert";
    }
    replace(this.uploadStatus, el("div", props, message));
  }

  // Moved from data.js
  _normalizeDateString(dateValue) {
    if (!dateValue) return "";

    // Handle Date objects explicitly
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return "";
      const year = dateValue.getFullYear();
      const month = String(dateValue.getMonth() + 1).padStart(2, "0");
      const day = String(dateValue.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    let dateString = String(dateValue).trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
      const parts = dateString.split("/");
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
        2,
        "0",
      )}`;
    }
    if (dateString.includes("T")) {
      return dateString.split("T")[0];
    }
    if (/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(dateString)) {
      return dateString.split(" ")[0];
    }
    return dateString;
  }

  _normalizeValue(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  _formatNumberForComparison(value) {
    if (value === null || value === undefined || value === "") return "";
    const num = parseFloat(String(value).trim().replace(/,/g, ""));
    if (isNaN(num)) return "";
    // Use integer cents to avoid floating-point precision issues
    const cents = Math.round(num * 100);
    return cents === 0 ? "" : String(cents);
  }
}

export default UploadComponent;
