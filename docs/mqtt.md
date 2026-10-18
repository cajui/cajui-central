# MQTT

[Back to Cajuí Central](../README.md)

The Compose stack runs Mosquitto with authentication and per-user ACLs. Central and the
`homeassistant` account can read samples and device state; Central also publishes
authorized management commands; the `demo-source` account
can only write under its own namespaces; each producer can only write under its own
namespaces.
Never share an unrestricted broker account across devices. `docker compose run --rm demo`
publishes the simulated [`sample.json`](../examples/mqtt/sample.json); repeating it is
deduplicated. Do not put real credentials or measurements in example files.

Credentials are stored unencrypted in the `secrets` volume, readable only by containers
that mount it and by users who control Docker. Central also mounts the dedicated receiver credential used by its setup assistant. The broker regenerates its password file and ACL on start and within a
few seconds after a producer credential changes, without dropping other clients.

## Wire contract, version 1

Topic: `telemetry/v1/<source_id>/<device_id>/samples`. Payload:
[`sample.json`](../examples/mqtt/sample.json). Publish with QoS 1 and **retain=false**.
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

## Delivery and silence alerts

The broker's PUBACK is the publisher's delivery boundary. **Central sends no
application receipt**. It publishes only supported management commands. PUBACK does not guarantee
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

## Device state

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

## Device commands

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

## Connecting an existing broker

| Variable | Purpose |
| --- | --- |
| `CAJUI_MQTT_URL` | Optional; `ssl://host:8883` uses system CA trust and TLS 1.2 or newer. `tcp://host:1883` requires explicit plaintext opt-in. No URL credentials. |
| `CAJUI_MQTT_USERNAME` | Required when MQTT is enabled. |
| `CAJUI_MQTT_PASSWORD_FILE` | File containing the password; preferred over `CAJUI_MQTT_PASSWORD`. Mutually exclusive. |
| `CAJUI_MQTT_CLIENT_ID` | Default `cajui-central`. Names the persistent session: keep it stable, and give each running instance its own. |
| `CAJUI_MQTT_ALLOW_PLAINTEXT` | Set `1` only for trusted local development. |
| `CAJUI_API_TOKEN_FILE` | File alternative to `CAJUI_API_TOKEN`; mutually exclusive. |

## Producers on the local network

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

## Home Assistant, without Central

Receivers running cajui-firmware announce themselves and their transmitters through
[MQTT Discovery](https://github.com/cajui/cajui-firmware/blob/main/docs/home-assistant.md):
configure the Home Assistant MQTT integration with the `homeassistant` account and the
entities appear. The generated ACL lets each producer write
`homeassistant/sensor/<source_id>/+/config` and the `homeassistant` account read
`homeassistant/#`. The manual configuration below is for producers without Discovery.

Use the same broker and its read-only `homeassistant` account. Configure the
[MQTT integration](https://www.home-assistant.io/integrations/mqtt/) in Home Assistant,
then merge [`home-assistant.yaml`](../examples/mqtt/home-assistant.yaml) into its
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

## MQTT verification

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
