# Status — Cajuí Central

Updated 2026-09-22. First version implemented, hardware-agnostic; Docker execution
added the same day.

## Delivered

Go 1.27, SQLite modernc v1.59.0 with pinned dependencies/go.sum, HTTP API v1, embedded
HTML interface, transactional schema migration, validation and idempotent ingestion.
API token, server restricted to loopback, payload limits and timeouts, shutdown through
context/signals. Apache-2.0 license. Public repository at
https://github.com/romulostorel/cajui-central; public name **Cajuí Central**
(2026-09-22).

Docker: two-stage `Dockerfile` (build on `golang:1.27`, runtime on non-root
`distroless/static`, static cgo-free binary), `compose.yaml` with the named volume
`cajui-data`, port published on the host's `127.0.0.1` only and a mandatory token via
`.env` (`.env.example` included). `make docker-check` runs the checks in a container;
`make docker-build` produces `cajui:local`. Config gained the opt-in
`CAJUI_ALLOW_NON_LOOPBACK=1`, required inside the container and tested. CI gained a job
that builds the image; Dependabot tracks base images and actions.

## Verified

- `make check`: formatting, go vet, race tests; total coverage **89.2%**.
- Config and validation: 100%; API: 97.7%; storage: 85.3%; command: 65.6%.
- Real SQLite: persistence after reopening, concurrent duplicates, conflicts, session
  after restart, measured timestamp, invalid database and future schema rejected.
- HTTP: authentication, invalid input, valid zero, payload limit, errors without
  internal details, empty/populated interface and TCP server with shutdown.
- `make build` passed and produced bin/cajui; `go mod verify` confirmed dependencies.
- Docker (2026-09-22, Docker Desktop 27.4.0/Compose 2.31 on macOS arm64): `make
  docker-check` passed inside `golang:1.27` with the same result as above; final image
  of 24.2 MB running as uid 65532; `docker compose up --build` answered GET / 200, POST
  without token 401, simulated POST 201 and displayed the value; after `docker compose
  down` and `up` the reading persisted in the volume; Compose refuses to start without
  CAJUI_API_TOKEN. Tested in a separate Compose project, removed afterwards.
- GitHub CI (coverage threshold 80%, build, coverage artifact, image build) ran
  remotely for the first time on 2026-09-22: both jobs passed on the Dependabot pull
  requests.

Validated on macOS arm64 with Go 1.27.1.

## Limits

No serial/MQTT bridge, no physical reception, no device registry, availability
detection, automations, multi-user login, retention, operational backup or installer.
The read-only local interface must not be exposed through a tunnel/proxy or published
on 0.0.0.0. Do not mistake the simulated example for a real reading. The contract does
not assume a specific sensor. No health check in the image; volume backup is still
manual and only with the service stopped (WAL).

## Next step

Define the MQTT/device status contract and implement an ingestion adapter reusing
telemetry/storage, with tests for reconnection, repeated messages and failures. Then
validate a real sample from a device in the history and the interface.
Pending: enable private vulnerability reporting on GitHub.
