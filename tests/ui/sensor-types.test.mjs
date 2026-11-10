import test from "node:test";
import assert from "node:assert/strict";
import { csvRows, plotGeometry } from "../../internal/httpapi/ui/model.mjs";
import { setLocale } from "../../internal/httpapi/ui/i18n.mjs";
import {
  genericName,
  levelPercent,
  shownMeasurement,
  typeDetail,
  typesFor,
} from "../../internal/httpapi/ui/sensor-types.mjs";
import {
  defaultSensorName,
  itemChoices,
  resolveItem,
  workspaceGroups,
} from "../../internal/httpapi/ui/workspace-model.mjs";
import { placeRowHTML } from "../../internal/httpapi/ui/overview-view.mjs";

// A probe on an analog input: 3 V in dry soil, 1 V in wet soil (simulated).
function probeFixture(settings = {}) {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  const reading = (value, status = "ok") => ({
    sensor_id: "sensor-3",
    metric: "voltage",
    unit: "V",
    value,
    status,
  });
  return {
    generated_at: at(0),
    readings: [],
    devices: [],
    samples: [
      {
        source_id: "receiver",
        device_id: "node",
        sample_id: "a",
        received_at: at(10),
        expected_interval_seconds: 300,
        readings: [reading(2.5)],
      },
      {
        source_id: "receiver",
        device_id: "node",
        sample_id: "b",
        received_at: at(5),
        expected_interval_seconds: 300,
        readings: [reading(2)],
      },
    ],
    workspace: {
      devices: [
        {
          id: 1,
          transport: "mqtt",
          source: "receiver",
          device: "node",
          name: "Garden",
          location: "",
          revision: 1,
          received_at: at(5),
          interval: 300,
        },
      ],
      sensors: [
        {
          id: 7,
          device_id: 1,
          sensor: "sensor-3",
          name: "",
          location: "",
          revision: 0,
          type: "soil_moisture",
          calibration: { zero: 3, full: 1 },
          ...settings,
          measurements: [{ ...reading(2), received_at: at(5), interval: 300 }],
        },
      ],
      layout: { revision: 0, sections: null },
    },
  };
}
const probe = (state) => workspaceGroups(state)[0].sensors[0];

test("a level is the position of a reading between its two points", () => {
  const soil = { zero: 3, full: 1 };
  assert.equal(levelPercent(soil, 3), 0);
  assert.equal(levelPercent(soil, 1), 100);
  assert.equal(levelPercent(soil, 2), 50);
  // Rounded once: 15.5 is 16 here, in the export and on screen.
  assert.equal(levelPercent(soil, 2.69), 16);
  // Outside the marked range the index stays bounded.
  assert.equal(levelPercent(soil, 3.3), 0);
  assert.equal(levelPercent(soil, 0.2), 100);
  // Nothing says the dry point is the larger reading.
  assert.equal(levelPercent({ zero: 1, full: 3 }, 1.5), 25);
  // Zero is a reading; a missing reading or point is not.
  assert.equal(levelPercent({ zero: 0, full: 2 }, 0), 0);
  for (const [calibration, raw] of [
    [soil, null],
    [soil, undefined],
    [soil, NaN],
    [{ zero: 3, full: null }, 2],
    [{ zero: null, full: 1 }, 2],
    [{ zero: 2, full: 2 }, 2],
    [undefined, 2],
  ])
    assert.equal(levelPercent(calibration, raw), null);
});

test("a type is offered only to a sensor that reports what it reads", () => {
  setLocale("en-US");
  const sensor = (name, metric, unit) => ({
    sensor: name,
    measurements: [{ metric, unit }],
  });
  const analog = sensor("sensor-3", "voltage", "V");
  assert.deepEqual(typesFor(analog), ["soil_moisture"]);
  assert.equal(genericName(analog), "Voltage (generic)");
  setLocale("pt-BR");
  assert.equal(genericName(analog), "Tensão (genérico)");
  setLocale("en-US");
  // The battery is a device diagnostic, and millivolts are another measurement.
  assert.deepEqual(typesFor(sensor("battery", "voltage", "V")), []);
  assert.deepEqual(typesFor(sensor("sensor-3", "voltage", "mV")), []);
  assert.deepEqual(typesFor(sensor("sensor-1", "temperature", "degC")), []);
  assert.deepEqual(typesFor(undefined), []);
});

test("a calibrated probe is shown as a level while its identity stays raw", () => {
  setLocale("en-US");
  const state = probeFixture();
  const sensor = probe(state),
    [channel] = sensor.channels;
  assert.equal(sensor.name, "Soil moisture");
  assert.equal(channel.title, "Soil moisture");
  assert.equal(channel.metric, "soil_moisture");
  assert.equal(channel.unit, "%");
  assert.equal(channel.value, 50);
  assert.deepEqual(
    channel.points.map((p) => p.value),
    [25, 50],
  );
  assert.deepEqual(channel.raw, { metric: "voltage", unit: "V", value: 2 });
  assert.equal(typeDetail(channel), "2.00 V");
  // The key is the stored channel, so history and a selection keep working.
  assert.deepEqual(JSON.parse(channel.key).slice(3), [
    "sensor-3",
    "voltage",
    "V",
  ]);
  // A layout item names the stored measurement; its label says what is shown.
  const choice = itemChoices(state.workspace).find(
    (c) => c.item.kind === "measurement",
  );
  assert.deepEqual(choice.item, {
    kind: "measurement",
    sensor_id: 7,
    metric: "voltage",
    unit: "V",
  });
  assert.equal(choice.label, "Soil moisture (%) · Soil moisture · Garden");
  assert.equal(
    resolveItem(choice.item, workspaceGroups(state)).channels[0].key,
    channel.key,
  );
  // The export carries what the page shows.
  assert.match(csvRows([channel]), /"soil_moisture","50","%","ok"/);
  // Recalibrating re-reads the same stored readings.
  state.workspace.sensors[0].calibration = { zero: 2.5, full: 1.5 };
  assert.equal(probe(state).channels[0].value, 50);
  assert.deepEqual(
    probe(state).channels[0].points.map((p) => p.value),
    [0, 50],
  );
});

test("an uncalibrated probe keeps its volts and says what is missing", () => {
  setLocale("en-US");
  for (const calibration of [
    { zero: null, full: null },
    { zero: 3, full: null },
    undefined,
  ]) {
    const state = probeFixture({ calibration });
    const [channel] = probe(state).channels;
    assert.equal(channel.title, "Soil moisture");
    assert.equal(channel.unit, "V");
    assert.equal(channel.value, 2);
    assert.equal(channel.calibration, null);
    assert.equal(typeDetail(channel), "Not calibrated");
    const row = placeRowHTML(channel, { stale: false }, "", Date.now());
    assert.match(row, /Not calibrated/);
    assert.match(row, /2\.00<span class="unit">V<\/span>/);
    assert.doesNotMatch(row, /row-level/);
  }
  setLocale("pt-BR");
  assert.equal(
    typeDetail(
      probe(probeFixture({ calibration: { zero: 3, full: null } })).channels[0],
    ),
    "Falta calibrar",
  );
  setLocale("en-US");
});

test("a generic sensor and an unknown type are shown as telemetry describes", () => {
  setLocale("en-US");
  for (const type of ["", undefined, "tank_level", "__proto__"]) {
    const state = probeFixture({ type });
    const sensor = probe(state),
      [channel] = sensor.channels;
    assert.equal(sensor.name, "Voltage");
    assert.equal(channel.metric, "voltage");
    assert.equal(channel.value, 2);
    assert.equal(channel.raw, undefined);
    assert.equal(typeDetail(channel), "");
    assert.doesNotMatch(
      placeRowHTML(channel, { stale: false }, "", Date.now()),
      /row-level/,
    );
  }
});

test("a level row draws its meter only from a value", () => {
  setLocale("en-US");
  const state = probeFixture();
  const now = Date.parse(state.generated_at);
  const [channel] = probe(state).channels;
  const row = placeRowHTML(channel, { stale: false }, "Bed 1", now);
  assert.match(row, /<span class="row-sub">Bed 1 · 2\.00 V<\/span>/);
  assert.match(row, /50<span class="unit">%<\/span>/);
  assert.match(row, /class="row-level"><svg[^>]*><rect width="50"/);
  // A failed reading has no level: an unknown level must not look empty.
  state.samples.push({
    ...state.samples[1],
    sample_id: "c",
    received_at: state.generated_at,
    readings: [
      { ...state.samples[1].readings[0], value: null, status: "error" },
    ],
  });
  state.workspace.sensors[0].measurements[0] = {
    ...state.workspace.sensors[0].measurements[0],
    value: null,
    status: "error",
    received_at: state.generated_at,
  };
  const [failed] = probe(state).channels;
  assert.equal(failed.state, "error");
  assert.equal(failed.value, null);
  assert.equal(typeDetail(failed), "");
  assert.doesNotMatch(
    placeRowHTML(failed, { stale: false }, "", now),
    /row-level/,
  );
});

test("the sensors list and a default name follow the type", () => {
  setLocale("en-US");
  const [sensor] = probeFixture().workspace.sensors;
  assert.equal(defaultSensorName(sensor), "Soil moisture");
  const shown = shownMeasurement(sensor, sensor.measurements[0]);
  assert.deepEqual(
    [shown.metric, shown.unit, shown.value, shown.raw.metric, shown.raw.value],
    ["soil_moisture", "%", 50, "voltage", 2],
  );
  assert.equal(typeDetail(shown), "2.00 V");
  // The stored measurement is not rewritten.
  assert.equal(sensor.measurements[0].metric, "voltage");
});

test("a bounded chart keeps its axis within the limits", () => {
  const points = [0, 50, 100].map((value, time) => ({ time, value }));
  const free = plotGeometry(points, 100, 100);
  assert.ok(free.min < 0 && free.max > 100);
  const bounded = plotGeometry(points, 100, 100, Infinity, null, [0, 100]);
  assert.deepEqual([bounded.min, bounded.max], [0, 100]);
  assert.equal(bounded.y(0), 100);
  assert.equal(bounded.y(100), 0);
  // Inside the limits the axis still follows the readings.
  const narrow = plotGeometry(
    [40, 60].map((value, time) => ({ time, value })),
    100,
    100,
    Infinity,
    null,
    [0, 100],
  );
  assert.ok(narrow.min > 0 && narrow.max < 100);
  // A constant reading at a limit still has a range to be drawn in.
  for (const value of [0, 100]) {
    const flat = plotGeometry(
      [{ time: 0, value }],
      100,
      100,
      Infinity,
      null,
      [0, 100],
    );
    assert.ok(flat.max > flat.min && flat.min >= 0 && flat.max <= 100);
  }
});
