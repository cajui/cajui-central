import {
  escapeHTML as e,
  buildChannels,
  age,
  formatValue,
  formatUnit,
  csvRows,
  states,
} from "/ui/model.mjs";
import { icon, metricIcon } from "/ui/icons.mjs";
import { demoData } from "./demo.mjs";

export function mountDashboard(root, { demo = false, state = {}, notify }) {
  let snapshot = demo ? demoData() : state;
  let channels = [],
    filter = "all",
    query = "",
    selected = "",
    hours = 24,
    pending = false;
  let timer;
  root.innerHTML = `<header class="page-heading"><div><h1>Overview</h1><p>Latest readings and reported issues.</p></div><div class="top-actions"><button class="button" id="export">${icon("download")}Export</button><button class="button primary" id="refresh">${icon("refresh")}Refresh</button></div></header><div id="fetch-error" class="notice hidden" role="status"></div><section class="summary-strip" aria-label="Workspace summary" id="summary"></section><div class="toolbar"><div class="segmented" aria-label="Filter sensors"><button data-filter="all" aria-pressed="true">All sensors</button><button data-filter="ok" aria-pressed="false">Updated</button><button data-filter="attention" aria-pressed="false">Needs attention</button></div><label class="search">${icon("search")}<span class="sr-only">Search sensors</span><input id="search" placeholder="Search sensors…" type="search" autocomplete="off"></label></div><section class="sensor-grid" id="sensors" aria-label="Latest sensor readings"></section><div class="main-grid"><section class="panel" id="history-panel"><div class="panel-heading"><div><h2 id="history-heading" tabindex="-1">Over time</h2><p id="history-subtitle">Recent measurements · local time</p></div><label><span class="sr-only">Chart period</span><select id="period" class="input"><option value="24">Last 24 hours</option><option value="6">Last 6 hours</option><option value="1">Last hour</option><option value="0">All loaded data</option></select></label></div><label class="sr-only" for="metric-select">Chart measurement</label><select id="metric-select" class="input"></select><cj-chart id="history"></cj-chart><div class="plot-footer"><span class="legend" id="chart-legend"></span><span id="plot-count"></span></div></section><section class="panel attention-panel" id="attention-panel"><div class="panel-heading"><div><h2>Needs attention</h2><p>Silence and reading errors, kept separate.</p></div>${icon("alert")}</div><div id="alerts" class="alert-list"></div></section></div><section class="panel table-panel" id="devices"><div class="panel-heading"><div><h2>Devices</h2><p>Last reported state of your connected devices.</p></div><span id="device-count" class="muted small"></span></div><div class="table-wrap"><table><caption class="sr-only">Device status and last report</caption><thead><tr><th>Device</th><th>Status</th><th>Battery</th><th>Signal</th><th>Last report</th></tr></thead><tbody id="device-rows"></tbody></table></div></section><footer class="footer"><span id="snapshot-time"></span><span>${demo ? "Simulated workspace · no devices controlled" : "Latest 100 samples + 100 HTTP readings · arrival times"} · <a href="/design/components">Component library</a></span></footer><dialog id="device-dialog" aria-labelledby="device-dialog-title"><div class="dialog-head"><h2 id="device-dialog-title">Device details</h2><button class="icon-button" id="close-dialog" aria-label="Close details">${icon("close")}</button></div><div id="device-detail"></div></dialog>`;
  root.querySelector("#devices").classList.add("device-section");
  const rebuild = () => {
    channels = buildChannels(snapshot, Date.parse(snapshot.generated_at));
    channels.forEach((c) => {
      const device = (snapshot.devices ?? []).find(
        (d) => d.device_id === c.device && d.source_id === c.source,
      );
      c.context = demo
        ? `${device?.location ?? c.device} · ${device?.name ?? c.sensor}`
        : `${c.device} · ${c.sensor}`;
      c.updated = age(c.at, Date.parse(snapshot.generated_at));
      if (c.metric === "co2") c.title = "Carbon dioxide";
    });
    if (!channels.some((c) => c.key === selected))
      selected = channels[0]?.key ?? "";
  };
  const filtered = () =>
    channels.filter(
      (c) =>
        (filter === "all" ||
          (filter === "ok"
            ? c.state === "ok"
            : ["stale", "error", "skipped", "empty"].includes(c.state))) &&
        [c.title, c.context, c.device, c.sensor, c.source]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  function renderCards() {
    const target = root.querySelector("#sensors");
    target.replaceChildren();
    for (const c of filtered()) {
      const button = document.createElement("button");
      button.className = "sensor-link sensor-button";
      button.setAttribute(
        "aria-label",
        `Inspect ${c.title}: ${formatValue(["ok", "stale", "recorded"].includes(c.state) ? c.value : null)} ${formatUnit(c.unit)}, ${states[c.state]}, from ${c.context}`,
      );
      button.setAttribute("aria-pressed", String(c.key === selected));
      const card = document.createElement("cj-sensor");
      card.data = c;
      button.append(card);
      button.addEventListener("click", () => {
        selected = c.key;
        root.querySelector("#metric-select").value = selected;
        renderChart();
        root.querySelector("#history-heading").focus({ preventScroll: true });
        root.querySelector("#history-panel").scrollIntoView({ block: "start" });
        for (const b of target.children)
          b.setAttribute("aria-pressed", String(b === button));
      });
      target.append(button);
    }
    if (!target.children.length)
      target.innerHTML = `<div class="empty">${icon("search")}<h3>${channels.length ? "No matching sensors" : "No readings received yet"}</h3><p>${channels.length ? "Try a different search or switch to All sensors." : "Measurements will appear here when a source sends data. Explore the example dashboard to see the components in context."}</p>${channels.length ? "" : '<a class="button" href="/design/dashboard">Explore example</a>'}</div>`;
  }
  function renderChart() {
    const c = channels.find((c) => c.key === selected);
    const end = Date.parse(snapshot.generated_at);
    const points =
      c?.points.filter((p) => !hours || p.time >= end - hours * 3600000) ?? [];
    root.querySelector("#history").data = {
      points,
      unit: c?.unit,
      label: c?.title,
      metric: c?.metric,
      interval: c?.interval,
    };
    root.querySelector("#history-panel").dataset.kind = metricIcon(c?.metric);
    root.querySelector("#chart-legend").textContent = c
      ? `${c.title} · ${formatUnit(c.unit)}`
      : "No measurement selected";
    root.querySelector("#plot-count").textContent =
      `${points.length} observations`;
  }
  function renderDevices() {
    const devices = snapshot.devices ?? [];
    root.querySelector("#device-count").textContent =
      `${devices.length} devices`;
    root.querySelector("#device-rows").innerHTML =
      devices
        .map(
          (d, i) =>
            `<tr><td><button data-device="${i}">${e(d.name ?? d.device_id)}</button><span class="secondary">${e(d.location ?? d.source_id)}</span></td><td><cj-badge state="${d.stale ? "stale" : "ok"}" ${d.stale ? 'label="No recent samples"' : ""}></cj-badge>${d.sensor_error ? ' <cj-badge state="error"></cj-badge>' : ""}</td><td><cj-battery ${Number.isFinite(d.battery) ? `value="${d.battery}"` : ""}></cj-battery></td><td><cj-signal ${Number.isFinite(d.signal) ? `value="${d.signal}"` : ""}></cj-signal></td><td><time datetime="${e(d.last_received_at)}">${e(age(d.last_received_at, Date.parse(snapshot.generated_at)))}</time></td></tr>`,
        )
        .join("") || '<tr><td colspan="5">No devices reported yet.</td></tr>';
    root
      .querySelectorAll("[data-device]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          showDevice(devices[Number(button.dataset.device)]),
        ),
      );
  }
  function showDevice(d) {
    const readings = channels.filter(
      (c) => c.device === d.device_id && c.source === d.source_id,
    );
    const details = [
      ["Source", d.source_id],
      ["Device ID", d.device_id],
      ["Last report", new Date(d.last_received_at).toLocaleString("en")],
      ["Expected interval", `${d.expected_interval_seconds} seconds`],
      ["Battery", Number.isFinite(d.battery) ? `${d.battery}%` : "Unknown"],
      [
        "Received signal",
        Number.isFinite(d.signal) ? `${d.signal} dBm` : "Unknown",
      ],
      ["Arrival status", d.stale ? "No recent samples" : "Recent sample"],
      [
        "Reading status",
        d.sensor_error ? "Reading error" : "No reported error",
      ],
    ];
    root.querySelector("#device-detail").innerHTML =
      `<h3>${e(d.name ?? d.device_id)}</h3><dl class="detail-list">${details.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}${readings.map((c) => `<div><dt>${e(c.title)}</dt><dd>${["ok", "stale", "recorded"].includes(c.state) ? formatValue(c.value) + " " + e(formatUnit(c.unit)) : e(states[c.state])}</dd></div>`).join("")}</dl><p class="dialog-note">${demo ? "These are simulated device details." : "Arrival status is based on new samples. It does not prove that the device is currently online. Battery and signal remain unknown unless reported."}</p>`;
    root.querySelector("#device-dialog").showModal();
  }
  function renderAlerts() {
    const devices = snapshot.devices ?? [];
    const items = [];
    for (const d of devices) {
      if (d.stale)
        items.push({
          d,
          kind: "stale",
          title: `${d.name ?? d.device_id} has not reported`,
          body: `Last sample ${age(d.last_received_at, Date.parse(snapshot.generated_at)).toLowerCase()}. Expected every ${d.expected_interval_seconds / 60} min.`,
        });
      if (d.sensor_error)
        items.push({
          d,
          kind: "error",
          title: `${d.name ?? d.device_id}: reading error`,
          body: "The device reported, but a measurement is unavailable.",
        });
    }
    root.querySelector("#alerts").innerHTML =
      items
        .map(
          (item, i) =>
            `<div class="alert-item" data-state="${item.kind}">${icon(item.kind === "stale" ? "clock" : "alert")}<div><p>${e(item.title)}</p><small>${e(item.body)}</small><button class="text-button" data-alert="${i}">View device details →</button></div></div>`,
        )
        .join("") ||
      `<div class="alert-empty">${icon("check")}<h3>No reported issues</h3><p class="small">${devices.length ? "No silence or reading errors in the latest reports." : "Device reports will appear here."}</p></div>`;
    root
      .querySelectorAll("[data-alert]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          showDevice(items[Number(button.dataset.alert)].d),
        ),
      );
  }
  function render() {
    rebuild();
    const devices = snapshot.devices ?? [];
    const recent = devices.filter((d) => !d.stale).length;
    const issues = devices.filter((d) => d.stale || d.sensor_error).length;
    const metrics = [
      ["Sensors", channels.length, "measurements"],
      ["Devices reporting", recent, `of ${devices.length} devices`],
      ["Loaded samples", (snapshot.samples ?? []).length, "most recent"],
      ["Need attention", issues, issues === 1 ? "device" : "devices"],
    ];
    root.querySelector("#summary").innerHTML = metrics
      .map(
        ([name, note, tail]) =>
          `<div class="summary-cell"${name === "Need attention" && issues ? ' data-attention="true"' : ""}>${name === "Need attention" ? `<a href="#attention-panel" class="summary-link"><div class="eyebrow">${icon(issues ? "alert" : "check")}${e(name)}</div><div class="summary-number">${note}<span>${e(tail)} →</span></div></a>` : `<div class="eyebrow">${e(name)}</div><div class="summary-number">${note}<span>${e(tail)}</span></div>`}</div>`,
      )
      .join("");
    root.querySelector("#metric-select").innerHTML = channels
      .map(
        (c) =>
          `<option value="${e(c.key)}" ${c.key === selected ? "selected" : ""}>${e(c.title)} · ${e(c.context)}</option>`,
      )
      .join("");
    root.querySelector("#metric-select").disabled = !channels.length;
    renderCards();
    renderChart();
    renderAlerts();
    renderDevices();
    root.querySelector("#snapshot-time").textContent =
      `${demo ? "Example generated" : "Updated"} ${new Date(snapshot.generated_at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}${demo ? "" : " · Refreshes every 30 s while visible"}`;
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = root.querySelector("#refresh");
    button.disabled = true;
    try {
      if (demo) {
        snapshot = demoData();
      } else {
        const response = await fetch("/", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("refresh failed");
        const doc = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        const next = JSON.parse(
          doc.querySelector("#initial-state").textContent,
        );
        if (
          !Array.isArray(next.samples) ||
          !Array.isArray(next.readings) ||
          !Array.isArray(next.devices)
        )
          throw new Error("invalid snapshot");
        snapshot = next;
      }
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
      renderCards();
    }),
  );
  root.querySelector("#search").addEventListener("input", (event) => {
    query = event.target.value;
    renderCards();
  });
  root.querySelector("#period").addEventListener("change", (event) => {
    hours = Number(event.target.value);
    renderChart();
  });
  root.querySelector("#metric-select").addEventListener("change", (event) => {
    selected = event.target.value;
    renderCards();
    renderChart();
  });
  root.querySelector("#refresh").addEventListener("click", refresh);
  root
    .querySelector("#close-dialog")
    .addEventListener("click", () =>
      root.querySelector("#device-dialog").close(),
    );
  root.querySelector("#export").addEventListener("click", () => {
    const blob = new Blob([csvRows(filtered())], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = demo ? "cajui-example-readings.csv" : "cajui-readings.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Exported the visible sensor readings.");
  });
  render();
  if (!demo) {
    timer = setInterval(() => {
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
}
