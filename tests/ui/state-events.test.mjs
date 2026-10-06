import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readStateEvents,
  validStateSnapshot,
} from "../../internal/httpapi/ui/state-events.mjs";
const snapshot = {
  generated_at: "2026-10-06T12:00:00Z",
  device_states: [{ name: "Recepção" }],
};
function stream(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += size)
        c.enqueue(bytes.slice(i, i + size));
      c.close();
    },
  });
}
test("SSE handles fragmented UTF-8, heartbeats and consecutive snapshots", async () => {
  const events = [];
  let activity = 0;
  const frame = `event: states\ndata: ${JSON.stringify(snapshot)}\n\n`;
  await readStateEvents(
    stream(`: heartbeat\n\n${frame}${frame}`),
    (x) => events.push(x),
    () => activity++,
  );
  assert.deepEqual(events, [snapshot, snapshot]);
  assert.ok(activity > 2);
});
test("SSE rejects malformed, incomplete and oversized state frames", async () => {
  for (const data of [
    "no-json",
    "null",
    "{}",
    JSON.stringify({ ...snapshot, generated_at: "bad" }),
  ])
    await assert.rejects(
      readStateEvents(
        stream(`event: states\ndata: ${data}\n\n`, 100),
        () => {},
        () => {},
      ),
    );
  await assert.rejects(
    readStateEvents(
      stream("x".repeat(2 * 1024 * 1024 + 1), 1024 * 1024),
      () => {},
      () => {},
    ),
  );
  assert.equal(
    validStateSnapshot({
      generated_at: snapshot.generated_at,
      device_states: {},
    }),
    false,
  );
});
