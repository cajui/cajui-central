# Installation and configuration

[Back to Cajuí Central](../README.md)

## Docker

Requires Docker with Compose v2. Download [`compose.yaml`](../compose.yaml), or use this
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
[Producers on the local network](mqtt.md#producers-on-the-local-network).

## Go

Requires Go 1.27.2+ and Make. `go test -race` also needs a C toolchain.

```sh
export CAJUI_API_TOKEN="$(openssl rand -hex 32)"
make run
```

Open http://127.0.0.1:8080. The database is created at `data/cajui.db`.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `CAJUI_API_TOKEN` | required | At least 24 characters; use a random secret. Compose generates it. |
| `CAJUI_ADDR` | `127.0.0.1:8080` | Loopback IPs only. |
| `CAJUI_DB` | `data/cajui.db` | SQLite file path. |
| `CAJUI_ALLOW_NON_LOOPBACK` | unset | `1` inside containers only; see [SECURITY.md](../SECURITY.md). |

Compose also reads these optional values from a `.env` file (see `.env.example`):
`CAJUI_PORT` (dashboard, default 8080, always on `127.0.0.1`), `CAJUI_MQTT_PORT`
(default 1883), `CAJUI_MQTT_BIND` (default all interfaces; `127.0.0.1` keeps the broker
local) and `CAJUI_VERSION` (image tag, default `main`).

## Sending a test reading

In another terminal, export the same token (with Docker, `docker compose run --rm credentials token`) and run:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

The dashboard refreshes automatically or with Refresh. The request is idempotent: repeating it does not duplicate the
reading; change `sequence` to add a sample. Data persists across restarts.
