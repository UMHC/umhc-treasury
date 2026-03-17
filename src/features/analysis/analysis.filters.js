import { el, replace } from "../../core/dom.js";
import { sanitizeForId } from "../../core/utils.js";
import { withSearchInputAttributes } from "../../shared/search-input.js";
import MobileDisclosureComponent from "../../shared/mobile-disclosure.component.js";

export default class AnalysisFilters {
  constructor(element, callbacks, options = {}) {
    this.element = element;
    this.callbacks = callbacks || {}; // { onFilterChange, onSearchChange, onTypeChange }
    this.options = options || {};
    this.disclosure = null;
    this.render();
    this.bindEvents();
  }

  render() {
    const filtersBody = el(
      "div",
      { className: "analysis-filter-section" },
      el(
        "div",
        { className: "tag-filters-container" },
        // Type Filter
        el(
          "div",
          { className: "tag-filter-column" },
          el("div", { className: "tag-filter-header" }, "Types"),
          el(
            "input",
            withSearchInputAttributes({
              id: "analysis-type-search",
              "aria-label": "Search Types",
              className: "tag-search-input",
              placeholder: "Search types...",
            }),
          ),
          el(
            "div",
            { id: "type-selector-container", className: "tag-selector" },
            el(
              "div",
              { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
              "Loading...",
            ),
          ),
        ),
        // Trip Filter
        el(
          "div",
          { className: "tag-filter-column" },
          el("div", { className: "tag-filter-header" }, "Trips / Events"),
          el(
            "input",
            withSearchInputAttributes({
              id: "analysis-trip-search",
              "aria-label": "Search Trips",
              className: "tag-search-input",
              placeholder: "Search trips...",
            }),
          ),
          el(
            "div",
            { id: "trip-selector-container", className: "tag-selector" },
            el(
              "div",
              { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
              "Loading...",
            ),
          ),
        ),
        // Category Filter
        el(
          "div",
          { className: "tag-filter-column" },
          el("div", { className: "tag-filter-header" }, "Categories"),
          el(
            "input",
            withSearchInputAttributes({
              id: "analysis-cat-search",
              "aria-label": "Search Categories",
              className: "tag-search-input",
              placeholder: "Search categories...",
            }),
          ),
          el(
            "div",
            { id: "category-selector-container", className: "tag-selector" },
            el(
              "div",
              { style: { padding: "5px", color: "rgba(255,255,255,0.5)" } },
              "Loading...",
            ),
          ),
        ),
      ),
    );

    const disclosureMount = el("div", {
      className: "analysis-disclosure-mount analysis-disclosure-mount--filters",
    });

    replace(this.element, disclosureMount);

    this.disclosure = new MobileDisclosureComponent(disclosureMount, {
      title: "Filters",
      summary: this.options.summary || {},
      expanded: this.options.expanded,
      collapseMode: "mobile",
      className: "analysis-disclosure analysis-disclosure--filters",
      bodyClassName:
        "analysis-disclosure__body analysis-disclosure__body--filters",
      bodyChildren: [filtersBody],
      onToggle: (expanded) => {
        if (typeof this.options.onToggle === "function") {
          this.options.onToggle(expanded);
        }
      },
    });
  }

  bindEvents() {
    const catSearch = this.element.querySelector("#analysis-cat-search");
    if (catSearch) {
      catSearch.addEventListener("input", (e) => {
        if (this.callbacks.onSearchChange) {
          this.callbacks.onSearchChange("Category", e.target.value);
        }
      });
    }

    const tripSearch = this.element.querySelector("#analysis-trip-search");
    if (tripSearch) {
      tripSearch.addEventListener("input", (e) => {
        if (this.callbacks.onSearchChange) {
          this.callbacks.onSearchChange("Trip/Event", e.target.value);
        }
      });
    }

    const typeSearch = this.element.querySelector("#analysis-type-search");
    if (typeSearch) {
      typeSearch.addEventListener("input", (e) => {
        if (this.callbacks.onSearchChange) {
          this.callbacks.onSearchChange("Type", e.target.value);
        }
      });
    }
  }

  updateInputs(catTerm, tripTerm, typeTerm) {
    const catInput = this.element.querySelector("#analysis-cat-search");
    if (catInput) catInput.value = catTerm || "";

    const tripInput = this.element.querySelector("#analysis-trip-search");
    if (tripInput) tripInput.value = tripTerm || "";

    const typeInput = this.element.querySelector("#analysis-type-search");
    if (typeInput) typeInput.value = typeTerm || "";
  }

  renderTagLists(
    tagsData,
    selectedCategories,
    selectedTrips,
    typeStatusMap,
    catTerm,
    tripTerm,
    typeTerm,
  ) {
    this.populateTagList(
      "Type",
      tagsData["Type"] || [],
      null,
      typeTerm,
      "#type-selector-container",
      (tag, isChecked) => {
        if (this.callbacks.onTypeChange) {
          this.callbacks.onTypeChange(tag, isChecked);
        }
      },
      typeStatusMap,
    );

    this.populateTagList(
      "Category",
      tagsData["Category"] || [],
      selectedCategories,
      catTerm,
      "#category-selector-container",
    );

    this.populateTagList(
      "Trip/Event",
      tagsData["Trip/Event"] || [],
      selectedTrips,
      tripTerm,
      "#trip-selector-container",
    );
  }

  populateTagList(
    type,
    tagsArray,
    selectionSet,
    searchTerm,
    containerId,
    onItemChange = null,
    statusMap = null,
  ) {
    const container = this.element.querySelector(containerId);
    if (!container) return;

    if (!tagsArray || tagsArray.length === 0) {
      replace(
        container,
        el("div", { style: { padding: "5px" } }, "No tags found"),
      );
      return;
    }

    const sortedTags = [...tagsArray].sort();
    const visibleTags = sortedTags.filter((tag) =>
      tag.toLowerCase().includes((searchTerm || "").toLowerCase()),
    );

    const children = [];

    // "Select All" Option
    if (visibleTags.length > 0) {
      const uid = `analysis-all-${sanitizeForId(type)}`;

      let allVisibleSelected = false;
      if (statusMap) {
        allVisibleSelected = visibleTags.every(
          (t) => statusMap[t] === "checked",
        );
      } else if (selectionSet) {
        allVisibleSelected = visibleTags.every((t) => selectionSet.has(t));
      }

      const checkbox = el("input", { type: "checkbox", id: uid });
      checkbox.checked = allVisibleSelected && visibleTags.length > 0;

      checkbox.addEventListener("change", (e) => {
        visibleTags.forEach((tag) => {
          if (selectionSet) {
            if (e.target.checked) selectionSet.add(tag);
            else selectionSet.delete(tag);
          }

          if (onItemChange) onItemChange(tag, e.target.checked);
        });

        if (this.callbacks.onFilterChange) {
          this.callbacks.onFilterChange();
        }
      });

      const selectAllDiv = el(
        "div",
        { className: "tag-checkbox-item" },
        checkbox,
        el("label", { for: uid }, el("em", {}, "Select All")),
      );
      children.push(selectAllDiv);
    } else {
      children.push(
        el(
          "div",
          { style: { padding: "5px", color: "#ccc" } },
          "No matches found",
        ),
      );
    }

    visibleTags.forEach((tag, index) => {
      let isChecked = false;
      let isIndeterminate = false;

      if (statusMap) {
        const status = statusMap[tag] || "unchecked";
        isChecked = status === "checked";
        isIndeterminate = status === "indeterminate";
      } else if (selectionSet) {
        isChecked = selectionSet.has(tag);
      }

      const uid = `analysis-${sanitizeForId(type)}-${sanitizeForId(
        tag,
      )}-${index}`;

      const input = el("input", {
        type: "checkbox",
        id: uid,
        value: tag,
        className: "tag-item-input",
      });
      input.checked = isChecked;
      input.indeterminate = isIndeterminate;

      input.addEventListener("change", (e) => {
        if (selectionSet) {
          if (e.target.checked) selectionSet.add(tag);
          else selectionSet.delete(tag);
        }

        if (onItemChange) {
          onItemChange(tag, e.target.checked);
        }

        if (this.callbacks.onFilterChange) {
          this.callbacks.onFilterChange();
        }
      });

      const div = el(
        "div",
        { className: "tag-checkbox-item" },
        input,
        el("label", { for: uid }, tag),
      );
      children.push(div);
    });

    const previousScrollTop = container.scrollTop;
    replace(container, ...children);
    container.scrollTop = previousScrollTop;
  }

  updateDisclosure(summaryConfig = {}) {
    if (!this.disclosure) return;
    this.disclosure.setSummary(summaryConfig);
  }

  destroy() {
    if (this.disclosure && typeof this.disclosure.destroy === "function") {
      this.disclosure.destroy();
    }
    this.disclosure = null;
  }
}
