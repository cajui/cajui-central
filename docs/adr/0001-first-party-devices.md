# 0001. Central targets Cajuí devices; the firmware stays open

- Status: Accepted
- Date: 2026-09-26

## Context

Central was built as a hardware-agnostic dashboard: it knows only the identities and
metrics carried by the [telemetry contract](../../README.md#wire-contract-version-1). As
a result it asks users for what the devices already know. Sensors are registered by hand,
units and ranges are generic, a failed reading is reported without a likely cause, and
setting up a receiver means generating a producer credential with
`docker compose run credentials producer NAME` and typing it, with the broker address,
into the receiver's setup page.

The devices that run [cajui-firmware](https://github.com/cajui/cajui-firmware), a receiver
and battery nodes linked over LoRa, expose far more: firmware version, installed sensors,
acquisition interval, radio signal, receiver queue and reset reasons. Protocol version 2
already carries a transmit power command in the receiver's ACK.

## Decision

1. **Central is designed for Cajuí devices only.** Onboarding, device and sensor pages,
   diagnostics, configuration and updates assume cajui-firmware and use everything it
   reports. Supporting arbitrary producers is no longer a design goal of the interface.
2. **The firmware and its protocols stay open and independent of Central.** The telemetry
   contract (`telemetry/v1`) keeps its current compatibility promise, so Home Assistant
   and other MQTT consumers keep working unchanged.
3. **Nothing essential depends on Central.** Every device function remains available
   without it: Wi-Fi, broker and credential through the receiver's setup page, node
   pairing through the device button, administration over USB, and data and management
   over plain MQTT. Central makes these easier; it never makes them possible only
   through itself.
4. **A management channel is added next to telemetry,** implemented by the firmware and
   documented as openly as the telemetry contract. It has three parts:
   - *Device state* (device → consumers, retained): a versioned descriptor (model,
     firmware version, sensors, current parameters) and health (signal, queue, last
     reset reason, battery).
   - *Commands* (Central → device): parameters such as acquisition interval, transmit
     power and name, and actions such as opening pairing, revoking a node or starting a
     receiver update.
   - *Command results* (device → consumers): applied, rejected with a reason, or pending.
5. **Commands to sleeping nodes are relayed by the receiver in the ACK,** following the
   version 2 power command: the receiver stores the command, returns it in the ACK of
   the node's next DATA frame, and the node confirms it in a later frame. The interface
   shows such changes as pending until confirmed and states the expected delay (up to
   one interval to apply, another to confirm). Node commands stay compact codes and
   values; node firmware updates over radio remain out of scope.
6. **Home Assistant Discovery, when added, is published by the receiver,** not by
   Central, so installations without Central get the same automatic setup.

Topic layout, payload schemas, ACL rules and command authentication are specified
before implementation, in the firmware documentation and in this repository's README.

## Alternatives

- **Stay hardware-agnostic.** Keeps any MQTT producer first class, but leaves setup,
  diagnostics and configuration manual; rejected because it caps usability for the
  devices this project builds.
- **Make the firmware Central-specific.** Simplifies the protocol, but locks out Home
  Assistant users and turns Central into a single point of failure; rejected.
- **Central publishes Home Assistant Discovery.** Works only when Central runs,
  contradicting decision 3; rejected.

## Consequences

- Central gains publish permission on the broker, which it deliberately lacks today. The
  management specification must scope it with per-topic ACLs, authenticate commands and
  require explicit confirmation for revoking a node or updating firmware.
- Central and firmware versions become coupled. The descriptor is versioned, Central
  supports at least the previous firmware release, and missing capabilities degrade to
  the current behaviour instead of failing.
- The manual sensor registry shrinks to names and locations; units, formats, valid ranges
  and icons come from a closed catalogue of Cajuí metrics.
- The HTTP readings API (`POST /api/v1/readings`) remains for ingestion; how its
  producers appear in the interface is decided separately.
- The fallback paths (receiver setup page, pairing button, USB administration) must be
  maintained and tested, not left behind as Central takes over. An acceptance check
  installs a receiver and a node from scratch with Home Assistant and Mosquitto, without
  Central, and verifies that readings arrive.
- README drops "Hardware-agnostic" when the first Central-specific feature lands.
