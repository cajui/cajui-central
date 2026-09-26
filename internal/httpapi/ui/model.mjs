// Pure presentation helpers. No network, DOM, credentials, or persistent telemetry.
export const states = Object.freeze({
  ok: "Updated",
  recorded: "Recorded",
  stale: "Stale",
  error: "Reading error",
  skipped: "Not sampled",
  empty: "No data",
  loading: "Loading",
  warning: "Attention",
  info: "Example",
});
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function formatValue(value, digits = 1) {
  return numeric(value) === null
    ? "—"
    : new Intl.NumberFormat("en", {
        maximumFractionDigits: digits,
        notation: Math.abs(value) >= 1e7 ? "scientific" : "standard",
      }).format(value);
}
export function formatUnit(unit) {
  const known = { degC: "°C", degF: "°F" };
  return Object.hasOwn(known, unit) ? known[unit] : (unit ?? "");
}
export function label(value) {
  const text = String(value ?? "").replace(/[_-]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function age(value, now = Date.now()) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "Time unknown";
  const seconds = Math.max(0, Math.floor((now - t) / 1000));
  return seconds < 60
    ? "Just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} min ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} h ago`
        : `${Math.floor(seconds / 86400)} d ago`;
}
export function channelState(reading, at, interval, now = Date.now()) {
  if (!reading) return "empty";
  // Silence and reading failure are independent: preserve failure on the card,
  // and show device silence independently in the device list.
  if (reading.status === "error" || reading.status === "skipped")
    return reading.status;
  if (numeric(reading.value) === null) return "empty";
  if (!interval) return "recorded";
  if (interval > 0 && now - Date.parse(at) >= interval * 3000) return "stale";
  return "ok";
}
export function buildChannels(data, now = Date.now()) {
  const channels = new Map();
  const add = (reading, metadata) => {
    const key = JSON.stringify([
      metadata.transport,
      metadata.source,
      metadata.device,
      reading.sensor_id,
      reading.metric,
      reading.unit,
    ]);
    if (!channels.has(key))
      channels.set(key, {
        key,
        ...metadata,
        sensor: reading.sensor_id,
        metric: reading.metric,
        unit: reading.unit,
        title: label(reading.metric),
        points: [],
        latestTime: -Infinity,
      });
    const channel = channels.get(key);
    const time = Date.parse(metadata.at);
    if (!Number.isFinite(time)) return;
    channel.points.push({
      time,
      value: reading.status === "ok" ? numeric(reading.value) : null,
    });
    if (time > channel.latestTime) {
      Object.assign(channel, metadata, {
        value: numeric(reading.value),
        state: channelState(reading, metadata.at, metadata.interval, now),
        latestTime: time,
      });
    }
  };
  for (const sample of data.samples ?? [])
    for (const reading of sample.readings ?? [])
      add(reading, {
        transport: "mqtt",
        source: sample.source_id,
        device: sample.device_id,
        at: sample.received_at,
        interval: sample.expected_interval_seconds,
      });
  for (const reading of data.readings ?? [])
    add(
      { ...reading, status: "ok" },
      {
        transport: "http",
        source: "HTTP",
        device: reading.node_id,
        at: reading.received_at,
        interval: 0,
      },
    );
  return [...channels.values()]
    .filter((c) => Number.isFinite(c.latestTime))
    .map((c) => ({ ...c, points: c.points.sort((a, b) => a.time - b.time) }));
}
export function plotGeometry(
  points,
  width = 620,
  height = 170,
  gap = Infinity,
) {
  const valid = points
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  const values = valid.map((p) => numeric(p.value)).filter((v) => v !== null);
  if (!values.length) return null;
  let min = Math.min(...values),
    max = Math.max(...values);
  // Normalize before subtracting so two finite values cannot overflow the range.
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  const low = min / scale,
    high = max / scale;
  const pad =
    high === low
      ? Math.max(Math.abs(high) * 0.04, 1 / scale)
      : (high - low) * 0.18;
  const bottom = low - pad,
    top = high + pad;
  min = Math.max(-Number.MAX_VALUE, bottom * scale);
  max = Math.min(Number.MAX_VALUE, top * scale);
  const start = valid[0].time,
    end = valid.at(-1).time;
  const x = (t) => ((t - start) / (end - start || 1)) * width;
  const y = (v) => height - ((v / scale - bottom) / (top - bottom)) * height;
  let path = "",
    open = false,
    previous = null;
  for (const p of valid) {
    if (numeric(p.value) === null) {
      open = false;
      previous = p.time;
      continue;
    }
    if (previous !== null && p.time - previous > gap) open = false;
    path += `${open ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)} `;
    open = true;
    previous = p.time;
  }
  return { path, min, max, start, end, x, y, points: valid };
}
export function csvRows(channels) {
  const cell = (value) => {
    const text = String(value ?? "");
    // Negative numeric measurements stay numeric; untrusted text cannot start
    // a spreadsheet formula, including after leading whitespace/control bytes.
    const safe =
      typeof value === "number"
        ? text
        : text.replace(/^(?=\s*[=+@-]|[\t\r\n])/, "'");
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const rows = [
    [
      "Source",
      "Device",
      "Sensor",
      "Metric",
      "Value",
      "Unit",
      "Status",
      "Received at",
    ],
  ];
  for (const c of channels)
    rows.push([
      c.source,
      c.device,
      c.sensor,
      c.metric,
      ["ok", "stale", "recorded"].includes(c.state) ? c.value : "",
      c.unit,
      c.state,
      c.at,
    ]);
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
export function contrast(foreground, background) {
  const luminance = (hex) => {
    const rgb = hex
      .replace("#", "")
      .match(/../g)
      .map((c) => parseInt(c, 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
