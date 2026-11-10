import { t, metricLabel } from "./i18n.mjs";
import {
  formatMeasurement,
  formatUnit,
  isLinkDiagnostic,
  label,
  numeric,
} from "./model.mjs";

// What is connected to a generic input, declared once per sensor (ADR 0004). A type
// names the raw measurement it reads and what a calibrated reading is shown as. Stored
// readings stay raw: everything here only changes how one is read.
const types = {
  soil_moisture: {
    reads: { metric: "voltage", unit: "V" },
    metric: "soil_moisture",
    unit: "%",
  },
};
const typeOf = (sensor) =>
  Object.hasOwn(types, sensor?.type) ? types[sensor.type] : null;
const reads = (type, m) =>
  m.metric === type.reads.metric && m.unit === type.reads.unit;

// The types a sensor may take: those whose raw measurement it reports. A device
// diagnostic, such as the battery voltage, is never given another meaning.
export function typesFor(sensor) {
  return Object.keys(types).filter((id) =>
    (sensor?.measurements ?? []).some(
      (m) =>
        reads(types[id], m) &&
        !isLinkDiagnostic({ sensor: sensor.sensor, ...m }),
    ),
  );
}
// The sensor's measurement that a type reads: what a calibration point is taken from.
export function rawMeasurement(sensor, id) {
  return Object.hasOwn(types, id)
    ? (sensor?.measurements ?? []).find((m) => reads(types[id], m))
    : undefined;
}
// The name of the generic choice, after the measurement the types would replace.
export function genericName(sensor) {
  const metric = types[typesFor(sensor)[0]]?.reads.metric;
  return t("sensor_types.generic", {
    measurement: metricLabel(metric, label(metric)),
  });
}

// Where a raw reading sits between the two calibration points, from 0 to 100, or null
// when the reading or a point is missing. It is an index of that installation, so it
// keeps one decimal: finer steps would be noise from the input.
export function levelPercent(calibration, raw) {
  const zero = numeric(calibration?.zero),
    full = numeric(calibration?.full),
    value = numeric(raw);
  if (zero === null || full === null || value === null || zero === full)
    return null;
  const percent = ((value - zero) / (full - zero)) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

// How a sensor's type shows one of its measurements, or null when it has no say. The
// name follows the type at once; the percentage needs both calibration points.
function shown(sensor, measurement) {
  const type = typeOf(sensor);
  if (!type || !reads(type, measurement)) return null;
  const calibrated = levelPercent(sensor.calibration, 0) !== null;
  return {
    type: sensor.type,
    metric: type.metric,
    unit: calibrated ? type.unit : measurement.unit,
    calibration: calibrated ? sensor.calibration : null,
    value: (raw) => (calibrated ? levelPercent(sensor.calibration, raw) : raw),
  };
}
// A catalog measurement as the pages show it. Its stored identity stays in `raw`.
export function shownMeasurement(sensor, measurement) {
  const view = shown(sensor, measurement);
  if (!view) return measurement;
  return {
    ...measurement,
    raw: measurement,
    type: view.type,
    calibration: view.calibration,
    metric: view.metric,
    unit: view.unit,
    value: view.value(measurement.value),
  };
}
// The same for a channel, which also carries its recent points. The key keeps the
// stored metric and unit, so a selection or a layout item survives a change of type.
export function applyType(sensor, channel) {
  const view = shown(sensor, channel);
  if (!view) return channel;
  return Object.assign(channel, {
    raw: { metric: channel.metric, unit: channel.unit, value: channel.value },
    type: view.type,
    calibration: view.calibration,
    metric: view.metric,
    unit: view.unit,
    title: metricLabel(view.metric, label(view.metric)),
    value: view.value(channel.value),
    points: channel.points.map((p) => ({ ...p, value: view.value(p.value) })),
  });
}

// The detail beside a typed reading: its raw value once calibrated, or that the
// calibration is still missing. Empty for a generic reading or one without a value.
export function typeDetail(reading) {
  if (!reading.type) return "";
  if (!reading.calibration) return t("sensor_types.uncalibrated");
  const { metric, unit, value } = reading.raw;
  return numeric(value) === null
    ? ""
    : `${formatMeasurement(value, metric, unit)} ${formatUnit(unit)}`;
}
// The bounded meter of a level reading. Decorative: the number is in the text.
export function levelMeterHTML(percent) {
  return `<svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${percent}" height="8" rx="4"/></svg>`;
}
