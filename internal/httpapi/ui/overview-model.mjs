import { t, locale } from "./i18n.mjs";
import {
  formatMeasurement,
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

// A moment as a person says it: a time today, yesterday and a time, or a date before that,
// with the year when it is not this one. Days are calendar days, not 24-hour spans.
function moment(at, now) {
  const date = new Date(at),
    today = new Date(now),
    yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = date.toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === today.toDateString())
    return { day: "today", time };
  if (date.toDateString() === yesterday.toDateString())
    return { day: "yesterday", time };
  return {
    day: "date",
    time: date.toLocaleDateString(locale(), {
      day: "2-digit",
      month: "2-digit",
      ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }),
    }),
  };
}
const timeOf = (value) =>
  typeof value === "number" ? value : Date.parse(value);
// "since 06:58", "since yesterday 22:10", "since 05/10".
export function sinceText(value, now) {
  const at = timeOf(value);
  if (!Number.isFinite(at)) return "";
  const { day, time } = moment(at, now);
  return t(
    day === "yesterday" ? "overview.since_yesterday" : "overview.since",
    { time },
  );
}
// "at 06:58", "yesterday at 22:10", "on 05/10".
function atText(value, now) {
  const at = timeOf(value);
  if (!Number.isFinite(at)) return "";
  const { day, time } = moment(at, now);
  return t(`overview.at_${day}`, { time });
}
function interval(seconds) {
  return seconds % 60 === 0
    ? t("counts.minutes", { count: seconds / 60 })
    : t("counts.seconds", { count: seconds });
}
// The battery voltage to judge, shared by the overview and the devices page so both say
// the same: a current, recorded or old value counts; a failed read does not.
export function batteryVolts(group) {
  const channel = group?.diagnostics.find(
    (c) => c.sensor === "battery" && c.metric === "voltage",
  );
  const value = numeric(channel?.value);
  if (
    !channel ||
    value === null ||
    !["ok", "recorded", "stale"].includes(channel.state)
  )
    return null;
  return value;
}

// When a measurement started failing: the first failed reading after the last good one.
// Unknown when no good reading is loaded, since the failure may have begun earlier.
function failingSince(channel) {
  const points = (channel.points ?? [])
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  const lastGood = points.findLastIndex((p) => numeric(p.value) !== null);
  return lastGood === -1 ? null : (points[lastGood + 1]?.time ?? null);
}
// The sensor's name when the measurement alone does not say which one it is: someone
// typed it, or the place has the same measurement twice. Never when it repeats the title.
export function sensorLabel(group, sensor, channel) {
  const title = channel.title.toLocaleLowerCase();
  const name = sensor.name ?? "";
  if (!name || name.toLocaleLowerCase() === title) return "";
  const repeated =
    group.sensors
      .flatMap((s) => s.channels)
      .filter((c) => c.title.toLocaleLowerCase() === title).length > 1;
  return sensor.named || repeated ? name : "";
}

// What needs attention, most severe first, each with its reason and, when known, since
// when. Built from data Central already has: receiver connection and queue, silence,
// failed or late readings and battery. Value ranges are not known yet, so values themselves raise
// nothing.
export function attentionItems(groups, receivers, now) {
  const items = [];
  // Places whose silence an offline receiver explains: they are listed under it, once.
  const explained = new Set();
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
    const offlineAt = r.availability_retained
      ? NaN
      : Date.parse(r.availability_at);
    // A device silent since well before its receiver went offline has its own problem.
    const dependents = groups.filter(
      (g) =>
        g.state?.receiver_id === r.device_id &&
        g.source === r.source_id &&
        (!Number.isFinite(offlineAt) ||
          !g.interval ||
          Date.parse(g.at) >= offlineAt - g.interval * 3000),
    );
    for (const g of dependents) explained.add(placeKey(g));
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
    if (g.stale && !explained.has(placeKey(g))) {
      items.push({
        severity: "warning",
        key: `silent/${placeKey(g)}`,
        places: [placeKey(g)],
        title: t("overview.silent", { place: g.name }),
        short: t("overview.short_silent", { since: sinceText(g.at, now) }),
        detail: g.interval
          ? t("overview.silent_detail", {
              when: atText(g.at, now),
              interval: interval(g.interval),
            })
          : "",
        since: sinceText(g.at, now),
        at: Date.parse(g.at) || 0,
      });
    }
    // A silent place says so once; its measurements are listed only while it reports.
    if (!g.stale)
      for (const s of g.sensors)
        for (const c of s.channels) {
          if (!["error", "skipped", "stale"].includes(c.state)) continue;
          const sub = sensorLabel(g, s, c);
          const measurement = sub ? `${c.title} · ${sub}` : c.title;
          const stale = c.state === "stale";
          const start = stale ? Date.parse(c.at) || null : failingSince(c);
          items.push({
            severity: "warning",
            key: `reading/${c.key}`,
            places: [placeKey(g)],
            title: t(
              stale ? "overview.reading_stale" : "overview.sensor_failed",
              {
                place: g.name,
                measurement,
              },
            ),
            short: t(
              stale ? "overview.short_reading_stale" : "overview.short_sensor",
              { measurement },
            ),
            detail: stale
              ? t("overview.reading_stale_detail", { when: atText(c.at, now) })
              : t(`overview.${c.state}_detail`),
            since: start === null ? "" : sinceText(start, now),
            at: start ?? (Date.parse(c.at) || 0),
          });
        }
    const volts = batteryVolts(g);
    if (volts !== null && volts < BATTERY_LOW_V) {
      const critical = volts < BATTERY_CRITICAL_V;
      const value = `${formatMeasurement(volts, "voltage", "V")} V`;
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
            limit: `${formatMeasurement(critical ? BATTERY_CRITICAL_V : BATTERY_LOW_V, "voltage", "V")} V`,
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
