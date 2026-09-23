# Cajuí Central

Local server for sensor readings: an HTTP API and MQTT consumer receive them, SQLite stores them and
an embedded web page shows the latest ones. Hardware-agnostic. Early stage: no
actuator control yet.

## Running

### Docker

Requires Docker with Compose v2.

```sh
cp .env.example .env     # set CAJUI_API_TOKEN, e.g. openssl rand -hex 32
docker compose up --build
```

Open http://127.0.0.1:8080. The database lives in the `cajui-data` volume and
survives restarts and rebuilds; `docker compose down -v` deletes it.
`docker compose up -d` runs the service in the background and restarts it with Docker.

Compose reads `.env`; the binary itself does not. Inside the container the process
listens on `0.0.0.0` (`CAJUI_ALLOW_NON_LOOPBACK=1`), but Compose publishes the port on
the host's `127.0.0.1` only. Never publish it on `0.0.0.0`: there is no login.

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
| `CAJUI_API_TOKEN` | required | At least 24 characters; use a random secret. |
| `CAJUI_ADDR` | `127.0.0.1:8080` | Loopback IPs only. |
| `CAJUI_DB` | `data/cajui.db` | SQLite file path. |
| `CAJUI_ALLOW_NON_LOOPBACK` | unset | `1` inside containers only; see [SECURITY.md](SECURITY.md). |
| `CAJUI_PORT` | `8080` | Compose only: host port, bound on `127.0.0.1`. |

### Sending a test reading

In another terminal, export the same token (with Docker, the value in `.env`) and run:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

Refresh the page. The request is idempotent: repeating it does not duplicate the
reading; change `sequence` to add a sample. Data persists across restarts.

## Development

```sh
make check          # gofmt, go vet, tests with -race, coverage >= 80%
make build          # bin/cajui
make docker-check   # make check inside the golang:1.27 image
make docker-build   # cajui:local image
go tool cover -html=coverage.out   # coverage report, after make check
```

- `cmd/cajui`: startup and shutdown.
- `internal/telemetry`: reading contract and validation.
- `internal/storage`: SQLite and schema migrations.
- `internal/httpapi`: HTTP API and embedded web page.
- `internal/config`: environment configuration.
- `internal/mqttingest`: MQTT subscription and reconnect lifecycle.
- `Dockerfile`, `compose.yaml`: container image and local stack.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## API

All `/api` routes require `Authorization: Bearer <CAJUI_API_TOKEN>`.

- `GET /healthz`: 200 when the database is reachable, 503 otherwise.
- `GET /`: web page with the last 100 readings (no authentication, loopback only).
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

Next: MQTT ingestion with real readings and failure/communication states. Not yet
implemented: device registry, alerts, automations, user authentication.

## License

[Apache-2.0](LICENSE).

## MQTT development stack

MQTT is optional. The original HTTP-only Compose stack remains available.
To run Central with an authenticated local Mosquitto broker:

```sh
python3 scripts/init_mqtt.py
docker compose -f compose.mqtt.yaml up --build -d
docker compose -f compose.mqtt.yaml run --rm publish
```

Open http://127.0.0.1:8080 and refresh to see the **demonstration** sample.
Repeating the publisher sends the same identity and is deduplicated. Change
`sample_id` in a copy of `examples/mqtt/sample.json` for each new acquisition.
The `publish` service mounts that directory read-only and accepts `mosquitto_pub`
arguments. Do not publish real credentials or measurements in example files.

The initializer preserves existing passwords. Secrets live in the ignored
`.local-mqtt` directory (host mode 0700); individual files are readable by container
users through read-only mounts. This is local file protection, not encryption.
It creates separate credentials for `central`, `homeassistant`, and `demo-source`:
Central and Home Assistant can read samples; the demonstration publisher can only
write under `telemetry/v1/demo-source/`. Adapt the ACL and credentials for each
additional producer. Never share an unrestricted broker account across devices.

This stack uses plain MQTT **for local development only**: ports 1883 and 8080
are published on loopback. Other containers on its Docker network can reach the
broker but still need credentials. Configure TLS before using an untrusted network.
Do not expose the dashboard to the LAN: it has no login. Change `CAJUI_PORT` or
`CAJUI_MQTT_PORT` if another service already uses those ports.

SQLite and broker data use named volumes. `docker compose -f compose.mqtt.yaml down`
preserves them; adding `-v` deletes them. The MQTT stack uses a separate database
volume from the HTTP-only example. It is a development setup, not an installer.

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

Central uses a clean MQTT session: samples published while it is disconnected
may be lost. Its bounded 128-message ingestion queue may drop samples under overload;
storage failures are logged without exposing payloads or credentials. Retained
snapshots are ignored so a reconnect does not make old data appear newly received.
Broker persistence alone does not give this clean-session consumer an offline backlog.

A known device becomes stale after three expected intervals without a **new unique
sample**. Duplicate retries do not refresh that deadline. Error readings still count
as communication and have a separate error indicator. This is an arrival-based
alert, not proof of radio connectivity or a guarantee that a backfilled measurement
is current. Unknown devices cannot be reported as missing. The page must be refreshed
to update alerts. `/healthz` checks the database, not MQTT connectivity; connection
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
| `CAJUI_MQTT_CLIENT_ID` | Default `cajui-central`; use a distinct stable ID for each running instance. |
| `CAJUI_MQTT_ALLOW_PLAINTEXT` | Set `1` only for trusted local development. |
| `CAJUI_API_TOKEN_FILE` | File alternative to `CAJUI_API_TOKEN`; mutually exclusive. |

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
able to reach the broker: this loopback-only development stack does not expose it
to a different machine. For remote deployments use a secured, reachable broker.

### MQTT verification

```sh
sh scripts/test_mqtt.sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

The integration script starts an isolated real broker and removes only its own
containers/volumes on exit. It tests publishing, deduplication, invalid input,
connection loss/resubscription, subscriber restart, retained snapshot rejection,
and an ACL-denied publication. Unit tests cover persistence/reopen, migration,
silence/recovery, validation, and shutdown while the broker is unavailable.
Python tests evaluate the Home Assistant example templates; they do not run a full
Home Assistant installation. Both suites run in CI. There is no application-level
receipt, auto-discovery, device provisioning wizard, or publisher firmware in this
repository.
