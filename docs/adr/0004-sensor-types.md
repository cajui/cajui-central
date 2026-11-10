# 0004. A sensor type gives a raw reading its meaning

- Status: Accepted
- Date: 2026-11-10

## Context

Some sensors report an electrical value instead of the quantity a person cares about. A
capacitive soil moisture probe on an analog input arrives as `voltage` in `V`, so the
interface shows "Voltage", and the number says nothing until someone knows which reading
is dry and which is wet.

Telemetry cannot say what is wired to a generic input, and the two readings that anchor
the scale are not constants: they change with the probe, its supply voltage and the soil
it sits in. Somebody has to declare the meaning once and calibrate against the real
installation.

[0002](0002-monitoring-first-interface.md) decided one card per kind of data and left
measurement profiles for a later record. This is the first of them.

## Decision

1. **Meaning is declared once, on the sensor, in Central.** A sensor has a type. Empty
   means generic: the reading is shown as telemetry describes it. The first type is
   `soil_moisture`, which reads `voltage` in `V`. A type is offered only to a sensor that
   reports the measurement it reads, never to a device diagnostic such as the battery.
2. **Stored readings stay raw.** Telemetry, the history projection, API responses and
   MQTT are untouched. The type and its calibration are settings of the sensor, in new
   columns of `workspace_sensors` (schema 10).
3. **Calibration is two readings captured live.** One is the raw reading shown as 0 %,
   the other as 100 %. The person marks each one while the sensor is in that condition;
   no number is typed. The value is linear between them and bounded to 0–100 %.
4. **The shown value is computed when read**, in the interface model that turns catalog
   measurements into what the pages show. Rows, tiles, history, the sensors page, layout
   choices and the CSV export therefore agree, and recalibrating re-reads all history.
5. **It is drawn as the level kind** of 0002: the percentage, a bounded meter and the raw
   reading as a detail. Until both points exist the raw reading is shown under the type's
   name with a note that calibration is missing. That note is neutral, not a problem.
6. **The percentage is an index**, the position of the reading between the two marked
   conditions. It is not volumetric water content and is not comparable between soils.

## Alternatives

- **Convert on the device**, as ESPHome's `calibrate_linear` does. Rejected:
  recalibrating would need new firmware or a downlink, and history would keep each old
  calibration.
- **Store the converted value at ingestion.** Rejected for the same history problem, and
  the raw reading would be lost or stored twice.
- **Compute on the server when read**, returning percentages from the catalog and the
  history endpoint. Deferred: only the interface consumes derived values today, and it
  already owns presentation rules such as decimals and the battery limits. A server-side
  consumer (value alerts, discovery for other systems) would move the calculation there.
- **Infer the type from a sensor's name or metric.** Rejected: a wrong guess would be
  silent.
- **List the types in a database CHECK.** Rejected: every new type would need a table
  rebuild. The workspace package validates them; the database guards only the structure
  of the calibration.

## Consequences

- Consumers of the API and of MQTT, including Home Assistant, keep receiving volts.
- Adding a type is a code change and a release.
- `PUT /ui-api/sensors/{id}` replaces every setting of the sensor, including the type
  and its calibration. Returning a sensor to generic discards its calibration.
- Ranges and value alerts still do not exist; a calibrated value raises nothing.
- An older binary refuses a schema 10 database: back up before upgrading.
