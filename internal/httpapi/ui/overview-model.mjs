import { t, locale } from "./i18n.mjs";
import {
  formatValue,
  numeric,
  receiverLabel,
  receiverSummary,
} from "./model.mjs";

// cajui-firmware's power modes: below 3.4 V a node reports less often and below 3.2 V it
// stops transmitting. Both limits are provisional in the firmware until measured on a
// real LiPo cell; they are the defaults until battery ranges become configurable.
export const BATTERY_LOW_V = 3.4;
export const BATTERY_CRITICAL_V = 3.2;
const order = { critical: 0, warning: 1, network: 2 };
// A transmitter is one place until places exist as records.
export const placeKey = (group) =>
  `${group.transport}/${group.source}/${group.device}`;

// "06:58" today, "ontem 22:10" yesterday, a short date before that.
export function sinceText(value, now) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const time = new Date(at).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = (ms) => new Date(ms).toDateString();
  if (day(at) === day(now)) return t("overview.since", { time });
  if (day(at) === day(now - 86400000))
    return t("overview.since_yesterday", { time });
  return t("overview.since", {
    time: new Date(at).toLocaleDateString(locale(), {
      day: "2-digit",
      month: "2-digit",
    }),
  });
}
function clock(value) {
  return new Date(Date.parse(value)).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function interval(seconds) {
  return seconds % 60 === 0
    ? t("counts.minutes", { count: seconds / 60 })
    : t("counts.seconds", { count: seconds });
}
function batteryOf(group) {
  const channel = group.diagnostics.find(
    (c) => c.sensor === "battery" && c.metric === "voltage",
  );
  const value = numeric(channel?.value);
  if (!channel || value === null || !["ok", "stale"].includes(channel.state))
    return null;
  return value;
}

// What needs attention, most severe first, each with its reason and since when. Built
// from data Central already has: receiver connection and queue, silence, failed
// readings and battery. Value ranges are not known yet, so values themselves raise
// nothing.
export function attentionItems(groups, receivers, now) {
  const items = [];
  for (const r of receivers) {
    if (r.availability !== "offline") {
      // The receiver's own warnings (queue backlog, readings given up); its page explains them.
      for (const notice of receiverSummary(r).notices) {
        if (notice.level !== "warning") continue;
        items.push({
          severity: "warning",
          key: `receiver/${r.source_id}/${r.device_id}/${notice.kind}`,
          href: "/receivers",
          places: [],
          title: t(`overview.receiver_${notice.kind}`, {
            receiver: receiverLabel(r.device_id),
          }),
          detail: notice.text,
          since: "",
          at: 0,
        });
      }
      continue;
    }
    const dependents = groups.filter(
      (g) => g.state?.receiver_id === r.device_id && g.source === r.source_id,
    );
    const names = new Intl.ListFormat(locale(), { type: "conjunction" }).format(
      dependents.map((g) => g.name),
    );
    items.push({
      severity: "network",
      key: `receiver/${r.source_id}/${r.device_id}`,
      href: "/receivers",
      places: dependents.map(placeKey),
      title: t("overview.receiver_offline", {
        receiver: receiverLabel(r.device_id),
      }),
      short: t("overview.short_receiver", {
        receiver: receiverLabel(r.device_id),
      }),
      detail: dependents.length
        ? t("overview.receiver_offline_detail", { places: names })
        : t("overview.receiver_offline_alone"),
      // A retained snapshot's time is when Central connected, not when it changed.
      since:
        r.availability_at && !r.availability_retained
          ? sinceText(r.availability_at, now)
          : "",
      at: r.availability_retained ? 0 : Date.parse(r.availability_at) || 0,
    });
  }
  for (const g of groups) {
    if (g.stale && !g.receiverOffline) {
      items.push({
        severity: "warning",
        key: `silent/${placeKey(g)}`,
        places: [placeKey(g)],
        title: t("overview.silent", { place: g.name }),
        short: t("overview.short_silent", { time: clock(g.at) }),
        detail: g.interval
          ? t("overview.silent_detail", {
              time: clock(g.at),
              interval: interval(g.interval),
            })
          : "",
        since: sinceText(g.at, now),
        at: Date.parse(g.at) || 0,
      });
    }
    if (!g.stale)
      for (const c of g.sensors.flatMap((s) => s.channels)) {
        if (c.state !== "error" && c.state !== "skipped") continue;
        items.push({
          severity: "warning",
          key: `reading/${c.key}`,
          places: [placeKey(g)],
          title: t("overview.sensor_failed", {
            place: g.name,
            measurement: c.title,
          }),
          short: t("overview.short_sensor", { measurement: c.title }),
          detail: t(`overview.${c.state}_detail`),
          since: sinceText(c.at, now),
          at: Date.parse(c.at) || 0,
        });
      }
    const volts = batteryOf(g);
    if (volts !== null && volts < BATTERY_LOW_V) {
      const critical = volts < BATTERY_CRITICAL_V;
      const value = `${formatValue(volts, 2)} V`;
      items.push({
        severity: critical ? "critical" : "warning",
        key: `battery/${placeKey(g)}`,
        places: [placeKey(g)],
        title: t("overview.battery", { place: g.name, value }),
        short: t("overview.short_battery", { value }),
        detail: t(
          critical
            ? "overview.battery_critical_detail"
            : "overview.battery_low_detail",
          {
            limit: `${formatValue(critical ? BATTERY_CRITICAL_V : BATTERY_LOW_V, 1)} V`,
          },
        ),
        since: "",
        at: 0,
      });
    }
  }
  return items.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.at - a.at,
  );
}
// The worst severity among a place's items, or "normal".
export function placeSeverity(place, items) {
  const mine = items.filter((item) => item.places.includes(place));
  return mine.length
    ? mine.reduce((worst, item) =>
        order[item.severity] < order[worst.severity] ? item : worst,
      ).severity
    : "normal";
}
