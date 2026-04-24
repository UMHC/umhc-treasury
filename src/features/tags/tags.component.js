import store from "../../core/state.js";
import ApiService from "../../services/api.service.js";
import ModalComponent from "../../shared/modal.component.js";
import router from "../../core/router.js";
import TagsList from "./tags.list.js";
import TagsDetails from "./tags.details.js";
import TagsSubList from "./tags.sublist.js";
import TagsAddTrip from "./tags.add-trip.js";
import { calculateTagStats, formatOperationsForApi } from "./tags.logic.js";
import { el, replace } from "../../core/dom.js";

class TagsComponent {
  getCanEdit() {
    const currentUser = store.getState("currentUser");
    return !(currentUser && currentUser.canEdit === false);
  }

  constructor(element) {
    this.element = element;
    this.canEdit = this.getCanEdit();

    // Edit Mode State
    this.queue = [];
    this.localTags = null;
    this.isEditMode = false;

    // View State
    this.viewMode = "list"; // 'list' | 'details' | 'sublist' | 'add-trip'
    this.selectedTag = null; // { type, name }
    this.targetTypeName = null; // For add-trip view
    this.timeframe = "all_time";
    this.history = []; // Navigation stack

    this.modal = new ModalComponent();

    // Bind methods
    this.render = this.render.bind(this);

    // Initialize Sub-Components
    this.tagsList = new TagsList(element, {
      onEditModeToggle: (isEdit) => this.handleEditModeToggle(isEdit),
      onSave: () => this.handleSave(),
      onTagClick: (type, name) => this.handleTagClick(type, name),
      onTagAdd: (type, value) => this.handleTagAdd(type, value),
      onTagDelete: (type, value) => this.handleTagDelete(type, value),
      onTagRename: (type, oldValue) => this.handleTagRename(type, oldValue),
      onUpdateTripType: (tripName, typeName) =>
        this.handleUpdateTripType(tripName, typeName),
      onUpdateTripStatus: (tripName, status) =>
        this.handleUpdateTripStatus(tripName, status),
      onTimeframeChange: (newTimeframe) => {
        this.timeframe = newTimeframe;
        this.render();
      },
    });

    this.tagsSubList = new TagsSubList(element, {
      onBack: () => this.handleBack(),
      onTagClick: (type, name) => this.handleTagClick(type, name),
    });

    this.tagsDetails = new TagsDetails(element, {
      onBack: () => this.handleDetailsBack(),
      onAddTransactions: (type, name) => this.handleAddTransactions(type, name),
      onAddTagsToType: (typeName) => this.handleAddTagsToType(typeName),
    });

    this.tagsAddTrip = new TagsAddTrip(element, {
      onBack: () => this.handleAddTripBack(),
      onSave: (selectedTrips, typeName) =>
        this.handleAddTripSave(selectedTrips, typeName),
    });

    this.render();

    this.subscriptions = [];
    // Subscribe to relevant state changes
    this.subscriptions.push(
      store.subscribe("tags", () => {
        if (!this.isEditMode && this.viewMode === "list") this.render();
      }),
    );
    this.subscriptions.push(store.subscribe("expenses", this.render));
    this.subscriptions.push(store.subscribe("savingTags", this.render));
    this.subscriptions.push(store.subscribe("isTagging", this.render));
    this.subscriptions.push(
      store.subscribe("currentUser", () => this.handleUserChange()),
    );
  }

  destroy() {
    const subComponents = [
      this.tagsList,
      this.tagsSubList,
      this.tagsDetails,
      this.tagsAddTrip,
    ];
    subComponents.forEach((component) => {
      if (component && typeof component.destroy === "function") {
        component.destroy();
      }
    });
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  render() {
    this.canEdit = this.getCanEdit();
    if (!this.canEdit && this.isEditMode) {
      this.isEditMode = false;
      this.localTags = null;
      this.queue = [];
    }

    const savingTags = store.getState("savingTags");
    const isTagging = store.getState("isTagging");

    if (savingTags || isTagging) {
      this.renderSavingState();
      return;
    }

    if (this.viewMode === "list") {
      const expenses = store.getState("expenses") || [];
      const tagsData = store.getState("tags") || {};

      // Determine which tags data source to use for calculation
      const tagsSource =
        this.isEditMode && this.localTags ? this.localTags : tagsData;

      // Calculate Stats & Virtual Trip Map using Logic Layer
      const { stats, tripTypeMap, tripStatusMap } = calculateTagStats(
        expenses,
        tagsSource,
        this.timeframe,
        this.queue,
        this.isEditMode,
      );

      this.tagsList.render(
        this.isEditMode,
        this.localTags,
        this.queue,
        stats,
        tripTypeMap,
        tripStatusMap,
        this.timeframe,
        tagsData, // Pass original tags data for dropdowns (even in edit mode, options come from global or current set)
        this.canEdit,
      );
    } else if (this.viewMode === "sublist" && this.selectedTag) {
      const expenses = store.getState("expenses") || [];
      const tagsData = store.getState("tags") || {};
      const { stats, tripTypeMap, tripStatusMap } = calculateTagStats(
        expenses,
        tagsData,
        this.timeframe,
        this.queue,
        this.isEditMode,
      );
      this.tagsSubList.render(
        this.selectedTag.name,
        stats,
        tripTypeMap,
        tripStatusMap,
      );
    } else if (this.viewMode === "details" && this.selectedTag) {
      this.tagsDetails.render(
        this.selectedTag.type,
        this.selectedTag.name,
        this.canEdit,
      );
    } else if (this.viewMode === "add-trip") {
      if (!this.canEdit) {
        this.viewMode = this.selectedTag ? "details" : "list";
        this.render();
        return;
      }
      this.tagsAddTrip.init(this.targetTypeName);
    }
  }

  handleUserChange() {
    const canEdit = this.getCanEdit();
    if (this.canEdit === canEdit) return;
    this.canEdit = canEdit;
    if (!this.canEdit && this.viewMode === "add-trip") {
      this.viewMode = this.selectedTag ? "details" : "list";
    }
    this.render();
  }

  renderSavingState() {
    replace(
      this.element,
      el(
        "div",
        {
          className: "section",
          style: {
            height: "400px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          },
        },
        el("div", {
          className: "loader",
          style: { width: "50px", height: "50px", marginBottom: "20px" },
        }),
        el(
          "h3",
          { style: { color: "#f0ad4e", marginBottom: "10px" } },
          "Processing...",
        ),
        el(
          "p",
          { style: { color: "#fff", fontSize: "1.1em" } },
          "Syncing changes with the database.",
        ),
      ),
    );
  }

  // --- Navigation Handlers ---

  handleTagClick(type, name) {
    // Push current state to history before navigating
    this.history.push({
      viewMode: this.viewMode,
      selectedTag: this.selectedTag,
    });

    this.selectedTag = { type, name };
    if (type === "Type") {
      this.viewMode = "sublist";
    } else {
      this.viewMode = "details";
    }
    this.render();
  }

  handleBack() {
    this.history = []; // Clear history when going back to root
    this.selectedTag = null;
    this.viewMode = "list";
    this.render();
  }

  handleDetailsBack() {
    if (this.history.length > 0) {
      const prevState = this.history.pop();
      this.viewMode = prevState.viewMode;
      this.selectedTag = prevState.selectedTag;
      this.render();
    } else {
      // Default fallback
      this.handleBack();
    }
  }

  handleAddTransactions(type, name) {
    if (!this.canEdit) return;
    // Set intent in store
    store.setState("transactionParams", {
      mode: "bulk",
      prefill: {
        type: type,
        value: name,
      },
    });

    // Navigate
    router.navigate("transactions");
  }

  handleAddTagsToType(typeName) {
    if (!this.canEdit) return;
    this.targetTypeName = typeName;
    this.viewMode = "add-trip";
    this.render();
  }

  handleAddTripBack() {
    this.targetTypeName = null;
    this.viewMode = "details";
    // Ensure we are still looking at the correct tag details
    if (!this.selectedTag) {
      // Fallback if state got weird, though it shouldn't
      this.viewMode = "list";
    }
    this.render();
  }

  async handleAddTripSave(selectedTrips, typeName) {
    if (!this.canEdit) return;
    store.setState("taggingSource", "tags");
    store.setState("isTagging", true);
    const operations = selectedTrips.map((trip) => [
      trip,
      typeName,
      "updateTripType",
      "Trip/Event",
    ]);
    try {
      const result = await ApiService.processTagOperations(operations, {
        skipLoading: true,
      });
      if (result.success) {
        document.dispatchEvent(new CustomEvent("dataUploaded"));
        store.setState("isTagging", false);
        store.setState("taggingSource", null);
        // Navigate back to details on success
        this.handleAddTripBack();
      } else {
        await this.modal.alert(result.message || "Failed to update tags.");
        store.setState("isTagging", false);
        store.setState("taggingSource", null);
      }
    } catch (err) {
      console.error(err);
      await this.modal.alert("Error: " + err.message);
      store.setState("isTagging", false);
      store.setState("taggingSource", null);
    }
  }

  // --- Edit Mode Handlers ---

  async handleEditModeToggle(isEdit) {
    if (!this.canEdit) return;
    if (isEdit) {
      if (this.queue.length > 0) {
        const confirmed = await this.modal.confirm(
          "You have unsaved changes to Trip/Event types. Discard them to enter Edit Mode?",
          "Unsaved Changes",
        );
        if (!confirmed) return;
      }
      // Enter Edit Mode
      this.localTags = store.getState("tags");
      this.queue = [];
      this.isEditMode = true;
      this.render();
    } else {
      // Cancel Edit Mode
      if (this.queue.length > 0) {
        const confirmed = await this.modal.confirm(
          "You have unsaved changes. Are you sure you want to cancel?",
          "Unsaved Changes",
        );
        if (!confirmed) return;
      }
      this.isEditMode = false;
      this.localTags = null;
      this.queue = [];
      this.render();
    }
  }

  async handleTagAdd(type, value) {
    if (!this.canEdit) return;
    if (!value) return;
    if (!this.localTags) {
      await this.modal.alert("Cannot add tag: edit mode not active.");
      return;
    }
    if (!this.localTags[type] || !Array.isArray(this.localTags[type])) {
      await this.modal.alert(`Invalid tag type: ${type}`);
      return;
    }
    if (this.localTags[type].includes(value)) {
      await this.modal.alert("Tag already exists!");
      return;
    }
    this.localTags[type].push(value);
    this.queue.push({ type: "add", tagType: type, value: value });
    this.render();
  }

  async handleTagDelete(type, tag) {
    if (!this.canEdit) return;
    if (!this.localTags) {
      await this.modal.alert("Cannot delete tag: edit mode not active.");
      return;
    }
    const confirmed = await this.modal.confirm(`Delete tag "${tag}"?`);
    if (confirmed) {
      this.localTags[type] = this.localTags[type].filter((t) => t !== tag);

      // If deleting a 'Type', clear it from any Trip/Events locally
      if (type === "Type" && this.localTags.TripTypeMap) {
        Object.keys(this.localTags.TripTypeMap).forEach((trip) => {
          if (this.localTags.TripTypeMap[trip] === tag) {
            this.localTags.TripTypeMap[trip] = "";
          }
        });
      }

      this.queue.push({ type: "delete", tagType: type, value: tag });
      this.render();
    }
  }

  async handleTagRename(type, tag) {
    if (!this.canEdit) return;
    if (!this.localTags) {
      await this.modal.alert("Cannot rename tag: edit mode not active.");
      return;
    }
    const newName = await this.modal.prompt(
      `Rename "${tag}" to:`,
      tag,
      "Rename Tag",
    );

    if (newName && newName.trim() !== "" && newName !== tag) {
      const trimmedName = newName.trim();
      if (this.localTags[type].includes(trimmedName)) {
        await this.modal.alert("Tag name already exists!");
        return;
      }

      const index = this.localTags[type].indexOf(tag);
      if (index !== -1) {
        this.localTags[type][index] = trimmedName;

        // If renaming a 'Type', update it in TripTypeMap locally
        if (type === "Type" && this.localTags.TripTypeMap) {
          Object.keys(this.localTags.TripTypeMap).forEach((trip) => {
            if (this.localTags.TripTypeMap[trip] === tag) {
              this.localTags.TripTypeMap[trip] = trimmedName;
            }
          });
        }

        this.queue.push({
          type: "rename",
          tagType: type,
          oldValue: tag,
          newValue: trimmedName,
        });
        this.render();
      }
    }
  }

  handleUpdateTripType(tripName, newType) {
    if (!this.canEdit) return;
    // Update local state if in edit mode
    if (this.isEditMode && this.localTags) {
      if (!this.localTags.TripTypeMap) {
        this.localTags.TripTypeMap = {};
      }
      this.localTags.TripTypeMap[tripName] = newType;
    }

    // Queue operation
    // Remove any previous pending update for this specific trip to avoid redundant ops
    this.queue = this.queue.filter(
      (op) => !(op.type === "updateTripType" && op.oldValue === tripName),
    );

    // Check if newType matches original state
    const originalTags = store.getState("tags");
    const originalType =
      originalTags.TripTypeMap && originalTags.TripTypeMap[tripName]
        ? originalTags.TripTypeMap[tripName]
        : "";

    // Only queue if different from original
    if (newType !== originalType) {
      this.queue.push({
        type: "updateTripType",
        tagType: "Trip/Event",
        oldValue: tripName,
        newValue: newType,
      });
    }

    this.render();
  }

  handleUpdateTripStatus(tripName, newStatus) {
    if (!this.canEdit) return;
    // 1. Update local state immediately for responsiveness (optimistic update logic)
    if (this.isEditMode && this.localTags) {
      if (!this.localTags.TripStatusMap) {
        this.localTags.TripStatusMap = {};
      }
      this.localTags.TripStatusMap[tripName] = newStatus;
    }

    // 2. Queue operation
    // Remove any previous pending update for this specific trip to avoid redundant ops
    this.queue = this.queue.filter(
      (op) => !(op.type === "updateTripStatus" && op.oldValue === tripName),
    );

    // Check if newStatus matches original state
    const originalTags = store.getState("tags");
    const originalStatus =
      originalTags.TripStatusMap && originalTags.TripStatusMap[tripName]
        ? originalTags.TripStatusMap[tripName]
        : "Active";

    // Only queue if different from original
    if (newStatus !== originalStatus) {
      this.queue.push({
        type: "updateTripStatus",
        tagType: "Trip/Event",
        oldValue: tripName,
        newValue: newStatus,
      });
    }

    this.render();
  }

  async handleSave() {
    if (!this.canEdit) return;
    if (store.getState("savingTags")) {
      return; // Save already in progress
    }

    if (this.queue.length === 0) {
      this.isEditMode = false;
      this.render();
      return;
    }

    store.setState("savingTags", true); // This triggers the loading view in render()

    const chunkSize = 10;
    const chunks = [];

    const formattedOperations = formatOperationsForApi(this.queue);

    for (let i = 0; i < formattedOperations.length; i += chunkSize) {
      chunks.push(formattedOperations.slice(i, i + chunkSize));
    }

    let processedCount = 0;
    try {
      for (const chunk of chunks) {
        const result = await ApiService.processTagOperations(chunk, {
          skipLoading: true,
        });
        if (!result.success) {
          const err = new Error(
            result.message || "Failed to process tag operations",
          );
          err.appliedCount = result.appliedOperations?.length ?? 0;
          throw err;
        }
        processedCount += chunk.length;
      }

      // Refresh data to ensure everything is synced
      document.dispatchEvent(new CustomEvent("dataUploaded"));

      this.isEditMode = false;
      this.localTags = null;
      this.queue = [];
    } catch (error) {
      console.error("Failed to save tags:", error);
      processedCount += error.appliedCount || 0;
      this.queue = this.queue.slice(processedCount);
      await this.modal.alert(
        `Failed to save tags: ${error.message}\n\n` +
          `${processedCount} of ${formattedOperations.length} operations were saved. ` +
          `Please refresh the page to see the current state and retry.`,
        "Error",
      );
    } finally {
      store.setState("savingTags", false);
    }
  }
}

export default TagsComponent;
