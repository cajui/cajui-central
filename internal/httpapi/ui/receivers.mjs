import { watchDeviceStates } from "./state-events.mjs";
import { openReceiverSetup } from "./receiver-setup.mjs";
import { t } from "./i18n.mjs";
import {
  escapeHTML as e,
  age,
  formatValue,
  receiverLabel,
  firmwareText,
  uptimeText,
  receiverSummary,
} from "./model.mjs";
import { icon } from "./icons.mjs";
import { saveWorkspace } from "./workspace-api.mjs";
import { fetchSnapshot } from "./snapshot-api.mjs";

// A value the firmware reported that this version has no text for.
function known(key, fallback) {
  const text = t(key);
  return text === key ? fallback : text;
}
export function receiversOf(snapshot) {
  return (snapshot.device_states ?? []).filter((s) => s.role === "receiver");
}
// Health of one receiver: connection, queue, forwarding and firmware.
export function receiverCard(r, snapshot) {
  const now = Date.parse(snapshot.generated_at);
  const summary = receiverSummary(r);
  const transmitters = (snapshot.device_states ?? []).filter(
    (s) =>
      s.role === "transmitter" &&
      s.source_id === r.source_id &&
      s.receiver_id === r.device_id &&
      s.binding !== "revoked",
  ).length;
  const wifi = r.wifi?.rssi_dbm;
  const rows = [
    [t("receivers.firmware"), firmwareText(r.firmware)],
    [t("receivers.uptime"), uptimeText(r.uptime_s)],
    [
      t("receivers.wifi"),
      typeof wifi === "number"
        ? `${formatValue(wifi, 0)} dBm`
        : t("common.unknown"),
    ],
    [
      t("receivers.queue"),
      r.queue && typeof r.queue.depth === "number"
        ? t("receivers.queue_value", {
            depth: formatValue(r.queue.depth, 0),
            capacity: formatValue(r.queue.capacity, 0),
          })
        : t("common.unknown"),
    ],
    [
      t("receivers.forwarded"),
      typeof r.forwarding?.published === "number"
        ? t("receivers.readings", {
            count: r.forwarding.published,
          })
        : t("common.unknown"),
    ],
    [
      t("receivers.retries"),
      typeof r.forwarding?.retries === "number"
        ? formatValue(r.forwarding.retries, 0)
        : t("common.unknown"),
    ],
    [
      t("receivers.reset"),
      r.reset_reason
        ? known(
            `receivers.reset_reasons.${r.reset_reason}`,
            t("receivers.reset_reasons.other"),
          )
        : t("common.unknown"),
    ],
    [
      t("receivers.availability_changed"),
      // A retained snapshot's time is when Central connected, not when it changed.
      r.availability_at && !r.availability_retained
        ? age(r.availability_at, now)
        : t("common.unknown"),
    ],
  ];
  const badge = { online: "ok", offline: "error", unknown: "empty" }[
    summary.status
  ];
  const card = document.createElement("article");
  card.className = "panel receiver-card";
  card.dataset.status = summary.status;
  card.innerHTML = `<div class="device-identity"><span class="device-symbol">${icon("signal")}</span><div><h2>${e(receiverLabel(r.device_id))}</h2><p class="muted">${e(t("receivers.transmitters", { count: transmitters }))}</p></div><span class="badge" data-state="${badge}">${e(t(`receivers.${summary.status}`))}</span></div>${summary.notices.length ? `<ul class="receiver-notices">${summary.notices.map((n) => `<li data-level="${n.level}">${n.level === "info" ? "" : icon("alert")}<span>${e(n.text)}</span></li>`).join("")}</ul>` : ""}<dl class="detail-list receiver-details">${rows.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl>`;
  return card;
}
// One line per receiver on the dashboard; problems carry their first notice.
export function receiverStatusLine(r) {
  const summary = receiverSummary(r);
  const badge = { online: "ok", offline: "error", unknown: "empty" }[
    summary.status
  ];
  const problem = summary.notices.find((n) => n.level !== "info");
  const link = document.createElement("a");
  link.className = "receiver-status";
  link.href = "/receivers";
  link.dataset.status = problem ? problem.level : summary.status;
  link.innerHTML = `${icon("signal")}<strong>${e(receiverLabel(r.device_id))}</strong><span class="badge" data-state="${badge}">${e(t(`receivers.${summary.status}`))}</span>${problem ? `<span class="receiver-status-note">${e(problem.text)}</span>` : ""}`;
  return link;
}
export function mountReceivers(root, { state, notify }) {
  let snapshot = state,
    pending = false;
  root.innerHTML = `<header class="page-heading"><div><h1>${t("receivers.heading")}</h1><p>${t("receivers.description")}</p></div><div class="top-actions"><button class="button primary" id="add-receiver">${t("setup.add")}</button><button class="button" id="refresh">${icon("refresh")}${t("common.refresh")}</button></div></header><div id="fetch-error" class="notice hidden" role="status"></div><div id="receiver-list" class="receiver-items"></div>`;
  function render() {
    const list = root.querySelector("#receiver-list");
    const receivers = receiversOf(snapshot);
    list.replaceChildren(
      ...receivers.map((r) => {
        const card = receiverCard(r, snapshot);
        const button = document.createElement("button");
        button.className = "button danger-text";
        button.textContent = t("registry.archive");
        button.setAttribute(
          "aria-label",
          t("registry.archive_name", { name: receiverLabel(r.device_id) }),
        );
        button.addEventListener("click", async () => {
          const name = receiverLabel(r.device_id);
          if (!window.confirm(t("receivers.archive_confirm", { name }))) return;
          button.disabled = true;
          try {
            await saveWorkspace(
              snapshot,
              `receivers/${encodeURIComponent(r.source_id)}/${encodeURIComponent(r.device_id)}/archive`,
              { received_at: r.received_at },
              "POST",
            );
            notify(t("registry.archived", { name }));
            await refresh();
          } catch (error) {
            notify(error.message);
            button.disabled = false;
          }
        });
        card.append(button);
        return card;
      }),
    );
    if (!receivers.length)
      list.innerHTML = `<div class="empty">${icon("signal")}<h2>${t("receivers.empty")}</h2><p>${t("receivers.empty_hint")}</p></div>`;
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = root.querySelector("#refresh");
    button.disabled = true;
    try {
      const fresh = await fetchSnapshot("/receivers");
      // An event can arrive while the full refresh is in flight.
      if (Date.parse(fresh.generated_at) < Date.parse(snapshot.generated_at)) {
        fresh.device_states = snapshot.device_states;
        fresh.generated_at = snapshot.generated_at;
      }
      snapshot = fresh;
      root.querySelector("#fetch-error").classList.add("hidden");
      render();
    } catch {
      root.querySelector("#fetch-error").textContent = t(
        "dashboard.refresh_error",
      );
      root.querySelector("#fetch-error").classList.remove("hidden");
    } finally {
      pending = false;
      button.disabled = false;
    }
  }
  root.querySelector("#refresh").addEventListener("click", refresh);
  root
    .querySelector("#add-receiver")
    .addEventListener("click", () =>
      openReceiverSetup(root, snapshot, refresh),
    );
  render();
  const url = new URL(location.href);
  if (url.searchParams.get("setup") === "1") {
    url.searchParams.delete("setup");
    history.replaceState(history.state, "", url);
    openReceiverSetup(root, snapshot, refresh);
  }
  watchDeviceStates(state, (next) => {
    if (Date.parse(next.generated_at) < Date.parse(snapshot.generated_at))
      return;
    if (
      JSON.stringify(next.device_states) ===
      JSON.stringify(snapshot.device_states)
    )
      return;
    snapshot = { ...snapshot, ...next };
    render();
  });
  const timer = setInterval(() => {
    if (!document.hidden) refresh();
  }, 30000);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}
