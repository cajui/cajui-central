import { watchDeviceStates } from "./state-events.mjs";
import { t, locale } from "./i18n.mjs";
import {
  escapeHTML as e,
  isLinkDiagnostic,
  age,
  formatMeasurement,
  formatUnit,
  csvRows,
  states,
  receiverLabel,
  deviceStateFor,
  receiverSummary,
  linkText,
} from "./model.mjs";
import { icon, metricIcon } from "./icons.mjs";
import {
  workspaceGroups,
  registeredGroups,
  automaticSections,
  withoutRevoked,
  resolveItem,
} from "./workspace-model.mjs";
import { openLayoutEditor } from "./layout-editor.mjs";
import {
  attentionItems,
  placeKey,
  placeSeverity,
  sensorLabel,
} from "./overview-model.mjs";
import { fetchSnapshot } from "./snapshot-api.mjs";
import {
  attentionItemHTML,
  placeHTML,
  placeRowHTML,
  placesHeadingHTML,
  summaryHTML,
} from "./overview-view.mjs";

// A value the firmware reported that this version has no text for.
function known(key, fallback) {
  const text = t(key);
  return text === key ? fallback : text;
}
export function mountDashboard(root, { state = {}, notify }) {
  let snapshot = state,
    channels = [],
    groups = [],
    filter = "all",
    query = "",
    selected = "",
    hours = 24,
    pending = false,
    dialogOpener = null,
    attention = [],
    shownAttention = "",
    historyOpener = null;
  root.innerHTML = `<header class="page-heading overview-heading"><div><h1>${t("common.dashboard")}</h1><p class="live-line"><span class="live-dot" aria-hidden="true"></span><span id="snapshot-time"></span></p></div><div class="top-actions"><button class="button" id="organize">${t("dashboard.organize")}</button><button class="button" id="export">${icon("download")}${t("dashboard.export")}</button><button class="button" id="refresh">${icon("refresh")}${t("common.refresh")}</button></div></header>
    <div id="fetch-error" class="notice hidden" role="status"></div>
    <section id="summary" class="overview-summary" aria-label="${t("dashboard.summary")}"></section>
    <section id="attention" class="panel attention-panel" aria-labelledby="attention-heading" hidden><div class="attention-head"><h2 id="attention-heading">${t("overview.attention_heading")}</h2><span>${t("overview.attention_order")}</span></div><ul class="attention-list"></ul></section>
    <div class="toolbar" id="toolbar"><div class="segmented" aria-label="${t("dashboard.filter")}"><button data-filter="all" aria-pressed="true">${t("dashboard.all")}</button><button data-filter="attention" aria-pressed="false">${t("dashboard.attention")}</button></div><label class="search">${icon("search")}<span class="sr-only">${t("dashboard.search_label")}</span><input id="search" type="search" placeholder="${t("dashboard.search")}" autocomplete="off"></label></div>
    <section id="devices" class="device-groups" aria-label="${t("dashboard.items")}"></section>
    <dialog class="history-dialog" id="history-panel" aria-labelledby="history-heading history-accessible" aria-describedby="history-context"><div class="dialog-head"><div><h2 id="history-heading" tabindex="-1">${t("common.history")}</h2><p id="history-context"></p><span class="sr-only" id="history-accessible"></span></div><button class="icon-button" id="close-history" aria-label="${t("dashboard.close_history")}">${icon("close")}</button></div><div class="history-summary"><div><span class="small muted">${t("dashboard.latest_reading")}</span><p class="measurement" id="history-value"></p><cj-badge id="history-state"></cj-badge></div><p class="small muted" id="history-time"></p></div><div class="history-controls"><label for="metric-select">${t("common.measurement")}<select id="metric-select" class="input"></select></label><label for="period">${t("dashboard.period")}<select id="period" class="input"><option value="24">${t("dashboard.hours24")}</option><option value="6">${t("dashboard.hours6")}</option><option value="1">${t("dashboard.hour")}</option><option value="0">${t("dashboard.all_data")}</option></select></label></div><cj-chart id="history"></cj-chart><div class="plot-footer"><div><span id="history-limit"></span></div><span id="plot-count"></span></div></dialog>
    <footer class="footer"><span>${t("dashboard.retention")}</span></footer>
    <dialog id="device-dialog" aria-labelledby="device-dialog-title"><div class="dialog-head"><h2 id="device-dialog-title">${t("dashboard.details")}</h2><button class="icon-button" id="close-dialog" aria-label="${t("dashboard.close_details")}">${icon("close")}</button></div><div id="device-detail"></div></dialog>`;

  function rebuild() {
    const now = Date.parse(snapshot.generated_at);
    groups = workspaceGroups(snapshot, now);
    if (snapshot.workspace) groups = registeredGroups(groups);
    // A transmitter whose receiver is offline cannot report: that needs attention too.
    const deviceStates = snapshot.device_states ?? [];
    for (const g of groups) {
      if (g.transport !== "mqtt") continue;
      const state = deviceStateFor(deviceStates, g.source, g.device);
      const receiver = state?.receiver_id
        ? deviceStateFor(deviceStates, g.source, state.receiver_id)
        : null;
      g.state = state;
      g.receiver = receiver;
      g.receiverOffline = receiver?.availability === "offline";
      if (g.receiverOffline) g.attention = true;
    }
    // A revoked transmitter no longer reports; it stays on the devices page only.
    groups = groups.filter((g) => g.state?.binding !== "revoked");
    channels = groups.flatMap((g) => [
      ...g.sensors.flatMap((s) => s.channels),
      ...g.diagnostics,
    ]);
    for (const c of channels) {
      c.updated = age(c.at, now);
      if (c.metric === "co2") c.title = t("metrics.co2");
      // The battery reports a voltage, but it is read as the battery.
      if (isLinkDiagnostic(c) && c.sensor === "battery")
        c.title = t("metrics.battery");
    }
    if (!channels.some((c) => c.key === selected)) selected = "";
  }

  // A layout may show the same reading or device in several sections, so a card
  // button is identified by its key and its position among equal keys.
  function focusSpot(element) {
    const { channelKey, details } = element?.dataset ?? {};
    const selector = channelKey
      ? `[data-channel-key="${CSS.escape(channelKey)}"]`
      : details
        ? `[data-details="${CSS.escape(details)}"]`
        : "";
    if (!selector) return null;
    return {
      selector,
      index: [...root.querySelectorAll(selector)].indexOf(element),
    };
  }
  function restoreFocus(spot, options) {
    if (spot) root.querySelectorAll(spot.selector)[spot.index]?.focus(options);
  }
  function receivers() {
    return (snapshot.device_states ?? []).filter((s) => s.role === "receiver");
  }
  function matchingGroups() {
    const search = query.trim().toLowerCase();
    return groups.filter(
      (g) =>
        (filter !== "attention" ||
          g.attention ||
          placeSeverity(placeKey(g), attention) !== "normal") &&
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
    if (!snapshot.workspace.layout.sections && groups.length) {
      renderPlaces(target);
      return;
    }
    const sections =
      snapshot.workspace.layout.sections ??
      automaticSections(withoutRevoked(snapshot));
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
          card.classList.add("transmitter-card");
          card.innerHTML = `<div class="device-identity"><span class="device-symbol">${icon("device")}</span><div><h3>${e(g.name)}</h3><p class="muted">${e(t("counts.registered", { count: g.sensors.length }))}${g.location ? ` · ${e(g.location)}` : ""}</p></div></div><p class="device-last-report">${e(t("dashboard.last_report", { age: age(g.at, Date.parse(snapshot.generated_at)) }))}</p>${g.receiverOffline ? `<p class="device-alert"><span class="badge" data-state="network">${e(t("receivers.receiver_offline"))}</span></p>` : ""}<div class="transmitter-footer">${["ok", "recorded"].includes(deviceStatus(g)) ? "<span></span>" : `<cj-badge state="${deviceStatus(g)}"></cj-badge>`}<button class="text-button" data-details="${e(`${g.source}/${g.device}`)}" aria-label="${e(t("dashboard.details_for", { name: g.name }))}">${t("dashboard.details_short")}${icon("arrow")}</button></div>`;
          card
            .querySelector("[data-details]")
            .addEventListener("click", (event) =>
              showDevice(g, event.currentTarget),
            );
        } else {
          card.classList.add("sensor-group");
          if (readings.length > 1) card.classList.add("sensor-group-wide");
          card.innerHTML = `<header class="sensor-group-heading"><div><h3>${e(sensor.name)}</h3><p class="muted">${e(g.name)}${sensor.location ? ` · ${e(sensor.location)}` : ""}</p></div></header><div class="reading-grid"></div>`;
          for (const c of readings)
            card.querySelector(".reading-grid").append(readingButton(c, g));
        }
        items.append(card);
      }
      if (!items.children.length)
        items.innerHTML = `<p class="muted">${t(query.trim() || filter !== "all" ? "dashboard.no_items" : "dashboard.section_empty")}</p>`;
      target.append(block);
    }
    if (!sections.length) {
      const available = withoutRevoked(snapshot).devices.filter(
        (d) => !d.name,
      ).length;
      target.innerHTML = `<div class="empty">${icon("overview")}<h2>${t("dashboard.make_yours")}</h2><p>${available ? t("counts.detected", { count: available }) + " " : ""}${t("dashboard.get_started")}</p><div class="top-actions"><a class="button primary" href="/devices">${t("dashboard.manage_devices")}</a><a class="button" href="/sensors">${t("dashboard.manage_sensors")}</a></div></div>`;
    }
  }
  // One block per place (a transmitter, until places exist as records): its readings as
  // compact rows, and any problem of its own underneath.
  function renderPlaces(target) {
    const now = Date.parse(snapshot.generated_at);
    const list = document.createElement("div");
    list.className = "places";
    for (const g of groups) {
      const key = placeKey(g);
      const severity = placeSeverity(key, attention);
      const place = document.createElement("article");
      place.className = "panel place";
      place.dataset.severity = severity;
      const notes = attention.filter((item) => item.places.includes(key));
      place.innerHTML = placeHTML(g, notes, now);
      const rows = place.querySelector(".place-rows");
      for (const sensor of g.sensors)
        for (const c of sensor.channels)
          rows.append(placeRow(c, g, sensorLabel(g, sensor, c)));
      place
        .querySelector("[data-details]")
        .addEventListener("click", (event) =>
          showDevice(g, event.currentTarget),
        );
      list.append(place);
    }
    const section = document.createElement("div");
    section.className = "places-section";
    section.innerHTML = placesHeadingHTML();
    section.append(list);
    target.append(section);
  }
  function placeRow(c, g, sensorName) {
    const button = readingButton(c, g);
    button.classList.add("place-row");
    button.innerHTML = placeRowHTML(
      c,
      g,
      sensorName,
      Date.parse(snapshot.generated_at),
    );
    return button;
  }
  function renderAttention() {
    const panel = root.querySelector("#attention");
    panel.hidden = !attention.length;
    const html = attention.map(attentionItemHTML).join("");
    // Rewriting an unchanged list on every refresh would drop focus from its links.
    if (html === shownAttention) return;
    panel.querySelector(".attention-list").innerHTML = html;
    shownAttention = html;
  }
  function renderSummary() {
    root.querySelector("#summary").innerHTML = summaryHTML(
      attention,
      groups.length,
    );
  }
  function readingButton(c, g) {
    const button = document.createElement("button");
    button.className = "reading-button";
    button.dataset.channelKey = c.key;
    button.setAttribute(
      "aria-label",
      t("dashboard.inspect", {
        measurement: c.title,
        value: formatMeasurement(
          ["ok", "recorded", "stale"].includes(c.state) ? c.value : null,
          c.metric,
          c.unit,
        ),
        unit: formatUnit(c.unit),
        status: states[c.state],
        sensor: c.sensorName ?? c.sensor,
        device: g.name,
      }),
    );
    button.setAttribute("aria-pressed", String(c.key === selected));
    const reading = document.createElement("cj-reading");
    reading.data = c;
    button.append(reading);
    button.addEventListener("click", () =>
      selectHistory(c.key, focusSpot(button)),
    );
    return button;
  }
  function historyChannels(channel) {
    if (!channel) return [];
    const group = groups.find(
      (g) =>
        g.transport === channel.transport &&
        g.source === channel.source &&
        g.device === channel.device,
    );
    if (!group) return [];
    return isLinkDiagnostic(channel)
      ? group.diagnostics
      : (group.sensors.find((sensor) => sensor.id === channel.sensor)
          ?.channels ?? []);
  }

  function selectHistory(key, opener) {
    const c = channels.find((channel) => channel.key === key);
    if (!c) return;
    const dialog = root.querySelector("#history-panel");
    const opening = !dialog.open;
    if (opening) {
      historyOpener = opener ?? null;
      root.querySelector("#history").resetInspection();
      dialog.showModal();
    }
    selected = key;
    renderChart();
    for (const button of root.querySelectorAll(".reading-button"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.channelKey === key),
      );
    if (opening) {
      dialog.scrollTop = 0;
      root.querySelector("#history-heading").focus({ preventScroll: true });
    }
  }
  function renderChart() {
    const c = channels.find((c) => c.key === selected);
    const dialog = root.querySelector("#history-panel");
    if (!c) {
      if (dialog.open) dialog.close();
      return;
    }
    const select = root.querySelector("#metric-select");
    const choices = historyChannels(c);
    const options = choices
      .map(
        (channel) =>
          `<option value="${e(channel.key)}">${e(channel.title)} · ${e(formatUnit(channel.unit))}</option>`,
      )
      .join("");
    // Preserve the native selector during live state updates when its choices did not change.
    if (select.dataset.options !== options) {
      select.innerHTML = options;
      select.dataset.options = options;
    }
    select.value = selected;
    const points = c.points.filter(
      (p) =>
        !hours || p.time >= Date.parse(snapshot.generated_at) - hours * 3600000,
    );
    root.querySelector("#history").data = {
      ...c,
      label: c.title,
      points,
      plotHeight: 240,
      timeLabel: t("dashboard.received_time"),
    };
    root.querySelector("#history-panel").dataset.kind = metricIcon(c.metric);
    root.querySelector("#history-heading").textContent = isLinkDiagnostic(c)
      ? t("dashboard.device_diagnostics")
      : (c.sensorName ?? c.sensor);
    root.querySelector("#history-context").textContent =
      c.deviceName ?? c.device;
    root.querySelector("#history-accessible").textContent = t(
      "dashboard.history_accessible",
      {
        measurement: c.title,
        device: c.deviceName ?? c.device,
        source: c.source,
      },
    );
    root.querySelector("#history-state").setAttribute("state", c.state);
    const latest = c.points.at(-1);
    root.querySelector("#history-value").innerHTML =
      `${formatMeasurement(latest?.value, c.metric, c.unit)}<span class="unit">${e(formatUnit(c.unit))}</span>`;
    root.querySelector("#history-time").textContent = latest
      ? new Date(latest.time).toLocaleString(locale())
      : t("common.waiting");
    root.querySelector("#history-limit").textContent = t(
      "dashboard.history_limit",
    );
    root.querySelector("#plot-count").textContent = t("counts.observations", {
      count: points.length,
    });
  }
  function showDevice(g, opener) {
    const values = [
      [t("dashboard.device_id"), g.device],
      [t("common.source"), g.source],
      [t("common.transport"), g.transport.toUpperCase()],
      [
        t("common.last_report"),
        g.at ? new Date(g.at).toLocaleString(locale()) : t("common.unknown"),
      ],
      [
        t("dashboard.interval"),
        g.interval
          ? t("counts.seconds", { count: g.interval })
          : t("dashboard.not_reported"),
      ],
      [t("dashboard.registered_sensors"), g.sensors.length],
      [t("dashboard.arrival_status"), states[deviceStatus(g)]],
      ...(g.state
        ? [
            [
              t("receivers.binding"),
              known(
                `receivers.binding_${g.state.binding}`,
                t("common.unknown"),
              ),
            ],
            [
              t("receivers.receiver"),
              g.receiver
                ? `${receiverLabel(g.receiver.device_id)} · ${t(`receivers.${receiverSummary(g.receiver).status}`)}`
                : receiverLabel(g.state.receiver_id),
            ],
            [t("receivers.last_frame"), linkText(g.state.last_frame)],
          ]
        : []),
      ...g.diagnostics.map((c) => [
        c.title,
        `${formatMeasurement(["ok", "recorded", "stale"].includes(c.state) ? c.value : null, c.metric, c.unit)} ${formatUnit(c.unit)} · ${states[c.state]}`,
      ]),
    ];
    root.querySelector("#device-detail").innerHTML =
      `<h3>${e(g.name)}</h3><dl class="detail-list">${values.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl><p class="dialog-note">${t("dashboard.identity_note")}</p>`;
    const diagnostics = document.createElement("div");
    diagnostics.className = "diagnostic-readings";
    for (const c of g.diagnostics) {
      const button = document.createElement("button");
      button.className = "diagnostic-button";
      button.setAttribute(
        "aria-label",
        t("dashboard.inspect_history", {
          measurement: c.title,
          device: g.name,
        }),
      );
      button.textContent = t("dashboard.history_title", {
        measurement: c.title,
      });
      button.addEventListener("click", () => {
        root.querySelector("#device-dialog").close();
        selectHistory(c.key, dialogOpener);
      });
      diagnostics.append(button);
    }
    if (g.diagnostics.length)
      root.querySelector("#device-detail").append(diagnostics);
    dialogOpener = focusSpot(opener);
    root.querySelector("#device-dialog").showModal();
  }
  function render() {
    rebuild();
    attention = attentionItems(
      groups,
      receivers(),
      Date.parse(snapshot.generated_at),
    );
    renderSummary();
    renderAttention();
    root.querySelector("#toolbar").hidden =
      !snapshot.workspace?.layout.sections;
    renderGroups();
    renderChart();
    root.querySelector("#snapshot-time").textContent = t("dashboard.updated", {
      time: new Date(snapshot.generated_at).toLocaleTimeString(locale(), {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = root.querySelector("#refresh");
    button.disabled = true;
    try {
      const fresh = await fetchSnapshot("/");
      // An event can arrive while the full refresh is in flight.
      if (Date.parse(fresh.generated_at) < Date.parse(snapshot.generated_at)) {
        fresh.device_states = snapshot.device_states;
        fresh.generated_at = snapshot.generated_at;
      }
      snapshot = fresh;
      root.querySelector("#fetch-error").classList.add("hidden");
      delete root.querySelector(".live-line").dataset.state;
      // Re-rendering replaces the card buttons; keep keyboard focus on the same one.
      const spot = focusSpot(document.activeElement);
      render();
      restoreFocus(spot, { preventScroll: true });
    } catch {
      root.querySelector("#fetch-error").textContent = t(
        "dashboard.refresh_error",
      );
      root.querySelector("#fetch-error").classList.remove("hidden");
      // The page shows the last snapshot it has; it is no longer live.
      root.querySelector(".live-line").dataset.state = "error";
    } finally {
      pending = false;
      button.disabled = false;
    }
  }

  root.querySelector("#organize").hidden = !snapshot.workspace;
  root.querySelector("#organize").addEventListener("click", () =>
    openLayoutEditor(root, {
      ...snapshot,
      workspace: withoutRevoked(snapshot),
    }),
  );
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
  // A refresh may have replaced the button that opened the dialog; focus then stays
  // on the closed dialog's own button or falls back to the body.
  root.querySelector("#device-dialog").addEventListener("close", (event) => {
    if (root.querySelector("#history-panel").open) return;
    const focus = document.activeElement;
    if (!focus || focus === document.body || event.target.contains(focus))
      restoreFocus(dialogOpener);
  });
  root
    .querySelector("#close-dialog")
    .addEventListener("click", () =>
      root.querySelector("#device-dialog").close(),
    );
  root
    .querySelector("#close-history")
    .addEventListener("click", () =>
      root.querySelector("#history-panel").close(),
    );
  root.querySelector("#history-panel").addEventListener("close", () => {
    if (root.querySelector("#history-panel").open) return;
    selected = "";
    for (const button of root.querySelectorAll(".reading-button"))
      button.setAttribute("aria-pressed", "false");
    restoreFocus(historyOpener, { preventScroll: true });
  });
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
    notify(t("dashboard.exported"));
  });
  render();
  // Dialog controls retain their identity while new readings arrive.
  watchDeviceStates(state, (next) => {
    if (Date.parse(next.generated_at) < Date.parse(snapshot.generated_at))
      return;
    if (
      JSON.stringify(next.device_states) ===
      JSON.stringify(snapshot.device_states)
    )
      return;
    snapshot = { ...snapshot, ...next };
    const spot = focusSpot(document.activeElement);
    render();
    restoreFocus(spot, { preventScroll: true });
  });
  const timer = setInterval(() => {
    if (!document.hidden) refresh();
  }, 30000);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
    },
    { once: true },
  );
}
