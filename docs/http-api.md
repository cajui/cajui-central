# API

[Back to Cajuí Central](../README.md)

All `/api` routes require `Authorization: Bearer <CAJUI_API_TOKEN>`.

- `GET /healthz`: 200 when the database is reachable, 503 otherwise.
- `GET /`, `/devices`, `/receivers`, `/sensors`: local workspace pages (no login, loopback hosts only).
- `GET /api/v1/readings`: JSON list, most recently received first.
- `GET /api/v1/device-states`: latest [device state](mqtt.md#device-state) per device.
- `POST /ui-api/commands`, `GET /ui-api/commands/{id}`: [device commands](mqtt.md#device-commands)
  from the local page (same origin and page capability, like workspace edits).
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
