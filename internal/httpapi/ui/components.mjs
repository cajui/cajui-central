import { t, locale } from "./i18n.mjs";
import {
  escapeHTML as e,
  states,
  numeric,
  formatValue,
  formatUnit,
  plotGeometry,
} from "./model.mjs";
import { icon, metricIcon } from "./icons.mjs";

function attributeNumber(element, name) {
  const value = element.getAttribute(name);
  return value === null || value.trim() === "" ? null : numeric(Number(value));
}

class Component extends HTMLElement {
  set data(value) {
    this._data = value;
    if (this.isConnected) this.render();
  }
  get data() {
    return this._data ?? {};
  }
  connectedCallback() {
    this.render();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }
}
class Badge extends Component {
  static observedAttributes = ["state", "label"];
  render() {
    const state = Object.hasOwn(states, this.getAttribute("state"))
      ? this.getAttribute("state")
      : "empty";
    this.innerHTML = `<span class="badge" data-state="${state}">${icon(state === "error" ? "alert" : state === "stale" || state === "warning" ? "clock" : state === "ok" ? "check" : "device")}${e(this.getAttribute("label") ?? states[state])}</span>`;
  }
}
class Sensor extends Component {
  static observedAttributes = [
    "label",
    "metric",
    "value",
    "unit",
    "state",
    "context",
    "updated",
  ];
  render() {
    const d = this.data;
    const state = d.state ?? this.getAttribute("state") ?? "empty";
    const raw = d.value ?? attributeNumber(this, "value");
    const value = ["ok", "stale", "recorded"].includes(state)
      ? numeric(raw)
      : null;
    const points = d.points ?? [];
    const spark = plotGeometry(
      points,
      180,
      28,
      d.interval ? d.interval * 3000 : Infinity,
    );
    const kind = metricIcon(d.metric ?? this.getAttribute("metric"));
    this.innerHTML = `<article class="card sensor-card" data-kind="${kind}" data-state="${e(state)}">
      <div class="sensor-heading"><span class="metric-icon">${icon(kind)}</span><div><h3 class="card-title">${e(d.title ?? this.getAttribute("label") ?? t("common.measurement"))}</h3><p class="card-context">${e(d.context ?? this.getAttribute("context") ?? t("components.no_sensor"))}</p></div></div>
      <p class="measurement">${formatValue(value)}<span class="unit">${e(formatUnit(d.unit ?? this.getAttribute("unit")))}</span></p>
      ${spark ? `<svg class="spark" viewBox="0 0 180 32" preserveAspectRatio="none" aria-hidden="true"><path d="${spark.path}" transform="translate(0 2)"/></svg>` : ""}
      <div class="sensor-status"><cj-badge state="${e(state)}"></cj-badge><span class="reading-age">${e(d.updated ?? this.getAttribute("updated") ?? t("age.unknown"))}</span></div>
      ${state === "ok" ? "" : `<p class="reading-note">${e(iconText(state))}</p>`}
      <span class="sensor-action" aria-hidden="true">${t("components.view_history")} ${icon("arrow")}</span>
    </article>`;
  }
}
function iconText(state) {
  return (
    {
      ok: t("components.latest"),
      recorded: t("components.reported"),
      stale: t("components.known"),
      error: t("components.unavailable"),
      skipped: t("components.skipped"),
      loading: t("components.waiting"),
    }[state] ?? t("common.waiting")
  );
}
// A measurement inside a sensor group. Device and sensor context belong to the group.
class Reading extends Component {
  render() {
    const d = this.data;
    const state = Object.hasOwn(states, d.state) ? d.state : "empty";
    const value = ["ok", "stale", "recorded"].includes(state)
      ? numeric(d.value)
      : null;
    const kind = metricIcon(d.metric);
    this.innerHTML = `<div class="reading-tile" data-kind="${kind}" data-state="${state}">
      <div class="reading-heading"><span class="metric-icon">${icon(kind)}</span><span class="reading-title">${e(d.title ?? t("common.measurement"))}</span></div>
      <p class="measurement">${formatValue(value)}<span class="unit">${e(formatUnit(d.unit))}</span></p>
      <div class="reading-quality"><cj-badge state="${state}"></cj-badge><span class="reading-age">${e(d.updated ?? t("age.unknown"))}</span></div>
      ${["ok", "recorded"].includes(state) ? "" : `<p class="reading-note">${e(iconText(state))}</p>`}
      <span class="reading-history" aria-hidden="true">${t("common.history")} ${icon("arrow")}</span></div>`;
  }
}
class Battery extends Component {
  static observedAttributes = ["value"];
  render() {
    const n = attributeNumber(this, "value");
    const valid = n !== null && Number.isFinite(n) && n >= 0 && n <= 100;
    this.innerHTML = `<span class="battery"><svg viewBox="0 0 25 14" fill="none" aria-hidden="true"><rect x="1" y="1" width="20" height="12" rx="2" stroke="currentColor"/><path d="M24 5v4" stroke="currentColor" stroke-width="2"/>${valid ? `<rect x="3" y="3" width="${n * 0.16}" height="8" rx="1" fill="currentColor"/>` : ""}</svg><span>${valid ? `${formatValue(n, 0)}%` : t("common.unknown")}</span><span class="sr-only"> ${t("components.battery")}</span></span>`;
  }
}
class Signal extends Component {
  static observedAttributes = ["value"];
  render() {
    const n = attributeNumber(this, "value");
    this.innerHTML = `<span class="signal">${icon("signal")}<span>${numeric(n) === null ? t("common.unknown") : `${formatValue(n, 0)} dBm`}</span><span class="sr-only"> ${t("components.signal")}</span></span>`;
  }
}
class Level extends Component {
  static observedAttributes = ["label", "value", "unit", "context"];
  render() {
    const n = attributeNumber(this, "value");
    const valid = n !== null && Number.isFinite(n) && n >= 0 && n <= 100;
    this.innerHTML = `<article class="card" data-kind="level"><div class="card-top"><span class="metric-icon">${icon("level")}</span><cj-badge state="${valid ? "ok" : "empty"}"></cj-badge></div><h3 class="card-title">${e(this.getAttribute("label") ?? t("components.fill"))}</h3><p class="measurement">${formatValue(valid ? n : null, 0)}<span class="unit">%</span></p><p class="card-context">${e(this.getAttribute("context") ?? "")}</p><div class="level-track" ${valid ? `role="meter" aria-label="${e(this.getAttribute("label") ?? t("components.fill"))}" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="100"` : ""}><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${valid ? n : 0}" height="8" rx="4"/></svg></div><div class="level-labels"><span>${t("components.empty")}</span><span>${t("components.full")}</span></div></article>`;
  }
}
class BinaryState extends Component {
  static observedAttributes = ["label", "value", "metric", "context", "state"];
  render() {
    const state = this.getAttribute("state") ?? "empty";
    this.innerHTML = `<article class="card"><div class="card-top"><h3>${e(this.getAttribute("label") ?? t("components.binary"))}</h3><cj-badge state="${e(state)}"></cj-badge></div><p class="state-value">${icon(metricIcon(this.getAttribute("metric")))}${e(["ok", "stale"].includes(state) ? (this.getAttribute("value") ?? t("common.unknown")) : t("common.unknown"))}</p><p class="state-description">${e(this.getAttribute("context") ?? "")}</p></article>`;
  }
}
class Device extends Component {
  static observedAttributes = [
    "label",
    "state",
    "battery",
    "signal",
    "context",
  ];
  render() {
    this.innerHTML = `<article class="card"><div class="card-top"><span class="metric-icon">${icon("device")}</span><cj-badge state="${e(this.getAttribute("state") ?? "empty")}"></cj-badge></div><h3 class="card-title">${e(this.getAttribute("label") ?? t("common.device"))}</h3><p class="card-context">${e(this.getAttribute("context") ?? "")}</p><div class="card-bottom"><cj-battery ${this.hasAttribute("battery") ? `value="${e(this.getAttribute("battery"))}"` : ""}></cj-battery><cj-signal ${this.hasAttribute("signal") ? `value="${e(this.getAttribute("signal"))}"` : ""}></cj-signal></div></article>`;
  }
}
class Chart extends Component {
  connectedCallback() {
    this.render();
    this.observer = new ResizeObserver(() => {
      if (Math.round(this.clientWidth) !== this.lastWidth) this.render();
    });
    this.observer.observe(this);
  }
  disconnectedCallback() {
    this.observer?.disconnect();
  }
  render() {
    this.dataset.kind = metricIcon(this.data.metric);
    this.lastWidth = Math.round(this.clientWidth);
    const width = Math.max(this.lastWidth, 260),
      plotWidth = width - 84;
    const {
      points = [],
      unit = "",
      label = t("common.history"),
      interval = 0,
    } = this.data;
    const g = plotGeometry(
      points,
      plotWidth,
      164,
      interval ? interval * 3000 : Infinity,
    );
    if (!g) {
      this.innerHTML = `<div class="empty"><h3>${t("chart.empty")}</h3><p>${t("chart.choose_period")}</p></div>`;
      return;
    }
    const gap = interval ? interval * 3000 : Infinity;
    const isolated = g.points
      .filter((p, i) => {
        const before = g.points[i - 1],
          after = g.points[i + 1];
        return (
          numeric(p.value) !== null &&
          (!before ||
            numeric(before.value) === null ||
            p.time - before.time > gap) &&
          (!after || numeric(after.value) === null || after.time - p.time > gap)
        );
      })
      .map(
        (p) =>
          `<circle class="point" cx="${g.x(p.time)}" cy="${g.y(p.value)}" r="4"/>`,
      )
      .join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map(
        (f) =>
          `<line class="gridline" x1="64" y1="${18 + 164 * f}" x2="${width - 20}" y2="${18 + 164 * f}"/><text x="54" y="${22 + 164 * f}" text-anchor="end">${formatValue(g.max * (1 - f) + g.min * f)}</text>`,
      )
      .join("");
    const time = (t) =>
      new Date(t).toLocaleTimeString(locale(), {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    this.innerHTML = `<svg class="plot" viewBox="0 0 ${width} 216" role="img" aria-label="${e(t("chart.description", { label, unit: formatUnit(unit), observations: t("counts.observations", { count: g.points.length }) }))}">${ticks}<g transform="translate(64 18)"><path class="series" d="${g.path}"/>${isolated}<line class="gridline cursor" x1="0" x2="0" y1="0" y2="164"/></g><text x="64" y="208">${time(g.start)}</text><text x="${width / 2}" y="208" text-anchor="middle">${time((g.start + g.end) / 2)}</text><text x="${width - 20}" y="208" text-anchor="end">${time(g.end)}</text></svg><label class="plot-inspect"><span>${t("chart.inspect")}</span><input type="range" min="0" max="${g.points.length - 1}" value="${g.points.length - 1}" aria-label="${e(t("chart.observations", { label }))}"><output></output></label><details class="small muted"><summary>${t("chart.table")}</summary><div class="table-wrap"><table><caption class="sr-only">${e(t("chart.data", { label }))}</caption><thead><tr><th>${t("chart.time")}</th><th>${e(t("chart.value", { unit: formatUnit(unit) }))}</th></tr></thead><tbody>${g.points.map((p) => `<tr><td>${e(new Date(p.time).toLocaleString(locale()))}</td><td>${numeric(p.value) === null ? t("chart.no_reading") : formatValue(p.value)}</td></tr>`).join("")}</tbody></table></div></details>`;
    const slider = this.querySelector("input"),
      output = this.querySelector("output"),
      cursor = this.querySelector(".cursor");
    const inspect = () => {
      const p = g.points[Number(slider.value)];
      output.textContent = `${time(p.time)} · ${formatValue(p.value)} ${formatUnit(unit)}`;
      cursor.setAttribute("x1", g.x(p.time));
      cursor.setAttribute("x2", g.x(p.time));
    };
    slider.addEventListener("input", inspect);
    inspect();
    const svg = this.querySelector("svg");
    svg.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const time =
        g.start +
        Math.max(
          0,
          Math.min(
            1,
            (((event.clientX - bounds.left) / bounds.width) * width - 64) /
              plotWidth,
          ),
        ) *
          (g.end - g.start);
      let nearest = 0;
      g.points.forEach((p, i) => {
        if (Math.abs(p.time - time) < Math.abs(g.points[nearest].time - time))
          nearest = i;
      });
      slider.value = nearest;
      inspect();
    });
  }
}
for (const [name, component] of Object.entries({
  "cj-badge": Badge,
  "cj-sensor": Sensor,
  "cj-reading": Reading,
  "cj-battery": Battery,
  "cj-signal": Signal,
  "cj-level": Level,
  "cj-state": BinaryState,
  "cj-device": Device,
  "cj-chart": Chart,
}))
  customElements.define(name, component);
