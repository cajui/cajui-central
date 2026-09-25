# Cajuí Central

Local server for sensor readings: an HTTP API and MQTT consumer receive them, SQLite stores them and
an embedded web page shows the latest ones. Hardware-agnostic. Early stage: no
actuator control yet.

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
- `GET /`: dashboard with the latest readings and samples (no authentication, loopback only).
- `GET /api/v1/readings`: JSON list, most recently received first.
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

Next: TLS for producers on the local network. Not yet implemented: device registry,
alerts beyond silence detection, automations, user authentication.

## License

[Apache-2.0](LICENSE).

## MQTT

The Compose stack runs Mosquitto with authentication and per-user ACLs. Central and the
`homeassistant` account can only read samples; the `demo-source` account can only write
under `telemetry/v1/demo-source/`; each producer can only write under its own namespace.
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
The dashboard shows both MQTT samples and the existing HTTP readings separately.

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

Use the same broker and its read-only `homeassistant` account. Configure the
[MQTT integration](https://www.home-assistant.io/integrations/mqtt/) in Home Assistant,
then merge [`home-assistant.yaml`](examples/mqtt/home-assistant.yaml) into its
configuration and restart it. If it already has an `mqtt:` section, merge the sensor
entries instead of adding a second section. Adjust identities, metrics, units and
expiration to your devices. The example defines temperature and humidity, extracts
values by sensor/metric rather than array position, and marks error/skipped readings
unavailable. It uses the standard [MQTT Sensor configuration](https://www.home-assistant.io/integrations/sensor.mqtt/).

This is manual configuration, **not automatic discovery**. Home Assistant subscribes
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

## Interface and design reference

The interface is part of the same executable and container image. No Node.js,
package installation, frontend compilation or CDN is needed to run Central.
JavaScript modules, CSS, original SVG icons and the licensed Manrope font are
embedded locally. The existing installation command stays the same.

| Page | Purpose |
| --- | --- |
| `/` | Actual readings, sensor filters, recent history, device details, silence/error indicators and CSV export. |
| `/design/dashboard` | An explicitly simulated workspace. Nothing is sent to devices or written to the database. |
| `/design/brand` | Working visual identity: symbol, color roles, typography, shape, spacing, downloadable tokens and a computed contrast audit. |
| `/design/components` | Interactive component catalog, display states and integration examples. |
| `/design/research` | References from Home Assistant, ThingsBoard, Grafana and openHAB, with implementation choices and deferred features. |

The working identity is version 0.1. Light and dark themes share semantic tokens;
theme preference is stored locally in the browser, without credentials or telemetry.
The font license is included at `internal/httpapi/ui/assets/fonts/OFL-Manrope.txt`.

### Display components

Native custom elements share `ui/tokens.css` and `ui/ui.css`:
`cj-sensor`, `cj-badge`, `cj-chart`, `cj-device`, `cj-battery`, `cj-signal`,
`cj-state` and `cj-level`. Load `/ui/components.mjs` as a module to register them.
Set simple attributes for static content or assign `element.data` for a sensor or
chart model. The catalog demonstrates the supported attributes and model shape.
These are display components; binary-state examples and level meters do not add
new telemetry contracts or actuator APIs.

A reading error, a skipped sample, a stale value and an absent measurement remain
distinct. Zero remains a valid number. HTTP readings have no declared reporting
interval, so their status is **Recorded**, without an inferred freshness guarantee.
Unknown battery and signal remain unknown. Devices with no recent report and
reported measurement errors are shown independently.

History uses **arrival timestamps** from the latest loaded records, with one
measurement/unit per chart. Period selection filters that bounded snapshot; it
is not a full historical query. Missing observations and gaps greater than three
expected intervals break the line. Pointer and keyboard inspection and a data table
provide the same values. CSV export includes the currently visible sensors and
protects text cells from spreadsheet formula interpretation.

The actual dashboard refreshes every 30 seconds while visible and not being
interacted with; manual refresh is always available. A failed refresh preserves the
previous snapshot and shows a warning. Without JavaScript, the existing read-only
receipt tables remain available. Friendly names and locations in the example are
simulated; a persistent device/area registry is a separate feature.

### Script policy and access

The CSP permits scripts, styles, fonts, images and read requests from the same origin
only. Inline executable scripts, `eval`, external resources, frames and form submission
remain blocked. The initial data snapshot is JSON escaped by Go's HTML template;
telemetry text is escaped by the components. API tokens are never embedded in HTML,
JavaScript or browser storage. Refresh reads the same public loopback-only document,
without opening an unauthenticated API route. Existing authenticated APIs are unchanged.
The dashboard still has **no login** and must remain on loopback.

### Frontend development checks

Development tests use Node 22; it is not a runtime dependency. With an isolated Central
instance running on `127.0.0.1:8091` (or `CAJUI_UI_TEST_URL`):

```sh
npm ci --prefix tests/ui --ignore-scripts
npm --prefix tests/ui run format:check
npm --prefix tests/ui run test:model
(cd tests/ui && npx playwright install chromium)
npm --prefix tests/ui test
```

Playwright tests desktop/mobile interactions, filtering, inspection, export, unavailable
refresh, safe text handling and accessibility checks in both themes. The automatic
accessibility audit covers selected WCAG A/AA rules, not a complete conformance review.
The Go suite checks asset routing, CSP, escaped snapshot data and API compatibility.
These tests run in CI. Prettier is a development formatter, not a compilation step.
