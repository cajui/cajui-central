import { t } from "./i18n.mjs";
import {
  escapeHTML as e,
  age,
  formatMeasurement,
  formatUnit,
  plotGeometry,
  states,
} from "./model.mjs";
import { icon } from "./icons.mjs";

// The markup of the overview, shared by the page and the components reference so the
// reference shows exactly what the page draws. Events and focus belong to the page.

// The page holds only the latest 100 samples (about 1 h 40 min each for five devices
// reporting every 5 min), so a longer trend would be mostly empty until history queries
// exist (ADR 0002). One window for every row keeps their trends comparable.
export const TREND_HOURS = 3;

export function summaryHTML(items, devices) {
  const count = (severity) =>
    items.filter((item) => item.severity === severity).length;
  return items.length
    ? `<p class="overview-headline">${t("overview.problems", { count: items.length })}</p><span class="overview-counts">${[
        "critical",
        "warning",
        "network",
      ]
        .filter(count)
        .map(
          (severity) =>
            `<span class="badge" data-state="${severity}">${e(states[severity])} · ${count(severity)}</span>`,
        )
        .join("")}</span>`
    : `<p class="overview-headline">${devices ? t("overview.all_clear") : t("common.waiting")}</p><span class="muted">${t("counts.devices", { count: devices })}</span>`;
}

export function attentionItemHTML(item) {
  return `<li data-severity="${item.severity}"><span class="badge" data-state="${item.severity}">${e(states[item.severity])}</span><div class="attention-text"><strong>${item.href ? `<a href="${e(item.href)}">${e(item.title)}</a>` : e(item.title)}</strong>${item.detail ? `<span>${e(item.detail)}</span>` : ""}</div><span class="attention-since">${e(item.since)}</span></li>`;
}

// A place's heading and its own problems; the rows go between them.
export function placeHTML(group, notes, now) {
  return `<header class="place-head"><div><h3>${e(group.name)}</h3><p class="muted">${group.location ? `${e(group.location)} · ` : ""}${e(t("overview.last_reading", { age: age(group.at, now).toLowerCase() }))}</p></div><button class="text-button" data-details="${e(`${group.source}/${group.device}`)}" aria-label="${e(t("dashboard.details_for", { name: group.name }))}">${t("dashboard.details_short")}${icon("arrow")}</button></header><div class="place-rows"></div>${notes.length ? `<ul class="place-notes">${notes.map((item) => `<li><span class="badge" data-state="${item.severity}">${e(item.short)}</span></li>`).join("")}</ul>` : ""}`;
}

export function placesHeadingHTML() {
  return `<div class="places-heading"><h2>${t("overview.places_heading")}</h2><span>${e(t("overview.trend_window", { hours: TREND_HOURS }))}</span></div>`;
}

// One measurement row: label, value and the trend of the last hours.
export function placeRowHTML(channel, group, sensorName, now) {
  const value = ["ok", "recorded", "stale"].includes(channel.state)
    ? channel.value
    : null;
  const spark = plotGeometry(
    channel.points ?? [],
    96,
    24,
    channel.interval ? channel.interval * 3000 : Infinity,
    [now - TREND_HOURS * 3600000, now],
  );
  // A silent place says so once in its note; its rows do not repeat it.
  const quiet =
    channel.state === "ok" ||
    channel.state === "recorded" ||
    (group.stale && channel.state === "stale");
  return `<span class="row-label"><span class="row-title">${e(channel.title)}</span>${sensorName ? `<span class="row-sub">${e(sensorName)}</span>` : ""}${quiet ? "" : `<cj-badge state="${e(channel.state)}"></cj-badge>`}</span><span class="row-value" data-state="${e(channel.state)}">${formatMeasurement(value, channel.metric, channel.unit)}<span class="unit">${e(formatUnit(channel.unit))}</span></span><span class="row-trend">${spark ? `<svg class="spark" viewBox="0 0 96 28" preserveAspectRatio="none" aria-hidden="true"><path d="${spark.path}" transform="translate(0 2)"/></svg>` : ""}</span>`;
}
