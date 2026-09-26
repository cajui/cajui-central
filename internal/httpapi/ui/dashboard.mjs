import {
  escapeHTML as e,
  buildChannels,
  buildDeviceGroups,
  isLinkDiagnostic,
  age,
  formatValue,
  formatUnit,
  csvRows,
  states,
} from "./model.mjs";
import { icon, metricIcon } from "./icons.mjs";

export function mountDashboard(root, { state = {}, notify }) {
  let snapshot = state,
    channels = [],
    groups = [],
    filter = "all",
    query = "",
    selected = "",
    hours = 24,
    pending = false;
  const openDetails = new Set();
  root.innerHTML = `<header class="page-heading"><div><h1>Overview</h1><p>Your devices, their sensors and latest measurements.</p></div><div class="top-actions"><button class="button" id="export">${icon("download")}Export readings</button><button class="button primary" id="refresh">${icon("refresh")}Refresh</button></div></header>
    <div id="fetch-error" class="notice hidden" role="status"></div>
    <section id="summary" class="device-summary" aria-label="Workspace summary"></section>
    <div class="toolbar"><div class="segmented" aria-label="Filter devices"><button data-filter="all" aria-pressed="true">All devices</button><button data-filter="attention" aria-pressed="false">Needs attention</button></div><label class="search">${icon("search")}<span class="sr-only">Search devices and sensors</span><input id="search" type="search" placeholder="Search devices…" autocomplete="off"></label></div>
    <section id="devices" class="device-groups" aria-label="Devices and sensors"></section>
    <section class="panel history-panel" id="history-panel" hidden><div class="panel-heading"><div><h2 id="history-heading" tabindex="-1">History</h2><p id="history-context"></p></div><label><span class="sr-only">Chart period</span><select id="period" class="input"><option value="24">Last 24 hours</option><option value="6">Last 6 hours</option><option value="1">Last hour</option><option value="0">All loaded data</option></select></label></div><label for="metric-select">Measurement</label><select id="metric-select" class="input"></select><cj-chart id="history"></cj-chart><div class="plot-footer"><span class="legend" id="chart-legend"></span><span id="plot-count"></span></div></section>
    <footer class="footer"><span id="snapshot-time"></span><span>Latest 100 samples + 100 HTTP readings · arrival times</span></footer>
    <dialog id="device-dialog" aria-labelledby="device-dialog-title"><div class="dialog-head"><h2 id="device-dialog-title">Device details</h2><button class="icon-button" id="close-dialog" aria-label="Close details">${icon("close")}</button></div><div id="device-detail"></div></dialog>`;

  function rebuild() {
    const now = Date.parse(snapshot.generated_at);
    channels = buildChannels(snapshot, now);
    for (const c of channels) {
      c.updated = age(c.at, now);
      if (c.metric === "co2") c.title = "Carbon dioxide";
      if (isLinkDiagnostic(c)) c.title = c.metric.toUpperCase();
    }
    groups = buildDeviceGroups(channels, snapshot.devices ?? []);
    if (!channels.some((c) => c.key === selected)) selected = "";
  }
  function matchingGroups() {
    const search = query.trim().toLowerCase();
    return groups.filter(
      (g) =>
        (filter !== "attention" || g.attention) &&
        [
          g.name,
          g.device,
          g.source,
          g.location,
          ...g.sensors.flatMap((s) => [
            s.name,
            ...s.channels.map((c) => c.title),
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search),
    );
  }
  function deviceStatus(g) {
    return g.transport === "http"
      ? "recorded"
      : g.stale
        ? "stale"
        : g.interval
          ? "ok"
          : "empty";
  }
  function renderGroups() {
    const target = root.querySelector("#devices");
    target.replaceChildren();
    for (const g of matchingGroups()) {
      const section = document.createElement("section");
      section.className = "device-group panel";
      section.dataset.deviceKey = g.key;
      const count = g.sensors.length;
      const metrics = g.sensors.reduce((n, s) => n + s.channels.length, 0);
      section.setAttribute("aria-label", `Device ${g.name}`);
      section.innerHTML = `<header class="device-group-heading"><div class="device-identity"><span class="device-symbol">${icon("device")}</span><div><p class="eyebrow">Device</p><h2>${e(g.name)}</h2><p class="device-context">${g.location ? `${e(g.location)} · ` : ""}${count} ${count === 1 ? "sensor" : "sensors"} · ${metrics} ${metrics === 1 ? "measurement" : "measurements"}</p></div></div><div class="device-arrival"><cj-badge state="${deviceStatus(g)}"${g.stale ? ' label="No recent samples"' : ""}></cj-badge><span>Last report ${e(age(g.at, Date.parse(snapshot.generated_at)))}</span><button class="text-button" data-details>Device details</button></div></header>
      ${g.stale || g.error ? `<div class="device-notice">${icon(g.error ? "alert" : "clock")}<span>${g.stale ? "No recent report from this device. " : ""}${g.error ? "One or more measurements reported an error." : "Showing the last known readings."}</span></div>` : ""}
      <div class="sensor-groups"></div>
      <details class="device-diagnostics"><summary>${icon("signal")}Connection details</summary><p class="muted">Link measurements describe reception, not environmental conditions.</p><div class="diagnostic-readings"></div><p class="small muted">${e(g.transport.toUpperCase())} · Source: ${e(g.source)}</p></details>`;
      const sensors = section.querySelector(".sensor-groups");
      for (const sensor of g.sensors) {
        const block = document.createElement("section");
        block.className = "sensor-group";
        block.setAttribute("aria-label", sensor.name);
        block.innerHTML = `<header class="sensor-group-heading"><h3>${e(sensor.name)}</h3><span>${sensor.channels.length} ${sensor.channels.length === 1 ? "measurement" : "measurements"}</span></header><div class="reading-grid"></div>`;
        for (const c of sensor.channels)
          block.querySelector(".reading-grid").append(readingButton(c, g));
        sensors.append(block);
      }
      if (!g.sensors.length)
        sensors.innerHTML =
          '<p class="device-no-readings">No sensor measurements in the loaded history.</p>';
      const diagnostics = section.querySelector(".diagnostic-readings");
      for (const c of g.diagnostics) {
        const button = document.createElement("button");
        button.className = "diagnostic-button";
        button.dataset.channelKey = c.key;
        button.setAttribute(
          "aria-label",
          `Inspect ${c.title} history for ${g.name}`,
        );
        button.innerHTML = `<strong>${e(c.title)}</strong><span>${formatValue(["ok", "recorded", "stale"].includes(c.state) ? c.value : null)} ${e(formatUnit(c.unit))}</span><cj-badge state="${e(c.state)}"></cj-badge><span>${e(c.updated)}</span>${icon("arrow")}`;
        button.addEventListener("click", () => selectHistory(c.key));
        diagnostics.append(button);
      }
      if (!g.diagnostics.length)
        diagnostics.innerHTML = "<p>No link measurements reported.</p>";
      const details = section.querySelector("details");
      details.open = openDetails.has(g.key);
      details.addEventListener("toggle", () => {
        if (details.open) openDetails.add(g.key);
        else openDetails.delete(g.key);
      });
      section
        .querySelector("[data-details]")
        .addEventListener("click", () => showDevice(g));
      target.append(section);
    }
    if (!target.children.length)
      target.innerHTML = `<div class="empty">${icon("device")}<h2>${groups.length ? "No matching devices" : "No devices yet"}</h2><p>${groups.length ? "Try another search or switch to All devices." : "Your devices and their sensors will appear when measurements arrive."}</p></div>`;
  }
  function readingButton(c, g) {
    const button = document.createElement("button");
    button.className = "reading-button";
    button.dataset.channelKey = c.key;
    button.setAttribute(
      "aria-label",
      `Inspect ${c.title}: ${formatValue(["ok", "recorded", "stale"].includes(c.state) ? c.value : null)} ${formatUnit(c.unit)}, ${states[c.state]}, sensor ${c.sensor}, device ${g.name}`,
    );
    button.setAttribute("aria-pressed", String(c.key === selected));
    const reading = document.createElement("cj-reading");
    reading.data = c;
    button.append(reading);
    button.addEventListener("click", () => selectHistory(c.key));
    return button;
  }
  function selectHistory(key) {
    selected = key;
    root.querySelector("#metric-select").value = key;
    renderChart();
    for (const button of root.querySelectorAll(".reading-button"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.channelKey === key),
      );
    root.querySelector("#history-heading").focus({ preventScroll: true });
    root.querySelector("#history-panel").scrollIntoView({ block: "start" });
  }
  function renderChart() {
    const c = channels.find((c) => c.key === selected);
    root.querySelector("#history-panel").hidden = !c;
    if (!c) return;
    const points = c.points.filter(
      (p) =>
        !hours || p.time >= Date.parse(snapshot.generated_at) - hours * 3600000,
    );
    root.querySelector("#history").data = { ...c, label: c.title, points };
    root.querySelector("#history-panel").dataset.kind = metricIcon(c.metric);
    root.querySelector("#history-heading").textContent = `${c.title} history`;
    root.querySelector("#history-context").textContent =
      `Device ${c.device} · ${isLinkDiagnostic(c) ? "Radio link" : `Sensor ${c.sensor}`} · Source ${c.source}`;
    root.querySelector("#chart-legend").textContent =
      `${c.title} · ${formatUnit(c.unit)}`;
    root.querySelector("#plot-count").textContent =
      `${points.length} observations`;
  }
  function showDevice(g) {
    const values = [
      ["Device ID", g.device],
      ["Source", g.source],
      ["Transport", g.transport.toUpperCase()],
      ["Last report", g.at ? new Date(g.at).toLocaleString("en") : "Unknown"],
      [
        "Expected interval",
        g.interval ? `${g.interval} seconds` : "Not reported",
      ],
      ["Sensors in loaded history", g.sensors.length],
      ["Arrival status", states[deviceStatus(g)]],
      ...g.diagnostics.map((c) => [
        c.title,
        `${formatValue(["ok", "recorded", "stale"].includes(c.state) ? c.value : null)} ${formatUnit(c.unit)} · ${states[c.state]}`,
      ]),
    ];
    root.querySelector("#device-detail").innerHTML =
      `<h3>${e(g.name)}</h3><dl class="detail-list">${values.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl><p class="dialog-note">Device and sensor identifiers come from received data. A recent report does not guarantee that a device is currently online. Counts cover the loaded history.</p>`;
    root.querySelector("#device-dialog").showModal();
  }
  function render() {
    rebuild();
    const sensorCount = groups.reduce((n, g) => n + g.sensors.length, 0);
    const measurements = groups.reduce(
      (n, g) => n + g.sensors.reduce((sum, s) => sum + s.channels.length, 0),
      0,
    );
    const issues = groups.filter((g) => g.attention).length;
    root.querySelector("#summary").innerHTML =
      `<p><strong>${groups.length}</strong> ${groups.length === 1 ? "device" : "devices"}<span aria-hidden="true"> / </span><strong>${sensorCount}</strong> ${sensorCount === 1 ? "sensor" : "sensors"}<span aria-hidden="true"> / </span><strong>${measurements}</strong> ${measurements === 1 ? "measurement" : "measurements"}</p>${issues ? `<span class="workspace-attention">${icon("alert")}${issues} ${issues === 1 ? "device needs" : "devices need"} attention</span>` : `<span class="muted">${groups.length ? "No reported issues" : "Waiting for data"}</span>`}`;
    root.querySelector("#metric-select").innerHTML = channels
      .map(
        (c) =>
          `<option value="${e(c.key)}">${e(c.title)} · ${e(c.device)} · ${e(c.sensor)} · ${e(formatUnit(c.unit))} · ${e(c.source)}</option>`,
      )
      .join("");
    root.querySelector("#metric-select").value = selected;
    renderGroups();
    renderChart();
    root.querySelector("#snapshot-time").textContent =
      `Updated ${new Date(snapshot.generated_at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })} · Refreshes every 30 s`;
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = root.querySelector("#refresh");
    button.disabled = true;
    try {
      const response = await fetch("/", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("refresh failed");
      const doc = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const next = JSON.parse(doc.querySelector("#initial-state").textContent);
      if (
        !Array.isArray(next.samples) ||
        !Array.isArray(next.readings) ||
        !Array.isArray(next.devices)
      )
        throw new Error("invalid snapshot");
      snapshot = next;
      root.querySelector("#fetch-error").classList.add("hidden");
      render();
    } catch {
      root.querySelector("#fetch-error").textContent =
        "Could not refresh. Showing the last loaded snapshot; its readings may be out of date.";
      root.querySelector("#fetch-error").classList.remove("hidden");
    } finally {
      pending = false;
      button.disabled = false;
    }
  }

  root.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      root
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      renderGroups();
    }),
  );
  root.querySelector("#search").addEventListener("input", (event) => {
    query = event.target.value;
    renderGroups();
  });
  root.querySelector("#period").addEventListener("change", (event) => {
    hours = Number(event.target.value);
    renderChart();
  });
  root
    .querySelector("#metric-select")
    .addEventListener("change", (event) => selectHistory(event.target.value));
  root.querySelector("#refresh").addEventListener("click", refresh);
  root
    .querySelector("#close-dialog")
    .addEventListener("click", () =>
      root.querySelector("#device-dialog").close(),
    );
  root.querySelector("#export").addEventListener("click", () => {
    const visible = matchingGroups().flatMap((g) =>
      g.sensors.flatMap((s) => s.channels),
    );
    const url = URL.createObjectURL(
      new Blob([csvRows(visible)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "cajui-readings.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Exported sensor measurements from the visible devices.");
  });
  render();
  const timer = setInterval(() => {
    if (
      !document.hidden &&
      !root.contains(document.activeElement) &&
      !root.querySelector("#device-dialog").open
    )
      refresh();
  }, 30000);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}
