import { t, locale } from "./i18n.mjs";
import { escapeHTML as e, receiverLabel } from "./model.mjs";
import { brokerSnapshot } from "./broker-api.mjs";

const statusKeys = {
  accepted: "broker.status_accepted",
  ignored: "broker.status_ignored",
  rejected: "broker.status_rejected",
  retry: "broker.status_retry",
};
const problemKeys = {
  connection: "broker.problem_connection",
  subscription: "broker.problem_subscription",
};

const kindKeys = {
  samples: "broker.kind_samples",
  state: "broker.kind_state",
  availability: "broker.kind_availability",
  results: "broker.kind_results",
  deleted: "broker.kind_deleted",
};

export function mountBroker(root, { state }) {
  const opened = new Set();
  const clock = new Intl.DateTimeFormat(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const timestamp = new Intl.DateTimeFormat(locale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  let snapshot = null,
    paused = false,
    busy = false,
    alive = true,
    query = "",
    status = "";
  root.innerHTML = `<header class="page-heading"><div><h1>${t("broker.title")}</h1><p>${t("broker.description")}</p></div><div class="top-actions"><a class="button" href="/receivers?setup=1">${t("setup.add")}</a><button class="button" id="broker-refresh">${t("common.refresh")}</button></div></header><p class="notice hidden" id="broker-error" role="status"></p><div id="broker-summary"></div><details class="panel broker-settings"><summary>${t("broker.settings")}</summary><div id="broker-settings"></div><p class="muted">${t("broker.settings_note")}</p></details><section class="panel broker-stream"><div class="page-heading"><div><h2>${t("broker.messages")}</h2><p>${t("broker.scope")}</p></div><button class="button" id="broker-pause">${t("broker.pause")}</button></div><div class="broker-filters"><label>${t("broker.filter")}<input class="input" type="search" id="broker-search"></label><label>${t("common.status")}<select class="input" id="broker-status"><option value="">${t("broker.all")}</option>${["accepted", "ignored", "rejected", "retry"].map((s) => `<option value="${s}">${t(statusKeys[s])}</option>`).join("")}</select></label></div><p class="muted" id="broker-buffer"></p><div id="broker-messages"></div></section>`;
  function render() {
    if (!snapshot) return;
    const d = snapshot;
    root.querySelector("#broker-summary").innerHTML =
      `<div class="broker-stats"><article class="panel"><h2>${t("broker.connection")}</h2><p class="badge" data-state="${d.connected ? "ok" : "error"}">${t(!d.configured ? "broker.disabled" : d.connected ? "broker.connected" : "broker.disconnected")}</p>${d.problem ? `<p>${t(problemKeys[d.problem] || "broker.problem_connection")}</p>` : ""}</article><article class="panel"><h2>${t("broker.received")}</h2><strong>${e(d.total ?? 0)}</strong><p>${t("broker.since_start")}</p></article><article class="panel"><h2>${t("broker.rejected")}</h2><strong>${e(d.rejected ?? 0)}</strong><p>${t("broker.rejected_note")}</p></article></div>`;
    const settings = [
      [t("broker.address"), d.host || "—"],
      [t("broker.port"), d.port || "—"],
      ["TLS", t(d.tls ? "broker.enabled" : "broker.off")],
      [t("broker.central_user"), d.username || "—"],
      [t("broker.client"), d.client_id || "—"],
    ];
    root.querySelector("#broker-settings").innerHTML =
      `<dl class="detail-list">${settings.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl><h3>${t("broker.subscriptions")}</h3><ul>${(d.topics ?? []).map((x) => `<li><code>${e(x)}</code></li>`).join("")}</ul>`;
    root.querySelector("#broker-buffer").textContent = t("broker.buffer", {
      count: d.limit,
    });
    renderMessages();
  }
  function renderMessages() {
    const messages = (snapshot?.messages ?? []).filter(
      (m) =>
        (!status || m.status === status) &&
        [m.topic, m.source, m.device]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
    );
    const target = root.querySelector("#broker-messages");
    const focused = target.contains(document.activeElement)
      ? document.activeElement.dataset.message
      : null;
    const visibleIDs = new Set(
      (snapshot?.messages ?? []).map((m) => String(m.id)),
    );
    for (const id of opened) if (!visibleIDs.has(id)) opened.delete(id);
    target.innerHTML = messages.length
      ? `<table class="broker-table"><caption class="sr-only">${t("broker.messages")}</caption><thead><tr><th scope="col">${t("broker.time")}</th><th scope="col">${t("broker.device")}</th><th scope="col" class="broker-kind">${t("broker.kind")}</th><th scope="col" class="broker-result">${t("common.status")}</th><th scope="col">${t("broker.details")}</th></tr></thead><tbody>${messages
          .map((m) => {
            const id = String(m.id),
              expanded = opened.has(id);
            const date = new Date(m.at),
              valid = Number.isFinite(date.getTime());
            const kind = m.kind || m.topic.split("/").at(-1);
            const registered = (state.workspace?.devices ?? []).find(
              (d) => d.source === m.source && d.device === m.device,
            );
            const managed = (state.device_states ?? []).find(
              (d) => d.source_id === m.source && d.device_id === m.device,
            );
            const deviceLabel =
              registered?.name ||
              (managed?.role === "receiver"
                ? receiverLabel(m.device)
                : m.device) ||
              "—";
            const kindLabel = kindKeys[kind] ? t(kindKeys[kind]) : "—";
            const badge = `<span class="badge" data-state="${m.status === "accepted" ? "ok" : m.status === "ignored" ? "empty" : "error"}">${e(t(statusKeys[m.status]))}</span>`;
            return `<tr class="broker-message"><td><time datetime="${e(m.at)}" title="${valid ? e(timestamp.format(date)) : ""}">${valid ? e(clock.format(date)) : "—"}</time></td><td class="broker-device"><span title="${e(m.device)}">${e(deviceLabel)}</span></td><td class="broker-kind">${e(kindLabel)}</td><td class="broker-result">${badge}</td><td><button class="button broker-expand" data-message="${e(id)}" aria-expanded="${expanded}" aria-controls="broker-detail-${e(id)}" aria-label="${e(t(expanded ? "broker.collapse_message" : "broker.expand_message", { id }))}">${t(expanded ? "broker.collapse" : "broker.expand")}</button></td></tr><tr class="broker-detail" id="broker-detail-${e(id)}" ${expanded ? "" : "hidden"}><td colspan="5"><dl class="detail-list"><div><dt>${t("broker.time")}</dt><dd>${valid ? e(timestamp.format(date)) : "—"}</dd></div><div><dt>${t("broker.device")}</dt><dd>${e(m.device || "—")}</dd></div><div><dt>${t("broker.source")}</dt><dd>${e(m.source || "—")}</dd></div><div><dt>${t("broker.kind")}</dt><dd>${e(kindLabel)}</dd></div><div><dt>${t("common.status")}</dt><dd>${badge}</dd></div><div><dt>${t("broker.topic")}</dt><dd><code>${e(m.topic)}</code></dd></div><div><dt>${t("broker.size")}</dt><dd>${e(m.bytes)} B</dd></div></dl>${m.retained ? `<p>${t("broker.retained")}</p>` : ""}${m.payload !== undefined ? `<pre>${e(JSON.stringify(m.payload, null, 2))}</pre>` : `<p class="muted">${t("broker.payload_omitted")}</p>`}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<p class="empty">${t("broker.empty")}</p>`;
    for (const button of target.querySelectorAll("button[data-message]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.message;
        if (opened.has(id)) opened.delete(id);
        else opened.add(id);
        renderMessages();
      });
      if (button.dataset.message === focused)
        button.focus({ preventScroll: true });
    }
  }
  async function refresh() {
    if (busy || !alive) return;
    busy = true;
    try {
      const next = await brokerSnapshot(state);
      if (!alive) return;
      snapshot = next;
      root.querySelector("#broker-error").classList.add("hidden");
      render();
    } catch (error) {
      if (alive) {
        const box = root.querySelector("#broker-error");
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    } finally {
      busy = false;
    }
  }
  root.querySelector("#broker-refresh").addEventListener("click", refresh);
  root.querySelector("#broker-search").addEventListener("input", (event) => {
    query = event.target.value.toLocaleLowerCase();
    renderMessages();
  });
  root.querySelector("#broker-status").addEventListener("change", (event) => {
    status = event.target.value;
    renderMessages();
  });
  root.querySelector("#broker-pause").addEventListener("click", (event) => {
    paused = !paused;
    event.target.textContent = t(paused ? "broker.resume" : "broker.pause");
    if (!paused) refresh();
  });
  const timer = setInterval(() => {
    if (!paused && !document.hidden) refresh();
  }, 2000);
  window.addEventListener(
    "pagehide",
    () => {
      alive = false;
      clearInterval(timer);
    },
    { once: true },
  );
  refresh();
}
