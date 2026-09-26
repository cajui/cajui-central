import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHTML,
  numeric,
  formatValue,
  formatUnit,
  age,
  channelState,
  buildChannels,
  plotGeometry,
  csvRows,
  contrast,
  buildDeviceGroups,
  isLinkDiagnostic,
} from "../../internal/httpapi/ui/model.mjs";
import { demoData } from "../../docs/brand/demo.mjs";

test("missing, zero and failures remain distinct", () => {
  assert.equal(numeric(null), null);
  assert.equal(numeric(""), null);
  assert.equal(numeric(NaN), null);
  assert.equal(numeric(Infinity), null);
  assert.equal(formatValue(null), "—");
  assert.equal(formatValue(0), "0");
  assert.equal(formatUnit("degC"), "°C");
  const at = "2026-01-01T00:00:00Z",
    now = Date.parse(at) + 900000;
  assert.equal(channelState({ status: "ok", value: 0 }, at, 300, now), "stale");
  assert.equal(
    channelState({ status: "ok", value: 0 }, at, 300, now - 1),
    "ok",
  );
  assert.equal(
    channelState({ status: "error", value: 0 }, at, 300, now),
    "error",
  );
  assert.equal(channelState({ status: "skipped" }, at, 300, now), "skipped");
  assert.equal(
    channelState({ status: "ok", value: null }, at, 300, now),
    "empty",
  );
  assert.equal(channelState(null, at, 300, now), "empty");
  assert.equal(age("invalid", now), "Time unknown");
  assert.equal(age(at, now), "15 min ago");
});
test("channel identity includes source, device, sensor, metric and unit", () => {
  const data = demoData(Date.parse("2026-01-01T12:00:00Z"));
  const result = buildChannels(data, Date.parse(data.generated_at));
  assert.equal(result.length, 4);
  assert.equal(result[0].value, 24.6);
  assert.equal(result[3].state, "error");
  assert.equal(result[0].points.length, 49);
  const duplicate = {
    ...data.samples.at(-3),
    source_id: "another",
    received_at: data.generated_at,
  };
  data.samples.push(duplicate);
  assert.equal(buildChannels(data).length, 6);
  const base = {
    node_id: "node",
    sensor_id: "s",
    metric: "temperature",
    unit: "degC",
    value: 0,
    received_at: data.generated_at,
  };
  const http = buildChannels({ readings: [base, { ...base, unit: "degF" }] });
  assert.equal(http.length, 2);
  assert.equal(http[0].value, 0);
});
test("charts preserve gaps, actual time spacing, negative and constant readings", () => {
  const plot = plotGeometry(
    [
      { time: 0, value: 0 },
      { time: 10, value: null },
      { time: 20, value: -5 },
      { time: 100, value: 10 },
    ],
    100,
    100,
    50,
  );
  assert.equal((plot.path.match(/M/g) || []).length, 3);
  assert.equal(plot.x(20), 20);
  assert.ok(plot.min < -5);
  assert.ok(plot.max > 10);
  assert.equal(plotGeometry([{ time: 1, value: null }]), null);
  const constant = plotGeometry([
    { time: 1, value: 0 },
    { time: 2, value: 0 },
  ]);
  assert.ok(Number.isFinite(constant.y(0)));
  assert.ok(!constant.path.includes("NaN"));
});
test("escaping and CSV export do not turn names into markup or formulas", () => {
  assert.equal(escapeHTML('<img a="x">'), "&lt;img a=&quot;x&quot;&gt;");
  const csv = csvRows([
    {
      source: "=SUM(1)",
      device: "<script>",
      sensor: 'a"b',
      metric: "temperature",
      value: 0,
      unit: "degC",
      state: "ok",
      at: "time",
    },
    { state: "error", value: 0 },
  ]);
  assert.ok(csv.includes('"\'=SUM(1)"'));
  assert.ok(csv.includes('"a""b"'));
  assert.ok(csv.includes('"0"'));
  assert.ok(!csv.split("\r\n")[2].includes('"0"'));
});
test("foundational text pairs meet WCAG AA contrast", () => {
  for (const pair of [
    ["#20342e", "#ffffff"],
    ["#58685f", "#ffffff"],
    ["#ffffff", "#265d48"],
    ["#825513", "#fff0d5"],
    ["#a23838", "#fbe8e5"],
    ["#ecf3e9", "#1c2922"],
    ["#b4c2b6", "#1c2922"],
  ])
    assert.ok(contrast(...pair) >= 4.5, pair.join(" on "));
});

test("valid extreme values and prototype-like units stay representable", () => {
  assert.equal(formatUnit("constructor"), "constructor");
  const g = plotGeometry([
    { time: 2, value: Number.MAX_VALUE },
    { time: 1, value: -Number.MAX_VALUE },
  ]);
  assert.ok(Number.isFinite(g.min) && Number.isFinite(g.max));
  assert.ok(!/NaN|Infinity/.test(g.path));
  assert.ok(Number.isFinite(g.y(0)));
  assert.ok(formatValue(Number.MAX_VALUE).length < 20);
  const r = {
    sensor_id: "s",
    metric: "temperature",
    unit: "degC",
    value: 1,
    status: "ok",
  };
  const state = {
    samples: [
      {
        source_id: "HTTP",
        device_id: "d",
        received_at: "2026-01-01T00:00:00Z",
        expected_interval_seconds: 1,
        readings: [r],
      },
    ],
    readings: [{ ...r, node_id: "d", received_at: "2026-01-01T00:00:00Z" }],
  };
  assert.equal(buildChannels(state).length, 2);
});

test("CSV keeps negative measurements numeric and escapes whitespace formulas", () => {
  const csv = csvRows([
    { source: "  =SUM(1)", device: "\n=1", value: -5, state: "ok" },
  ]);
  assert.ok(csv.includes('"-5"'));
  assert.ok(csv.includes('"\'  =SUM(1)"'));
  assert.ok(csv.includes('"\'\n=1"'));
});

test("device groups keep physical sensors together and isolate radio diagnostics", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const sample = {
    source_id: "source-a",
    device_id: "node-1",
    received_at: new Date(now).toISOString(),
    expected_interval_seconds: 300,
    readings: [
      {
        sensor_id: "sensor-1",
        metric: "temperature",
        unit: "degC",
        value: 24,
        status: "ok",
      },
      {
        sensor_id: "sensor-1",
        metric: "humidity",
        unit: "%",
        value: 0,
        status: "ok",
      },
      {
        sensor_id: "radio",
        metric: "rssi",
        unit: "dBm",
        value: -85,
        status: "ok",
      },
      {
        sensor_id: "radio",
        metric: "snr",
        unit: "dB",
        value: 12,
        status: "ok",
      },
    ],
  };
  const channels = buildChannels({ samples: [sample] }, now);
  const [group] = buildDeviceGroups(channels, [
    {
      source_id: "source-a",
      device_id: "node-1",
      last_received_at: sample.received_at,
      expected_interval_seconds: 300,
    },
  ]);
  assert.equal(group.sensors.length, 1);
  assert.equal(group.sensors[0].channels.length, 2);
  assert.equal(group.sensors[0].channels[0].metric, "temperature");
  assert.equal(group.sensors[0].channels[1].value, 0);
  assert.equal(group.diagnostics.length, 2);
  assert.equal(group.attention, false);
  assert.equal(
    isLinkDiagnostic({ sensor: "noise", metric: "rssi", unit: "dBm" }),
    false,
  );
  assert.equal(
    isLinkDiagnostic({ sensor: "radio", metric: "rssi", unit: "V" }),
    false,
  );
  const independent = buildChannels(
    {
      samples: [sample, { ...sample, source_id: "source-b" }],
      readings: [
        {
          node_id: "node-1",
          sensor_id: "sensor-1",
          metric: "temperature",
          unit: "degC",
          value: 0,
          received_at: sample.received_at,
        },
      ],
    },
    now,
  );
  assert.equal(buildDeviceGroups(independent).length, 3);
});

test("grouped views preserve units, unknown metrics, errors and silent devices", () => {
  const base = {
    transport: "mqtt",
    source: "s",
    device: "d",
    sensor: "sensor-1",
    metric: "temperature",
    unit: "degC",
    at: "2026-01-01T00:00:00Z",
    state: "ok",
    value: 0,
  };
  const groups = buildDeviceGroups(
    [
      base,
      { ...base, unit: "degF" },
      {
        ...base,
        sensor: "sensor-2",
        metric: "custom",
        state: "error",
        value: null,
      },
    ],
    [
      { source_id: "s", device_id: "d", stale: true },
      { source_id: "s", device_id: "silent", stale: true },
    ],
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].sensors.length, 2);
  assert.equal(groups[0].sensors[0].channels.length, 2);
  assert.equal(groups[0].error, true);
  assert.equal(groups[0].stale, true);
  assert.equal(groups[1].sensors.length, 0);
  assert.equal(groups[1].attention, true);
});
