# Initial architecture

Implementation decision of 2026-09-22: Go, SQLite and an embedded HTML interface.
Mosquitto/MQTT remains the next integration; it is not a dependency of this version.

Flow: HTTP adapter → telemetry contract → SQLite storage.
The Repository contract lives next to its HTTP consumer, without framework or ORM.
Go allows multi-platform distribution; Windows is not supported yet. The modernc
SQLite driver is cgo-free Go; the race detector may need a C toolchain.

A reading identifies node, sensor, session, sequence and metric. A node restart must
change the session, not its identity. Identical retries do not duplicate samples;
the same identity with different content returns a conflict. Receipt is recorded by
the server and preserved across retries; the measured time is optional and never inferred.
A sensor error or a missing reading is not zero: do not send an invalid reading.
Status contract, standard units and the MQTT version will be defined during that integration.

The initial schema is versioned through PRAGMA user_version and created in a transaction.
A newer schema is rejected so an old binary never runs on an incompatible database.
SQLite uses WAL, a single connection and a busy timeout. No automatic retention in this
phase; queries are limited to the last 100 samples. Do not copy only the .db while writes
happen: consistent backup and restore will be implemented before continuous operation.

Local demonstration interface, without auto-refresh or an online indicator.
No coupling to a specific transport protocol; a future bridge will translate and authenticate.
Before a multi-user local network: login, per-hub credentials, TLS where applicable,
ingestion limits, authorization and a retention/backup policy.

Container execution (2026-09-22, to avoid a local Go toolchain): two-stage image,
static cgo-free build on `golang:1.27` and execution on `distroless/static` as a
non-root user, with data in a named volume mounted at `/data`. The process must listen
on the container interface, hence `CAJUI_ALLOW_NON_LOOPBACK=1`; the loopback guarantee
moves to `compose.yaml`, which publishes the port on the host's `127.0.0.1` only.
Rejected alternative: Docker host networking, which would keep the process on loopback
but does not behave uniformly on Docker Desktop. No health check in the image: there is
no shell or curl.

References: https://go.dev/doc/ ; https://pkg.go.dev/modernc.org/sqlite ;
https://www.sqlite.org/wal.html
