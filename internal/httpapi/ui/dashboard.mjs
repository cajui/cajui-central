import {
  escapeHTML as e,
  isLinkDiagnostic,
  age,
  formatValue,
  formatUnit,
  csvRows,
  states,
} from "./model.mjs";
import { icon, metricIcon } from "./icons.mjs";
import {
  workspaceGroups,
  registeredGroups,
  automaticSections,
  resolveItem,
} from "./workspace-model.mjs";
import { openLayoutEditor } from "./layout-editor.mjs";

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
  root.innerHTML = `<header class="page-heading"><div><h1>Dashboard</h1><p>The measurements and devices you choose to follow.</p></div><div class="top-actions"><button class="button" id="organize">Organize dashboard</button><button class="button" id="export">${icon("download")}Export readings</button><button class="button primary" id="refresh">${icon("refresh")}Refresh</button></div></header>
    <div id="fetch-error" class="notice hidden" role="status"></div>
    <section id="summary" class="device-summary" aria-label="Workspace summary"></section>
    <div class="toolbar"><div class="segmented" aria-label="Filter devices"><button data-filter="all" aria-pressed="true">All devices</button><button data-filter="attention" aria-pressed="false">Needs attention</button></div><label class="search">${icon("search")}<span class="sr-only">Search devices and sensors</span><input id="search" type="search" placeholder="Search devices…" autocomplete="off"></label></div>
    <section id="devices" class="device-groups" aria-label="Devices and sensors"></section>
    <section class="panel history-panel" id="history-panel" hidden><div class="panel-heading"><div><h2 id="history-heading" tabindex="-1">History</h2><p id="history-context"></p></div><label><span class="sr-only">Chart period</span><select id="period" class="input"><option value="24">Last 24 hours</option><option value="6">Last 6 hours</option><option value="1">Last hour</option><option value="0">All loaded data</option></select></label></div><label for="metric-select">Measurement</label><select id="metric-select" class="input"></select><cj-chart id="history"></cj-chart><div class="plot-footer"><span class="legend" id="chart-legend"></span><span id="plot-count"></span></div></section>
    <footer class="footer"><span id="snapshot-time"></span><span>History: latest 100 samples + 100 HTTP readings · latest known values retained</span></footer>
    <dialog id="device-dialog" aria-labelledby="device-dialog-title"><div class="dialog-head"><h2 id="device-dialog-title">Device details</h2><button class="icon-button" id="close-dialog" aria-label="Close details">${icon("close")}</button></div><div id="device-detail"></div></dialog>`;

  function rebuild() {
    const now = Date.parse(snapshot.generated_at);
    groups = workspaceGroups(snapshot, now);
    if (snapshot.workspace) groups = registeredGroups(groups);
    channels = groups.flatMap((g) => [
      ...g.sensors.flatMap((s) => s.channels),
      ...g.diagnostics,
    ]);
    for (const c of channels) {
      c.updated = age(c.at, now);
      if (c.metric === "co2") c.title = "Carbon dioxide";
      if (isLinkDiagnostic(c)) c.title = c.metric.toUpperCase();
    }
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
    renderSections(target);
  }
  function renderSections(target) {
    const sections =
      snapshot.workspace.layout.sections ??
      automaticSections(snapshot.workspace);
    const matching = matchingGroups();
    for (const section of sections) {
      const block = document.createElement("section");
      block.className = "dashboard-section";
      block.setAttribute("aria-label", section.title);
      block.innerHTML = `<h2>${e(section.title)}</h2><div class="dashboard-items"></div>`;
      const items = block.querySelector(".dashboard-items");
      for (const item of section.items) {
        const resolved = resolveItem(item, matching);
        if (!resolved) continue;
        const { group: g, sensor, channels: readings } = resolved;
        const card = document.createElement("article");
        card.className = "panel dashboard-item";
        if (item.kind === "device") {
          card.innerHTML = `<div class="device-identity"><span class="device-symbol">${icon("device")}</span><div><p class="eyebrow">Device</p><h3>${e(g.name)}</h3><p class="muted">${e(g.location || `${g.sensors.length} registered ${g.sensors.length === 1 ? "sensor" : "sensors"}`)}</p></div></div><div class="device-arrival"><cj-badge state="${deviceStatus(g)}"></cj-badge><span>Last report ${e(age(g.at, Date.parse(snapshot.generated_at)))}</span></div><button class="button" data-details>Device details</button><details class="device-diagnostics"><summary>Connection details</summary><div class="diagnostic-readings"></div></details>`;
          card
            .querySelector("[data-details]")
            .addEventListener("click", () => showDevice(g));
          const details = card.querySelector("details");
          details.open = openDetails.has(g.key);
          details.addEventListener("toggle", () => {
            if (!details.isConnected) return;
            if (details.open) openDetails.add(g.key);
            else openDetails.delete(g.key);
          });
          const diagnostics = card.querySelector(".diagnostic-readings");
          for (const c of g.diagnostics) {
            const button = document.createElement("button");
            button.className = "diagnostic-button";
            button.setAttribute(
              "aria-label",
              `Inspect ${c.title} history for ${g.name}`,
            );
            button.textContent = `${c.title}: ${formatValue(c.value)} ${formatUnit(c.unit)}`;
            button.addEventListener("click", () => selectHistory(c.key));
            diagnostics.append(button);
          }
          if (!g.diagnostics.length)
            diagnostics.textContent = "No link measurements reported.";
        } else {
          card.classList.add("sensor-group");
          card.innerHTML = `<header class="sensor-group-heading"><div><p class="eyebrow">Sensor</p><h3>${e(sensor.name)}</h3><p class="muted">${e(g.name)}${sensor.location ? ` · ${e(sensor.location)}` : ""}</p></div></header><div class="reading-grid"></div>`;
          for (const c of readings)
            card.querySelector(".reading-grid").append(readingButton(c, g));
        }
        items.append(card);
      }
      if (!items.children.length)
        items.innerHTML =
          '<p class="muted">No matching items in this section.</p>';
      target.append(block);
    }
    if (!sections.length) {
      const available = snapshot.workspace.devices.filter(
        (d) => !d.name,
      ).length;
      target.innerHTML = `<div class="empty">${icon("overview")}<h2>Make this dashboard yours</h2><p>${available ? `${available} detected devices are ready to name. ` : ""}Register your devices and sensors, then choose what to show here.</p><div class="top-actions"><a class="button primary" href="/devices">Manage devices</a><a class="button" href="/sensors">Manage sensors</a></div></div>`;
    }
  }
  function readingButton(c, g) {
    const button = document.createElement("button");
    button.className = "reading-button";
    button.dataset.channelKey = c.key;
    button.setAttribute(
      "aria-label",
      `Inspect ${c.title}: ${formatValue(["ok", "recorded", "stale"].includes(c.state) ? c.value : null)} ${formatUnit(c.unit)}, ${states[c.state]}, sensor ${c.sensorName ?? c.sensor}, device ${g.name}`,
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
      `Device ${c.deviceName ?? c.device} · ${isLinkDiagnostic(c) ? "Radio link" : `Sensor ${c.sensorName ?? c.sensor}`} · Source ${c.source}`;
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
      ["Registered sensors", g.sensors.length],
      ["Arrival status", states[deviceStatus(g)]],
      ...g.diagnostics.map((c) => [
        c.title,
        `${formatValue(["ok", "recorded", "stale"].includes(c.state) ? c.value : null)} ${formatUnit(c.unit)} · ${states[c.state]}`,
      ]),
    ];
    root.querySelector("#device-detail").innerHTML =
      `<h3>${e(g.name)}</h3><dl class="detail-list">${values.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl><p class="dialog-note">Device and sensor identifiers come from received data. A recent report does not guarantee that a device is currently online. Names are local labels; registration does not grant network access.</p>`;
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
          `<option value="${e(c.key)}">${e(c.title)} · ${e(c.deviceName ?? c.device)} · ${e(c.sensorName ?? c.sensor)} · ${e(formatUnit(c.unit))} · ${e(c.source)}</option>`,
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

  root.querySelector("#organize").hidden = !snapshot.workspace;
  root
    .querySelector("#organize")
    .addEventListener("click", () => openLayoutEditor(root, snapshot));
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
    const keys = new Set(
      [...root.querySelectorAll(".reading-button")].map(
        (b) => b.dataset.channelKey,
      ),
    );
    const visible = channels.filter((c) => keys.has(c.key));
    const url = URL.createObjectURL(
      new Blob([csvRows(visible)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "cajui-readings.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Exported the visible sensor measurements.");
  });
  render();
  const timer = setInterval(() => {
    if (
      !document.hidden &&
      !root.contains(document.activeElement) &&
      !root.querySelector("dialog[open]")
    )
      refresh();
  }, 30000);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}
