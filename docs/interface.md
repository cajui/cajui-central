# Interface

[Back to Cajuí Central](../README.md)

The menu starts with **Overview**, then two areas: **Equipment** (**Devices**,
**Receivers** and **Sensors**) and **System** (**MQTT broker**). On screens up to 1000 px
wide it sits at the bottom: each area opens a sheet with its pages, and **More** holds
language and theme. Without JavaScript, the server-rendered menu links every page. Setup and display
are independent: a dashboard item references a registration, not a copy of its name
or measurements. No frontend build or additional service is needed.

1. Open **Equipment → Devices → Add device**. Pair a transmitter by radio or choose an observed
   device, name it, and optionally assign a location.
2. Its sensors appear on **Sensors** and the overview by themselves, named after what
   they measure (for example "Temperature and humidity"); **Edit** renames one.
3. Open **Overview → Organize overview**. Create named sections, select devices,
   complete sensors or individual measurements, and move sections/items up or down.
   Save to persist the arrangement, or cancel to discard the draft.

The automatic arrangement is an overview. It starts with what needs attention, most
severe first, each with its reason and, when known, since when: a receiver problem, a
device that stopped reporting, a failed or late reading, or a battery below the
[cajui-firmware](https://github.com/cajui/cajui-firmware) power-mode limits (low under
3.4 V, critical under 3.2 V; both provisional). Below it, each added device is one
block, standing in for its place, with a row per measurement: value, unit and a trend
of the last 3 hours on a time axis shared by every row. Values themselves raise nothing
until measurement ranges exist.
An explicitly empty arrangement remains empty. Removing a dashboard item or section
never deletes its registration or history. Names and locations can be edited; their
stable identities remain unchanged. There is no registration deletion or telemetry
purge in this UI. Dashboard preferences are shared by this local Central instance,
not per browser. The editor supports up to 20 sections, 50 items per section and 200
items total; a repeated item is allowed in different sections but not twice within one.

**Available** means observed in received telemetry, not physically scanned or paired.
The protocol does not necessarily announce a component model. Registering an item
neither pairs radios nor changes broker permissions. A temperature/humidity sensor
has one registration and two measurements. Source, transport and device identity
scope every sensor, so repeated IDs from different producers remain separate.

SQLite schema version 3 adds durable observed devices, sensors, last measurements,
registration settings and layout preferences. Migration backfills existing history
transactionally, without guessing names or changing original readings. Observations
and new telemetry commit together; duplicate retries never refresh inventory times.
Known sensors remain listed when absent from the most recent 100 samples/readings.
Schema version 6 adds `workspace_devices.archived`: an archived device and its sensors
leave the catalog, their telemetry stays, and the next observation brings them back.
Schema version 7 adds removal flags for sensors and receiver states. Removing an item
keeps its history and names. Fresh telemetry restores a sensor; a fresh, non-retained
state restores a receiver. Removal does not revoke radio or MQTT credentials.
An older binary refuses a database migrated to a newer schema.
Back up before upgrading; an older binary cannot open a version 3 database. To roll
back, restore a pre-upgrade backup together with the older binary.

The product shows actual received data only. It has no brand pages, component
catalog, simulated gallery or design-system navigation. The reference lives in
[`docs/brand/`](brand/README.md) and is served separately for development.

On the overview a reading is a compact row; organized sections use larger tiles with
identifiable icons and quantity accents. Sensor failures and device silence remain
explicit, independent states; an accent does not imply a healthy range. Select a reading to open its history in a modal dialog. Its measurement selector is
limited to that sensor on that device. Battery, RSSI and SNR histories are available
from device details in a separate diagnostic scope. Closing the history restores focus
to its originating card; live updates preserve the open dialog. The latest reading and timestamp
remain separate from the historical selection. Pointer, touch and keyboard inspection share
a visible point marker. The marker follows new readings until a click, touch or keyboard
action pins an observation; hovering only previews it. Reopening the dialog or changing
measurements starts a fresh inspection. The latest reading includes its channel state.
Gaps remain disconnected, and the dialog identifies simplified charts explicitly.
History uses Central receipt
timestamps, converted to the browser time zone, with newest readings first; it does
not infer acquisition times for queued samples. Table expansion and slider or summary focus survive
live refreshes. In an organized dashboard, search matches devices and
sensors by their registered names and locations. Export includes the visible sensor
measurements, deduplicated when a measurement appears in multiple sections. The
summary gives the number of problems by severity, or says all is clear with the number
of registered devices.

A device block on the overview, or a device card in an organized dashboard, shows its
identity and last arrival with one **Details** action. The devices page judges each health value where it is
shown: a late last report and a low battery are marked as attention, a battery where the
device stops transmitting as critical, and a receiver without connection as network.
Signal has no agreed limits and stays neutral. Radio diagnostics and links to their histories live in that dialog. The
version 1 convention recognized here is `sensor_id: "radio"` with `rssi` in `dBm`
or `snr` in `dB`. These exact channels are excluded from environmental sensor counts
and the sensor CSV. Their values, data quality and histories remain available.
Other names and units are not silently reclassified. No transport or firmware
contract is changed by this presentation rule.

A reading error, a skipped sample, a stale value and an absent measurement remain
distinct. Zero remains a valid number. HTTP readings have no declared reporting
interval, so their status is **Recorded**, without a freshness guarantee. A device
reporting successfully does not mean its measurements are within a healthy range.

## History

History queries stored measurements independently of the overview snapshot. Choose
1 hour, 6 hours, 24 hours, 7 days, 30 days, or a custom interval of up to 366 days.
Custom dates use the browser's time zone; timestamps represent **arrival at Central**,
not acquisition at the device. There is no automatic age-based deletion: older data
remains available through custom intervals while the database volume is preserved.

The chart returns all observations up to 600. Larger series are reduced into at most 120
time buckets aligned to absolute time, retaining actual first, last, minimum, maximum and an invalid reading
per bucket (at most 600 points). Values are never averaged or interpolated. Buckets
containing errors or gaps beyond three expected intervals are drawn conservatively
as disconnected points, so compression cannot hide an outage with a continuous line.
The interface explicitly labels simplified charts. The table always contains original
readings, including errors and skipped measurements, newest first in pages of 100.
The axis covers the requested period, including silence at its edges. Closed custom
periods do not poll; submit the date form again to refresh them. An inspected original
point remains available within the range even if simplification omits it later; moving
outside the range is reported explicitly. Sensor errors and skipped measurements are
distinguished from an empty period.
An open table keeps its snapshot and position during live chart updates; reopen the
history or reapply the period to start a new table snapshot. The overview CSV export
continues to export recent loaded readings only.

`GET /ui-api/history` requires the local page capability in `X-Cajui-Workspace` and
a loopback host, just like the other private UI endpoints. Parameters are `sensor`
(the workspace sensor ID), `metric`, `unit`, and RFC3339 `from`/`to` boundaries
(inclusive/exclusive, millisecond resolution). Sources and transports have distinct
sensor IDs. The response contains `points`, `rows`, the original `count`, `sampled`,
an `anchor` and a `next` cursor. In `view=rows`, `count` and `sampled` are null: chart
statistics are not recalculated for pagination. For table pages, repeat the same channel and dates
with `view=rows`, `anchor`, and optionally `before=next`. Ordering uses receipt time
and a unique row ID, and the anchor excludes later inserts, including late arrivals.
Unknown channels return an empty series. At most two history requests run concurrently;
file databases use a separate read-only connection pool so history does not occupy the
ingestion connection. In-memory test stores share their original connection. Each request
has a five-second database deadline. A timeout asks the user to narrow the period
rather than silently returning an incomplete chart.

Schema version 9 adds source references, uniqueness and status/value constraints to the
indexed history projection. Schema 8 projections are rebuilt transactionally from original
telemetry with IDs above the previous maximum; reopen history after upgrading because
old pagination anchors no longer select those records. Earlier schemas backfill directly.
Migration backfills
existing HTTP and MQTT data transactionally; future projection inserts share the
original ingestion transaction, including deduplication. Original payloads and
inventory remain intact. The projection consumes additional disk space; back up the
database before upgrading, and restore that backup if rolling back to a binary that
only supports an earlier schema. Large histories may make the first startup take longer.
See [ADR 0003](adr/0003-persisted-measurement-history.md) for the storage, isolation
and chart decisions.

The dashboard refreshes every 30 seconds while visible and not being interacted
with. Inventory pages have an explicit Refresh button. A failed dashboard refresh
retains the previous snapshot with a warning. Edits use revision checks: a stale
window cannot silently overwrite a newer name or layout. A failed save keeps the
draft visible. Without JavaScript, read-only receipt tables remain.

The interface is embedded in the same executable and container image: local
JavaScript modules, CSS, SVG icons and the licensed Manrope font. There is no frontend
compilation, runtime CDN or additional installation step. Theme preference stays in
browser storage without credentials or telemetry. Outdoor legibility still needs
evaluation on the intended tablet under actual lighting conditions.

## Languages

The UI supports **Brazilian Portuguese (`pt-BR`)** and **US English (`en-US`)**,
including registration, chart controls, reading states, dates and numbers. Select a
language in the header; the choice is remembered in a browser preference cookie.
Without a saved preference, Central follows the browser language, falling back to
English. Names you assign to devices, sensors and dashboard sections stay unchanged.

Translations are authored in Rails-like YAML catalogs and embedded as committed
assets. There is no additional installation or frontend build requirement.
See [localization](localization.md) for preference rules, catalog conventions,
development checks and the stable API/CSV boundary.

## Brand and component documentation

See [`docs/brand/README.md`](brand/README.md) for identity, component examples,
research and the standalone reference server (`python3 scripts/serve_brand.py`).
The server binds to `127.0.0.1:8092` and serves an allowlist of reference files and
shared UI assets. Python is optional for documentation development, not Central.
Reference files and examples are outside the Go embed and container build inputs.
The former `/design/*` routes and reference modules return 404 in Central.

The reference reuses the product's tokens, font, icons and native components from
`internal/httpapi/ui/`. `cj-reading` is a measurement inside a sensor group;
`cj-sensor` is a standalone card used in the reference gallery. Other shared pieces
include `cj-badge`, `cj-chart`, `cj-device`, `cj-battery`, `cj-signal`, `cj-state`
and `cj-level`. Binary/level examples do not introduce actuator APIs or new telemetry
schemas. Font license: `internal/httpapi/ui/assets/fonts/OFL-Manrope.txt`.

## Script policy and access

The CSP permits scripts, styles, fonts, images and fetch requests from the same origin
only. Inline executable scripts, `eval`, external resources, frames and form submission
remain blocked. The initial data snapshot is JSON escaped by Go's HTML template;
telemetry text is escaped by the components. API tokens are never embedded in HTML,
JavaScript or browser storage. Refresh reads the same public loopback-only document,
without exposing the ingestion credential. Existing authenticated APIs are unchanged.

Local edits use `PUT /ui-api/devices/{id}`, `/ui-api/sensors/{id}` and
`/ui-api/dashboard/layout`; `POST /ui-api/devices/{id}/archive` with `{"revision":n}`
removes a device and its sensors from the pages (offered for revoked transmitters) while
its telemetry stays stored, and its next observation brings it back with its name. These are browser-workspace endpoints, not ingestion APIs.
They require an allowed loopback Host, an exactly matching Origin, a process-scoped
`X-Cajui-Workspace` capability from the local page, JSON content type and bounded
payloads. Cross-site fetch metadata is rejected. Names and optional locations are
limited to 80 characters; edits require the current revision. Browser capabilities
expire on server restart and are never stored in browser storage. Reload to recover.
These controls prevent cross-site edits and reject rebinding hosts; they are **not
user authentication**. Anyone with access to the local service can configure the
workspace. The application must remain on loopback.

## Frontend development checks

Development tests use Node 22 and Python 3 for the reference server; neither is a runtime dependency. With an isolated Central
instance running on `127.0.0.1:8091` (or `CAJUI_UI_TEST_URL`):

```sh
npm ci --prefix tests/ui --ignore-scripts
npm --prefix tests/ui run format:check
npm --prefix tests/ui run test:model
python3 -m unittest discover -s tests -p test_brand_server.py -v
(cd tests/ui && npx playwright install chromium)
CAJUI_UI_API_TOKEN_FILE=/path/to/isolated-test-token npm --prefix tests/ui test
```

The registration test writes simulated data and preferences to that isolated instance;
never point it at a real workspace. CI uses `/tmp/cajui-ui-token` by default.

Playwright starts the separate reference server automatically. It tests persistent
registration, stale-edit conflicts, section ordering/removal, product grouping,
reference isolation, desktop/tablet/mobile interactions, filtering, inspection, export, unavailable
refresh, safe text handling, language selection and localized registration/charts, plus
accessibility checks in both themes. The automatic
accessibility audit covers selected WCAG A/AA rules, not a complete conformance review.
The Go suite checks asset routing, CSP, escaped snapshot data and API compatibility.
These tests run in CI. Prettier is a development formatter, not a compilation step.

Devices and sensors offer **Remove from list** in their **Edit** dialog; receivers offer it on
their cards. Transmitter revocation is shown for MQTT devices only and requires an online
receiver advertising that capability. Receiver and sensor removal preserves history.
`POST /ui-api/sensors/{id}/archive` takes `{"revision":n}`;
`POST /ui-api/receivers/{source}/{device}/archive` takes the displayed `received_at`
timestamp. Both require the same local origin and UI capability as workspace edits.
Stale revisions or receiver timestamps return 409. Archiving a receiver hides only
that source/device pair. An older, unarchived origin for the same device may become
visible, keeping its original timestamp, availability and retained status.

## Receiver setup and MQTT diagnostics

**Equipment → Receivers → Add receiver** guides the first connection in three steps:
connect to the receiver and save Wi-Fi, transfer MQTT connection details, then find
and confirm the receiver. Known values are selectable text with copy actions; the
password is retrieved only when Show password is selected. An optional address editor
changes only the values shown by the assistant, not server configuration. Missing
addresses require entry before discovery. Back navigation preserves the details and
hides the password again. Configure
Wi-Fi on the receiver first, then enter the broker's LAN address, port and producer
credentials. The wizard lists receivers that become online after it opens, excluding those already
online at the start and retained snapshots. Confirm the receiver that appears, or
choose yours if several connect. No identifier needs to be typed. It does not enroll transmitters or configure
Wi-Fi remotely. Its two-second search polls `GET /ui-api/receiver-states`, a local
UI-capability-protected endpoint that reads only device states and returns
`generated_at` and receiver-only `device_states`, without loading telemetry or HTML.

The bundled broker creates a dedicated `receiver-1` producer account. Compose lets
Central read only that producer's password file, in addition to its own credentials.
The wizard retrieves the receiver password only after an explicit local action;
it is absent from page snapshots, diagnostics and browser storage. Multiple receivers
can share this account initially; this does not provide per-receiver credential revocation.
For an external broker, create a producer account with the appropriate topic ACLs.
Never give receivers Central's account. Username validation also applies when no
password file is configured. Passwords must contain 1–64 printable non-space ASCII
bytes, matching the receiver firmware. Credential read failures return a generic
503; server logs identify the failure category without recording passwords or paths.

Optional server settings:

| Variable | Purpose |
| --- | --- |
| `CAJUI_RECEIVER_USERNAME` | Dedicated producer username shown in setup |
| `CAJUI_RECEIVER_PASSWORD_FILE` | Operator-configured producer password file |
| `CAJUI_RECEIVER_HOST` | Explicit broker address reachable from receivers; if unset, setup requires manual entry |
| `CAJUI_RECEIVER_PORT` | Externally reachable broker port |

Central does not infer the receiver address from its own broker connection URL:
an address reachable inside a container may not resolve on the receiver's network.

**System → MQTT broker** shows connection status, subscriptions and read-only
connection settings. It keeps the last 100 inbound observations in memory, newest
first, with filters, pause and normalized JSON for accepted messages. Only topics
subscribed to by Central are visible. Invalid payloads are omitted. Counters and
this diagnostic buffer reset on restart; stored measurements remain intact. The
buffer uses a fixed-size ring and reuses validated values from ingestion, avoiding
a second payload decode.
This is a diagnostic view, not a broker administration console or durable audit log.
Broker settings still come from environment variables and secret files.

MQTT diagnostics use a compact table with local receipt time (including seconds),
device, message type and result. Expand a row for the full timestamp/time zone,
identifiers, topic, size and normalized JSON. Expanded rows stay open during refresh
and filtering while the message remains in the buffer. Unchanged rows keep their
DOM nodes during polling, preserving text selection when new messages arrive. Narrow screens move type and
result into the details.


## Live connection status

The receiver list and dashboard subscribe to `GET /ui-api/device-states/events`
using SSE over streaming fetch. SQLite state/availability commits and receiver
archival invalidate the current snapshot; idle streams send only a 15-second
heartbeat. Events carry current device states, not telemetry history or credentials.
The stream itself does not poll the database; the existing thirty-second page
refresh remains for other page data.

Both this endpoint and the recovery `GET /ui-api/device-states` require a local host
and the page capability in the `X-Cajui-Workspace` header. No token is placed in the
URL. Up to 16 streams are allowed, writes have a five-second timeout, and slow
subscribers coalesce changes rather than building an unbounded event queue.

Hidden pages pause streaming; visible pages reconnect with a fresh snapshot.
If streaming fails, the client fetches a lightweight state snapshot and retries
after two seconds. A stalled connection times out after 35 seconds. Server restarts
refresh the local capability from the page without reloading the browser. Regular
telemetry refresh remains separate. Live UI updates do not shorten MQTT's keepalive
interval or the broker's time to detect a receiver that loses power abruptly.
