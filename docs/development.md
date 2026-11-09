# Development

[Back to Cajuí Central](../README.md)

Run these commands from the repository root. Use the Go version in `go.mod`.

```sh
make check          # gofmt, go vet, tests with -race, coverage >= 80%
make build          # bin/cajui
make docker-check   # make check inside the Go image pinned in the Makefile
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

[Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md)

## Roadmap

Next: TLS for producers on the local network. Not yet implemented: alerts beyond
silence detection, automations, user authentication or remote device provisioning.
