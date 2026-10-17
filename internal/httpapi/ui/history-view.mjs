import { t, locale } from "./i18n.mjs";
import {
  escapeHTML as e,
  formatMeasurement,
  formatUnit,
  states,
} from "./model.mjs";

export function historyControls() {
  return `<form id="history-range" class="history-range" hidden><label>${t("history.from")}<input class="input" name="from" type="datetime-local" required></label><label>${t("history.to")}<input class="input" name="to" type="datetime-local" required></label><button class="button" type="submit">${t("history.apply")}</button></form><p id="history-message" role="status" aria-live="polite"></p><button id="history-retry" class="button" hidden>${t("common.refresh")}</button>`;
}
export function historyTable() {
  return `<details id="history-table" class="small muted"><summary>${t("chart.table")}</summary><div class="table-wrap"><table><caption class="sr-only">${t("history.raw")}</caption><thead><tr><th>${t("dashboard.received_time")}</th><th id="history-unit"></th><th>${t("history.status")}</th></tr></thead><tbody></tbody></table></div><nav class="history-pagination" aria-label="${t("history.pages")}"><button class="button" id="history-newer">${t("history.newer")}</button><span id="history-page"></span><button class="button" id="history-older">${t("history.older")}</button></nav></details>`;
}

export function createHistoryView(root) {
  const chart = root.querySelector("#history"),
    table = root.querySelector("#history-table"),
    form = root.querySelector("#history-range"),
    period = root.querySelector("#period"),
    message = root.querySelector("#history-message"),
    retry = root.querySelector("#history-retry"),
    older = root.querySelector("#history-older"),
    newer = root.querySelector("#history-newer");
  let channel,
    snapshot,
    request,
    pageRequest,
    params,
    result,
    cursors = [null],
    pageIndex = 0,
    generation = 0,
    signature = "",
    customRange = null;

  function close() {
    generation++;
    request?.abort();
    pageRequest?.abort();
    channel = null;
    signature = "";
  }
  function clear() {
    result = null;
    pageIndex = 0;
    cursors = [null];
    chart.resetInspection();
    chart.data = { ...channel, points: [], showTable: false };
    table.querySelector("tbody").replaceChildren();
    table.open = false;
    older.disabled = newer.disabled = true;
    root.querySelector("#history-page").textContent = "";
    root.querySelector("#plot-count").textContent = "";
    root.querySelector("#history-limit").textContent = "";
  }
  function range() {
    if (period.value === "custom") return customRange;
    const to = new Date(snapshot.generated_at);
    return [
      new Date(+to - Number(period.value) * 3600000).toISOString(),
      to.toISOString(),
    ];
  }
  function sensorID() {
    const device = snapshot.workspace?.devices.find(
      (d) =>
        d.transport === channel.transport &&
        d.source === channel.source &&
        d.device === channel.device,
    );
    return snapshot.workspace?.sensors.find(
      (s) => s.device_id === device?.id && s.sensor === channel.sensor,
    )?.id;
  }
  async function fetchHistory(query, controller) {
    const response = await fetch(`/ui-api/history?${query}`, {
      headers: { "X-Cajui-Workspace": snapshot.ui_token },
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error(t("history.load_error"));
    return response.json();
  }
  function renderRows(data, index) {
    root.querySelector("#history-unit").textContent = t("chart.value", {
      unit: formatUnit(channel.unit),
    });
    table.querySelector("tbody").innerHTML = data.rows.length
      ? data.rows
          .map(
            (p) =>
              `<tr><td>${e(new Date(p.received_at).toLocaleString(locale()))}</td><td>${e(formatMeasurement(p.value, channel.metric, channel.unit))}</td><td>${e(p.status === "ok" ? t("history.valid") : (states[p.status] ?? p.status))}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3">${t("chart.empty")}</td></tr>`;
    root.querySelector("#history-page").textContent = t("history.page", {
      page: index + 1,
    });
    older.disabled = !data.next;
    newer.disabled = index === 0;
    cursors[index + 1] = data.next || null;
  }
  async function load(reset = true) {
    if (!channel || (period.value === "custom" && !customRange)) return;
    request?.abort();
    if (reset) {
      pageRequest?.abort();
      generation++;
      clear();
    }
    const current = generation;
    const controller = new AbortController();
    request = controller;
    retry.hidden = true;
    message.textContent = t("history.loading");
    chart.setAttribute("aria-busy", "true");
    try {
      const [from, to] = range();
      const id = sensorID();
      if (!id) throw new Error(t("history.load_error"));
      const query = new URLSearchParams({
        sensor: id,
        metric: channel.metric,
        unit: channel.unit,
        from,
        to,
      });
      const data = await fetchHistory(query, controller);
      if (controller.signal.aborted || current !== generation) return;
      chart.data = {
        ...channel,
        label: channel.title,
        points: data.points,
        interval: 0,
        plotHeight: 240,
        showTable: false,
        timeLabel: t("dashboard.received_time"),
      };
      root.querySelector("#plot-count").textContent = t("counts.observations", {
        count: data.count,
      });
      root.querySelector("#history-limit").textContent = t(
        data.sampled ? "history.sampled" : "history.complete",
      );
      if (
        reset ||
        !result ||
        (pageIndex === 0 && !table.open && !pageRequest)
      ) {
        params = query;
        result = data;
        cursors = [null];
        pageIndex = 0;
        renderRows(data, 0);
      }
      message.textContent = "";
    } catch (error) {
      if (controller.signal.aborted || current !== generation) return;
      message.textContent = error.message;
      retry.hidden = false;
    } finally {
      if (current === generation && request === controller) {
        request = null;
        chart.removeAttribute("aria-busy");
      }
    }
  }
  async function move(index) {
    if (!result || index < 0 || (index > 0 && !cursors[index])) return;
    pageRequest?.abort();
    const current = generation,
      controller = new AbortController();
    pageRequest = controller;
    older.disabled = newer.disabled = true;
    const query = new URLSearchParams(params);
    query.set("view", "rows");
    query.set("anchor", result.anchor);
    if (cursors[index]) query.set("before", cursors[index]);
    message.textContent = t("history.loading");
    try {
      const data = await fetchHistory(query, controller);
      if (controller.signal.aborted || current !== generation) return;
      pageIndex = index;
      renderRows(data, index);
      message.textContent = "";
    } catch (error) {
      if (controller.signal.aborted || current !== generation) return;
      message.textContent = error.message;
      older.disabled = !cursors[pageIndex + 1];
      newer.disabled = pageIndex === 0;
    } finally {
      if (pageRequest === controller) pageRequest = null;
    }
  }
  period.addEventListener("change", () => {
    request?.abort();
    pageRequest?.abort();
    generation++;
    clear();
    customRange = null;
    form.hidden = period.value !== "custom";
    message.textContent = "";
    if (!form.hidden) {
      const local = (date) =>
        new Date(date - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      if (!form.elements.to.value) {
        const to = new Date(snapshot.generated_at);
        form.elements.to.value = local(to);
        form.elements.from.value = local(new Date(+to - 86400000));
      }
      form.elements.from.focus();
    } else void load();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const from = new Date(form.elements.from.value),
      to = new Date(form.elements.to.value);
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+to) ||
      +from < 0 ||
      to <= from ||
      to - from > 366 * 86400000
    ) {
      message.textContent = t("history.invalid_range");
      return;
    }
    customRange = [from.toISOString(), to.toISOString()];
    void load();
  });
  retry.addEventListener("click", () => void load(false));
  older.addEventListener("click", () => void move(pageIndex + 1));
  newer.addEventListener("click", () => void move(pageIndex - 1));
  return {
    close,
    refresh() {
      if (channel && !request) void load(false);
    },
    show(next, state) {
      if (!root.querySelector("#history-panel").open) return;
      const changed = channel?.key !== next.key;
      channel = next;
      snapshot = state;
      const nextSignature = `${next.key}/${next.at}/${next.state}/${next.value}`;
      if (changed || signature !== nextSignature) {
        signature = nextSignature;
        void load(changed);
      }
    },
  };
}
