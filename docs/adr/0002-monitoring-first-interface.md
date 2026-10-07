# 0002. The interface is organised around monitoring, not inventory

- Status: Accepted
- Date: 2026-10-07

## Context

The interface grew out of device registration. Its pages list entity types (devices,
sensors, receivers, broker), the dashboard summary counts registrations, and every reading
carries a green "updated" badge, so on a healthy page every status mark says the same thing.
Colour identifies the quantity (temperature, humidity) rather than its condition.

What it cannot do is the core job of a monitor: tell, at a glance, whether anything needs
attention, what, where and since when.

- **No notion of a bad value or a failing device.** Attention comes only from the data
  path: late, failed, skipped or missing readings, and receivers that are offline or
  dropping readings. A low battery, a weak link or a value far outside its useful range
  looks exactly like a healthy one.
- **Every reading is drawn as a generic number.** Telemetry carries a numeric value, a
  free-text unit and a status, with no kind. A door contact shows "0 state", and a
  cumulative rain counter looks like a current value.
- **Little time context.** The page state carries the latest 100 samples across all
  devices, which is about an hour and a half per device with five transmitters reporting
  every five minutes.
- **No record of what changed.** A door opening or a receiver going offline exists only
  as a current value.

## Decision

1. **Exception first.** The overview starts with what needs attention, most severe first,
   each with its reason and the time it began. With nothing to report, it says so.
2. **Colour only for the abnormal.** Normal states are neutral. Status uses one fixed
   vocabulary, always with a shape and text and never colour alone:
   - attention: an amber triangle;
   - network: a blue circle, for a receiver or broker without a connection;
   - critical: a red diamond, reserved for values outside critical ranges.
3. **The value and the data are separate questions.** A value is normal, attention or
   critical against ranges set per sensor; Central suggests defaults by kind of
   measurement. Data is fresh, late, failed, not sampled or without a path to Central.
   Each has its own presentation.
4. **Places before equipment.** The overview groups readings by where they are. Until
   places exist as records, a transmitter's name and location stand in for its place.
5. **One card per kind of data, not per sensor.** The kinds are:
   - continuous value;
   - probe with several measurements;
   - state, such as a contact or float switch;
   - counter, such as rain or flow;
   - level;
   - weight;
   - event;
   - actuator;
   - device health.

   A measurement profile gives each metric its kind, label, decimals, unit, state labels
   and ranges. The components reference shows every kind in every state.
6. **Navigation by task.** The everyday entries are the overview, places and events.
   Equipment and settings are separate. An entry appears only when its data exists.

## Alternatives

- **Polish the current pages.** Rejected: the problems are structural, and a cleaner
  inventory is still an inventory.
- **Rely on Home Assistant or Grafana dashboards.** They remain supported through the open
  contract, but Central's purpose since [0001](0001-first-party-devices.md) is to use what
  Cajuí devices report, which generic dashboards cannot.
- **Redesign data and interface at once.** Rejected for risk: the interface changes first,
  using the data Central already receives, in small reversible steps.

## Consequences

- The interface changes first: status vocabulary, measurement catalog, overview by place,
  navigation, equipment page and the components reference.
- Measurement profiles with ranges, places as records, history queries and persisted
  events each need a further decision and record before they are built.
- Until ranges exist, only data health and equipment health raise attention. Value
  conditions stay neutral rather than guessed.
