# Cajuí Central

Local server for sensor readings: an HTTP API and MQTT consumer receive them, SQLite stores them and
an embedded web page shows the latest ones. It is designed for devices running
[cajui-firmware](https://github.com/cajui/cajui-firmware), whose device state it also shows
([ADR 0001](docs/adr/0001-first-party-devices.md)); the telemetry contract stays open to
other producers. Early stage: no actuator control yet.

## Running

### Docker

Requires Docker with Compose v2. Download [`compose.yaml`](compose.yaml), or use this
checkout, and run:

```sh
docker compose up -d
```

This starts Central and its MQTT broker from published images
(`ghcr.io/cajui/cajui-central`, `ghcr.io/cajui/cajui-broker`, amd64 and arm64). Open
http://127.0.0.1:8080. On first start the broker generates every credential (API token,
Central, Home Assistant and demo accounts) into the `secrets` volume; nothing needs to be
typed or installed on the host. Both services restart with Docker.

```sh
docker compose run --rm credentials token            # API token
docker compose run --rm credentials producer NAME    # credential for a device
docker compose run --rm credentials homeassistant    # read-only account password
docker compose run --rm demo                         # publish the simulated sample
```

Data lives in named volumes and survives restarts and image updates
(`docker compose pull && docker compose up -d`). `docker compose down -v` deletes the
database and every credential. The dashboard is published on `127.0.0.1` only because it
has no login; never publish it on another interface. The broker listens on port 1883 of
every interface so devices on the network can publish; see
[Producers on the local network](#producers-on-the-local-network).

### Go

Requires Go 1.27+ and Make. `go test -race` also needs a C toolchain.

```sh
export CAJUI_API_TOKEN="$(openssl rand -hex 32)"
make run
```

Open http://127.0.0.1:8080. The database is created at `data/cajui.db`.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `CAJUI_API_TOKEN` | required | At least 24 characters; use a random secret. Compose generates it. |
| `CAJUI_ADDR` | `127.0.0.1:8080` | Loopback IPs only. |
| `CAJUI_DB` | `data/cajui.db` | SQLite file path. |
| `CAJUI_ALLOW_NON_LOOPBACK` | unset | `1` inside containers only; see [SECURITY.md](SECURITY.md). |

Compose also reads these optional values from a `.env` file (see `.env.example`):
`CAJUI_PORT` (dashboard, default 8080, always on `127.0.0.1`), `CAJUI_MQTT_PORT`
(default 1883), `CAJUI_MQTT_BIND` (default all interfaces; `127.0.0.1` keeps the broker
local) and `CAJUI_VERSION` (image tag, default `main`).

### Sending a test reading

In another terminal, export the same token (with Docker, `docker compose run --rm credentials token`) and run:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

The dashboard refreshes automatically or with Refresh. The request is idempotent: repeating it does not duplicate the
reading; change `sequence` to add a sample. Data persists across restarts.

## Development

```sh
make check          # gofmt, go vet, tests with -race, coverage >= 80%
make build          # bin/cajui
make docker-check   # make check inside the golang:1.27 image
make docker-build   # cajui:local image
docker compose -f compose.yaml -f compose.dev.yaml up --build -d   # build both images
go tool cover -html=coverage.out   # coverage report, after make check
```

- `cmd/cajui`: startup and shutdown.
- `internal/telemetry`: reading contract and validation.
- `internal/storage`: SQLite and schema migrations.
- `internal/httpapi`: HTTP API and embedded web page.
- `internal/config`: environment configuration.
- `internal/mqttingest`: MQTT subscription and reconnect lifecycle.
- `Dockerfile`, `mosquitto/`, `compose.yaml`: Central image, broker image and stack.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## API

All `/api` routes require `Authorization: Bearer <CAJUI_API_TOKEN>`.

- `GET /healthz`: 200 when the database is reachable, 503 otherwise.
- `GET /`, `/devices`, `/receivers`, `/sensors`: local workspace pages (no login, loopback hosts only).
- `GET /api/v1/readings`: JSON list, most recently received first.
- `GET /api/v1/device-states`: latest [device state](#device-state) per device.
- `POST /ui-api/commands`, `GET /ui-api/commands/{id}`: [device commands](#device-commands)
  from the local page (same origin and page capability, like workspace edits).
- `POST /api/v1/readings`: one JSON object, `Content-Type: application/json`.

Fields: `node_id`, `sensor_id`, `session_id` and `metric` are 1–64 characters
(alphanumeric, `.`, `-`, `_`, `:`; first character alphanumeric). `sequence` is an
integer >= 0. `value` is a required finite number (zero is valid). `unit` is 1–32
bytes. `measured_at` is optional RFC 3339 with offset. `received_at` is set by the
server in UTC. Extra fields, concatenated objects and payloads above 8 KiB are rejected.

Identity is `node_id + sensor_id + session_id + sequence + metric`; a node restart
must change `session_id`, not its identity. Responses: 201 created; 200 identical
retry; 400 invalid payload; 401 bad token; 409 same identity with different content;
415 wrong content type; 500 storage failure. Each metric is its own reading: there is
no multi-metric transaction and no end-to-end delivery guarantee.

## Roadmap

Next: TLS for producers on the local network. Not yet implemented: alerts beyond
silence detection, automations, user authentication or remote device provisioning.

## License

[Apache-2.0](LICENSE).

## MQTT

The Compose stack runs Mosquitto with authentication and per-user ACLs. Central and the
`homeassistant` account can only read samples and device state; the `demo-source` account
can only write under its own namespaces; each producer can only write under its own
namespaces.
Never share an unrestricted broker account across devices. `docker compose run --rm demo`
publishes the simulated [`sample.json`](examples/mqtt/sample.json); repeating it is
deduplicated. Do not put real credentials or measurements in example files.

Credentials are stored unencrypted in the `secrets` volume, readable only by containers
that mount it and by users who control Docker. Central receives only its API token and
broker password. The broker regenerates its password file and ACL on start and within a
few seconds after a producer credential changes, without dropping other clients.

### Wire contract, version 1

Topic: `telemetry/v1/<source_id>/<device_id>/samples`. Payload:
[`sample.json`](examples/mqtt/sample.json). Publish with QoS 1 and **retain=false**.
Central subscribes to `telemetry/v1/+/+/samples` with QoS 1.

| Field | Meaning |
| --- | --- |
| `version` | Integer `1`. |
| `source_id` | Producer identity, also scoped by broker ACL. |
| `device_id` | Device identity within the source. |
| `sample_id` | Opaque string, stable across retries, unique per acquisition within source/device. A persistent generation plus counter is suitable. |
| `expected_interval_seconds` | Integer 1–604800, expected acquisition interval. |
| `measured_at` | Optional RFC 3339 timestamp; omit when measurement time is unknown. |
| `readings` | 1–64 measurements, each with `sensor_id`, `metric`, `unit`, `status` and optional `value`. |

All identities and metric names use 1–64 ASCII characters matching
`[a-zA-Z0-9][a-zA-Z0-9._:-]*`. Topic identities must match the payload. Units are
1–32 UTF-8 bytes. A sensor/metric pair appears at most once per sample.
`status` is `ok`, `error`, or `skipped`: `ok` requires a finite numeric value
(including zero); other statuses require an absent or null value. Sample size is
limited to 16 KiB. Unknown fields, duplicate/case-variant JSON keys, malformed JSON,
unsupported versions, and conflicting identity reuse are rejected.

Central commits a complete sample atomically. The unique key is
`(source_id, device_id, sample_id)`. Measurement order and timestamp offset do not
affect deduplication. Changed content under an existing identity is a conflict.
Server-assigned `received_at` is stored separately and is never supplied by the
producer. The existing HTTP readings contract and records are preserved by schema
migration; back up the database before upgrades (schema downgrade is unsupported).

### Delivery and silence alerts

The broker's PUBACK is the publisher's delivery boundary. **Central sends no
application receipt** and has no publish permission. PUBACK does not guarantee
that Central or Home Assistant stored or processed the sample, nor broker disk
fsync. QoS 1 permits duplicates. MQTT 3.1.1 can also acknowledge an ACL-denied
publication without an error reason; producer provisioning must verify topic
permissions. MQTT 5 publishers can inspect negative PUBACK reason codes. The
consumer uses MQTT 3.1.1 and works alongside MQTT 5 clients on Mosquitto.

Central keeps a persistent MQTT session (clean session off, fixed client ID). While it
is stopped or reconnecting, including across broker restarts, the broker keeps its
subscription and queues samples for it, then delivers them on reconnection. Each sample
is acknowledged to the broker only after it is stored, or permanently rejected, so the
broker never sends more than its in-flight window and an acknowledged sample is never
dropped; a sample interrupted by shutdown or a storage failure is redelivered after the
next reconnect. The broker keeps at most 1000 queued messages per client and discards
the session of a client absent for seven days; beyond those limits samples are lost.
Queued samples keep their identity, so redeliveries are deduplicated, but their
`received_at` is the delivery time. Only one Central may use a given client ID. The
broker's retained snapshot, sent on every new subscription, is ignored so that an old
sample does not appear newly received; a sample published while Central was away is a
new arrival even if the publisher set retain.

A known device becomes stale after three expected intervals without a **new unique
sample**. Duplicate retries do not refresh that deadline. Error readings still count
as communication and have a separate error indicator. This is an arrival-based
alert, not proof of radio connectivity or a guarantee that a backfilled measurement
is current. Unknown devices cannot be reported as missing. The dashboard refreshes automatically while visible and idle, or with its Refresh button. `/healthz` checks the database, not MQTT connectivity; connection
and subscription progress are logged.

Authenticated `GET /api/v1/samples` returns the latest 100 sample envelopes with
`received_at`; `GET /api/v1/devices` returns up to 100 most recently observed devices,
with `last_received_at`, `expected_interval_seconds`, `stale`, and `sensor_error`.
The workspace scopes MQTT and HTTP identities separately and lets users place their
registered sensors together on a dashboard.

### Device state

Central also subscribes to the retained `manage/v1/+/+/state` and
`manage/v1/+/+/availability` topics of the
[cajui-firmware management channel](https://github.com/cajui/cajui-firmware/blob/main/docs/management-v1.md):
receiver firmware, uptime, Wi-Fi signal, queue (including samples dropped when full), forwarding counts, last restart and pairing
window, and each transmitter's pairing and last radio frame. It keeps only the latest state
and availability per device, validates known fields, ignores unknown ones and keeps absent
values unknown. The broker repeats retained messages on every subscription: an identical
snapshot keeps its original receipt time, and a changed one is marked as of unknown age
until a live message replaces it. An empty message on either topic, which clears a
retained topic, removes that state or availability. A device seen under several sources
has moved; only its most recent state is listed. State is not telemetry and never enters
sample history.
Central has no write access to these topics. The receivers page shows each receiver's
state; the dashboard lists a receiver only when it needs attention: offline, with readings
waiting in its queue, or having given up readings because the queue was full.

The generated ACL lets each producer write `manage/v1/<source_id>/+/availability`,
`.../state` and `.../results` and read `.../commands`; Central and `homeassistant` read
state and availability; Central also writes `manage/v1/+/+/commands` and reads
`.../results`. On another broker, grant the same topics before updating receivers.

### Device commands

Commands live on the devices page; the dashboard only monitors. When a receiver's state
lists the `pairing` capability, the Add device dialog offers Search for transmitters: it
opens the receiver's two-minute pairing window, lists the transmitters asking to join
with their signal, adds one on request and then offers it for naming once its first
reading arrives. With `revoke`, a transmitter's edit dialog offers a confirmed Revoke. Central checks the command against the
advertised capabilities, records it, publishes it with QoS 1 and never retained, and
follows the receiver's answer on `manage/v1/+/+/results`. An answer that does not arrive
within 30 seconds is reported as not delivered. The broker's authentication and ACL are
the whole authorization of a command, so only Central's account may write commands.
Every action remains available on the receiver's own setup page.

### Connecting an existing broker

| Variable | Purpose |
| --- | --- |
| `CAJUI_MQTT_URL` | Optional; `ssl://host:8883` uses system CA trust and TLS 1.2 or newer. `tcp://host:1883` requires explicit plaintext opt-in. No URL credentials. |
| `CAJUI_MQTT_USERNAME` | Required when MQTT is enabled. |
| `CAJUI_MQTT_PASSWORD_FILE` | File containing the password; preferred over `CAJUI_MQTT_PASSWORD`. Mutually exclusive. |
| `CAJUI_MQTT_CLIENT_ID` | Default `cajui-central`. Names the persistent session: keep it stable, and give each running instance its own. |
| `CAJUI_MQTT_ALLOW_PLAINTEXT` | Set `1` only for trusted local development. |
| `CAJUI_API_TOKEN_FILE` | File alternative to `CAJUI_API_TOKEN`; mutually exclusive. |

### Producers on the local network

Each device or gateway that publishes samples gets its own broker user. The user name
is its `source_id`, and the generated ACL lets it write only under
`telemetry/v1/<source_id>/`. Names use 1–64 characters from `[A-Za-z0-9._-]`, starting
with a letter or digit.

```sh
docker compose run --rm credentials producer receiver-1   # prints the password
docker compose run --rm credentials remove receiver-1     # revokes it
printf '%s\n' "$PASSWORD" | docker compose run --rm -T credentials import receiver-1
```

The device connects to this computer's network address on port 1883. `import` keeps an
existing device password when moving to a new installation.

To let devices find the broker without typing its address, announce it on the local
network while the stack runs:

```sh
sh scripts/advertise_broker.sh   # dns-sd on macOS, avahi-publish-service on Linux
```

It publishes an `_mqtt._tcp` service on `CAJUI_MQTT_PORT` and runs until interrupted.
It runs on the host because Docker Desktop does not forward multicast from containers.
Announcing only advertises the address: producers still need their own credential.

This listener is plain MQTT: credentials and samples cross the network unencrypted.
Use it only on a trusted network until TLS is configured. Because MQTT 3.1.1 acknowledges
ACL-denied publications, a producer publishing with a mismatched `source_id` gets
PUBACK while the broker drops the sample; the integration test checks the ACL with MQTT 5.

### Home Assistant, without Central

Receivers running cajui-firmware announce themselves and their transmitters through
[MQTT Discovery](https://github.com/cajui/cajui-firmware/blob/main/docs/home-assistant.md):
configure the Home Assistant MQTT integration with the `homeassistant` account and the
entities appear. The generated ACL lets each producer write
`homeassistant/sensor/<source_id>/+/config` and the `homeassistant` account read
`homeassistant/#`. The manual configuration below is for producers without Discovery.

Use the same broker and its read-only `homeassistant` account. Configure the
[MQTT integration](https://www.home-assistant.io/integrations/mqtt/) in Home Assistant,
then merge [`home-assistant.yaml`](examples/mqtt/home-assistant.yaml) into its
configuration and restart it. If it already has an `mqtt:` section, merge the sensor
entries instead of adding a second section. Adjust identities, metrics, units and
expiration to your devices. The example defines temperature and humidity, extracts
values by sensor/metric rather than array position, and marks error/skipped readings
unavailable. It uses the standard [MQTT Sensor configuration](https://www.home-assistant.io/integrations/sensor.mqtt/).

This example is manual configuration, not automatic discovery. Home Assistant subscribes
directly; Central can be stopped or absent. `expire_after` is configured explicitly
(900 seconds for the example's 300-second interval). Unlike Central's sample
identity deduplication, Home Assistant's example evaluates each message, so retries
may refresh its expiry. Do not retain measurement messages. Home Assistant must be
able to reach the broker on port 1883 of this computer; get the account password with
`docker compose run --rm credentials homeassistant`. The listener is plain MQTT, so keep
it on a trusted network.

### MQTT verification

```sh
sh scripts/test_mqtt.sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

The integration script builds the broker image and starts it in an isolated project,
removing only its own containers and volumes on exit. It tests publishing,
deduplication, invalid input, connection loss/resubscription, subscriber restart,
retained snapshot rejection, an ACL-denied publication, generated credentials, and
producer credentials created, imported and removed at runtime, including the reload. Unit tests cover persistence/reopen, migration,
silence/recovery, validation, and shutdown while the broker is unavailable.
Python tests evaluate the Home Assistant example templates; they do not run a full
Home Assistant installation. Both suites run in CI. There is no application-level
receipt, auto-discovery, device provisioning wizard, or publisher firmware in this
repository.

## Interface

The menu is organized by task: **Overview**, **Equipment** (with tabs for **Devices**,
**Receivers** and **MQTT broker**) and **Sensors**. On screens up to 1000 px wide it sits
at the bottom, with language and theme under **More**. Without JavaScript, the
server-rendered menu links every page. Setup and display
are independent: a dashboard item references a registration, not a copy of its name
or measurements. No frontend build or additional service is needed.

1. Open **Equipment → Devices → Add device**. Pair a transmitter by radio or choose an observed
   device, name it, and optionally assign a location.
2. Its sensors appear on **Sensors** and the dashboard by themselves, named after what
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
[`docs/brand/`](docs/brand/README.md) and is served separately for development.

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
Gaps remain disconnected, and the dialog identifies the history
as recent loaded readings rather than a complete period. History uses Central receipt
timestamps, converted to the browser time zone, with newest readings first; it does
not infer acquisition times for queued samples. Table expansion and slider or summary focus survive
live refreshes. In an organized dashboard, search matches devices and
sensors by their registered names and locations. Export includes the visible sensor
measurements, deduplicated when a measurement appears in multiple sections. The
summary gives the number of problems by severity, or says all is clear with the number
of registered devices.

A device block on the overview, or a device card in an organized dashboard, shows its
identity and last arrival with one **Details** action. Radio diagnostics and links to their histories live in that dialog. The
version 1 convention recognized here is `sensor_id: "radio"` with `rssi` in `dBm`
or `snr` in `dB`. These exact channels are excluded from environmental sensor counts
and the sensor CSV. Their values, data quality and histories remain available.
Other names and units are not silently reclassified. No transport or firmware
contract is changed by this presentation rule.

A reading error, a skipped sample, a stale value and an absent measurement remain
distinct. Zero remains a valid number. HTTP readings have no declared reporting
interval, so their status is **Recorded**, without a freshness guarantee. A device
reporting successfully does not mean its measurements are within a healthy range.

History uses **arrival timestamps** from the latest loaded records (up to 100 MQTT
samples and 100 HTTP readings, plus each known channel’s last observation), with one
measurement/unit per chart. Period selection
filters that snapshot, not a full historical query. Missing observations and gaps
beyond three expected intervals break the line. Pointer and keyboard inspection and
a data table expose the same values. Unknown diagnostics are never replaced by zero.

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

### Languages

The UI supports **Brazilian Portuguese (`pt-BR`)** and **US English (`en-US`)**,
including registration, chart controls, reading states, dates and numbers. Select a
language in the header; the choice is remembered in a browser preference cookie.
Without a saved preference, Central follows the browser language, falling back to
English. Names you assign to devices, sensors and dashboard sections stay unchanged.

Translations are authored in Rails-like YAML catalogs and embedded as committed
assets. There is no additional installation or frontend build requirement.
See [localization](docs/localization.md) for preference rules, catalog conventions,
development checks and the stable API/CSV boundary.

### Brand and component documentation

See [`docs/brand/README.md`](docs/brand/README.md) for identity, component examples,
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

### Script policy and access

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

### Frontend development checks

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

Devices and sensors offer **Remove from list** next to **Edit**; receivers offer it on
their cards. Transmitter revocation is shown for MQTT devices only and requires an online
receiver advertising that capability. Receiver and sensor removal preserves history.
`POST /ui-api/sensors/{id}/archive` takes `{"revision":n}`;
`POST /ui-api/receivers/{source}/{device}/archive` takes the displayed `received_at`
timestamp. Both require the same local origin and UI capability as workspace edits.
Stale revisions or receiver timestamps return 409. Archiving a receiver hides only
that source/device pair. An older, unarchived origin for the same device may become
visible, keeping its original timestamp, availability and retained status.

### Receiver setup and MQTT diagnostics

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

**Equipment → MQTT broker** shows connection status, subscriptions and read-only
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


### Live connection status

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
