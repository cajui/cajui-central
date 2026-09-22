# Cajuí Central

Local monitoring server: receives sensor readings over an HTTP API, stores them in
SQLite and shows them in an embedded web interface. Independent of the sensor
hardware. Bootstrap under development; it does not control actuators or receive
data over MQTT yet.

## Running

### With Docker (no Go required)

Requirements: Docker with Compose v2.

```sh
cp .env.example .env     # set CAJUI_API_TOKEN with: openssl rand -hex 32
docker compose up --build
```

Open http://127.0.0.1:8080. The database lives in the Docker volume `cajui-data`,
which survives restarts and image rebuilds; `docker compose down -v` deletes it.
Ctrl+C stops the stack; `docker compose up -d` runs it in the background and the
service comes back with Docker. `CAJUI_PORT` in `.env` changes the host port
(default 8080).

Compose reads `.env` to fill in variables; the executable itself does not read `.env`.
Inside the container the process listens on `0.0.0.0` with `CAJUI_ALLOW_NON_LOOPBACK=1`,
but the port is published on the host's `127.0.0.1` only. Never publish on `0.0.0.0`.

### With a local Go toolchain

Requirements: Go 1.27+, Make; a C toolchain for `go test -race`.

```sh
export CAJUI_API_TOKEN="$(openssl rand -hex 32)"
make run
```

Open http://127.0.0.1:8080. The database is created at `data/cajui.db`.
Variables: CAJUI_ADDR (default 127.0.0.1:8080, loopback IPs only), CAJUI_DB (file
path), CAJUI_API_TOKEN (at least 24 characters; use a random secret),
CAJUI_ALLOW_NON_LOOPBACK (only `1`, meant for containers; see Security).
Keep the token in the test terminal.

### Sending a simulated reading

In another terminal, export the same token and send:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

Refresh the page. Repeating the example does not duplicate the reading; change
sequence for a new sample. Data stays in SQLite after the server stops.

## Quality and layout

```sh
make check          # formatting, vet, race tests and coverage >= 80%
make build          # bin/cajui
make docker-check   # the same make check inside golang:1.27, no local Go
make docker-build   # cajui:local image
# after the tests:
go tool cover -html=coverage.out
```

- cmd/cajui: startup and shutdown.
- internal/telemetry: contract and validation.
- internal/storage: SQLite and schema evolution.
- internal/httpapi: API and the interface embedded in the binary.
- internal/config: validated configuration.
- Dockerfile and compose.yaml: static non-root image and local execution.
- .github/workflows: GitHub CI.

[API contract](docs/api.md) · [Architecture](docs/architecture.md) ·
[Status](docs/status.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md).

## Scope and publication

Next step: MQTT ingestion with real readings and failure/communication states.
Device registry, alerts, automations and user authentication are not implemented yet.

Licensed under [Apache-2.0](LICENSE).
Repository: https://github.com/romulostorel/cajui-central. Private security channel
still to be defined (see SECURITY.md). Go module: `github.com/romulostorel/cajui-central`.
