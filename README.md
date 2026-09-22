# Cajuí Central

Local server for sensor readings: an HTTP API receives them, SQLite stores them and
an embedded web page shows the latest ones. Hardware-agnostic. Early stage: no
actuator control and no MQTT yet.

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
- `Dockerfile`, `compose.yaml`: container image and local stack.

[API](docs/api.md) · [Architecture](docs/architecture.md) · [Status](docs/status.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Roadmap

Next: MQTT ingestion with real readings and failure/communication states. Not yet
implemented: device registry, alerts, automations, user authentication.

## License

[Apache-2.0](LICENSE).
