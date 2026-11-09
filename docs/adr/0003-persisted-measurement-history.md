# 0003. Query persisted history independently of ingestion

- Status: Accepted
- Date: 2026-10-17

## Context

ADR 0002 requires a separate decision for historical queries. Filtering the overview's
100 samples cannot represent a requested period. Scanning original JSON on each request
also competes with ingestion for the store's single connection.

## Decision

Maintain an indexed projection of original measurements, written in the same transaction
as telemetry and inventory. Each row references its source HTTP reading or MQTT sample;
uniqueness and status/value constraints protect the projection independently of callers.
Original payloads remain the source of truth. Migration rebuilds the projection without
changing registrations, timestamps, names, archives or original readings.

File databases use a separate, read-only pool of at most two connections for history.
WAL permits these readers alongside the single writer. Each request has a five-second
deadline; cancellation is expected, not an internal server error. In-memory databases
used in tests retain their original connection and do not provide WAL isolation.

Queries select one channel and a receipt-time interval of at most 366 days. Table pages
contain 100 original measurements with a stable insertion anchor. Rows-only responses
leave chart statistics null rather than reporting invented zeroes.

Charts retain all points up to 600, then preserve first, last, minimum, maximum and an
invalid point in at most 120 time buckets aligned to absolute time. Values are never
averaged. Gaps and invalid measurements break lines conservatively. The requested time
span remains visible. Inspection retains a selected original point independently of
simplification while it remains in the range; a point leaving the range is reported.
Closed custom ranges do not poll. Explicit refresh can reload them.

## Alternatives

- Decode original JSON for each request: avoids projection storage but adds repeated
  parsing and prevents efficient channel/time indexing.
- Share the writer connection: simpler but allows slow reads to delay ingestion.
- Average measurements: smaller responses, but hides extrema and sensor failures.
- Retain every chart point: preserves shape but gives unbounded browser work.

## Consequences

Schema 9 rebuilds schema 8 projections with source references and constraints. New row
IDs start beyond the previous maximum so pre-upgrade anchors cannot select unrelated
rows; clients must reopen history after upgrading. Schema 7 databases backfill directly.
Migration is transactional. Back up before upgrading; rollback to an older binary
requires restoring its compatible backup. No automatic retention or deletion is added.

Separate readers still consume CPU, disk bandwidth and WAL space. Request limits do not
replace load tests or retention planning. Long-lived readers can delay WAL checkpoints.
The table is authoritative; chart simplification may omit non-extreme valid points.
