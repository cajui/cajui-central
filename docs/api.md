# API v1 — local development

GET /healthz: 200 when the database is reachable, 503 otherwise.
GET /: HTML interface with the last 100 readings (no authentication, loopback only).
GET /api/v1/readings: JSON list, most recently received first; empty is [].
POST /api/v1/readings: accepts one JSON object with Content-Type application/json.
Both /api routes require Authorization: Bearer <CAJUI_API_TOKEN>.

Simulated example:
```json
{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}
```

IDs and metric: 1–64 characters, alphanumeric, dot, hyphen, underscore or colon;
first character alphanumeric. sequence: integer >= 0. value: finite number,
required (zero is valid). unit: 1–32 bytes. measured_at: optional RFC3339 with offset.
received_at is output-only, set by the server in UTC.
Extra fields, concatenated objects and payloads above 8 KiB are rejected.

201: created; 200: identical retry, receipt time unchanged;
400: invalid payload; 401: missing or wrong token; 409: identity already used with
different content; 415: invalid content type; 500: storage failure.
Identity: node_id + sensor_id + session_id + sequence + metric.
One sample may send temperature and humidity separately. This API offers no
multi-metric transaction and no end-to-end delivery guarantee.
