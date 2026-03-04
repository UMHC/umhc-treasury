import { el } from "../core/dom.js";

const appendValue = (value, className = "") => {
  if (value instanceof Node) {
    if (className) {
      const wrapper = el("div", { className });
      wrapper.appendChild(value);
      return wrapper;
    }
    return value;
  }

  return el(
    "div",
    { className: className || "mobile-data-card__detail-value" },
    value ?? "",
  );
};

export const createMobileDataDetail = ({
  label,
  value,
  className = "",
  valueClassName = "mobile-data-card__detail-value",
} = {}) =>
  el(
    "div",
    {
      className: ["mobile-data-card__detail", className]
        .filter(Boolean)
        .join(" "),
    },
    el("span", { className: "mobile-data-card__detail-label" }, label || ""),
    appendValue(value, valueClassName),
  );

export const createMobileDataMetric = ({
  label,
  value,
  tone = "",
  className = "",
} = {}) =>
  el(
    "div",
    {
      className: ["mobile-data-card__metric", className]
        .filter(Boolean)
        .join(" "),
    },
    el("div", { className: "mobile-data-card__metric-label" }, label || ""),
    el(
      "div",
      {
        className: ["mobile-data-card__metric-value", tone]
          .filter(Boolean)
          .join(" "),
      },
      value ?? "",
    ),
  );

export const createMobileDataList = ({ className = "", children = [] } = {}) =>
  el(
    "div",
    {
      className: ["mobile-data-card-list", className].filter(Boolean).join(" "),
    },
    ...children,
  );

export const createMobileDataEmptyState = ({
  text = "No data available.",
  className = "",
} = {}) =>
  el(
    "div",
    {
      className: ["mobile-data-empty-state", className]
        .filter(Boolean)
        .join(" "),
    },
    text,
  );

export const createMobileDataCard = ({
  className = "",
  interactive = false,
  eyebrow = "",
  title = "",
  headerAside = null,
  details = [],
  metrics = [],
  actions = [],
} = {}) => {
  const children = [
    el(
      "div",
      { className: "mobile-data-card__header" },
      el(
        "div",
        { className: "mobile-data-card__title-group" },
        eyebrow
          ? el("div", { className: "mobile-data-card__eyebrow" }, eyebrow)
          : null,
        el("div", { className: "mobile-data-card__title" }, title || ""),
      ),
      headerAside,
    ),
  ];

  if (details.length > 0) {
    children.push(
      el("div", { className: "mobile-data-card__details" }, ...details),
    );
  }

  if (metrics.length > 0) {
    children.push(
      el("div", { className: "mobile-data-card__metrics" }, ...metrics),
    );
  }

  if (actions.length > 0) {
    children.push(
      el("div", { className: "mobile-data-card__actions" }, ...actions),
    );
  }

  return el(
    "article",
    {
      className: [
        "mobile-data-card",
        interactive ? "mobile-data-card--interactive" : "",
        className,
      ]
        .filter(Boolean)
        .join(" "),
      tabindex: interactive ? "0" : null,
      role: interactive ? "button" : null,
    },
    ...children,
  );
};
