import { fetchSnapshot } from "./snapshot-api.mjs";

export function validStateSnapshot(value) {
  return (
    value &&
    Array.isArray(value.device_states) &&
    Number.isFinite(Date.parse(value.generated_at))
  );
}

// The server emits bounded, single-line JSON events and comment heartbeats. Read
// incrementally: a network chunk is not an SSE frame or even a complete UTF-8 character.
export async function readStateEvents(body, receive, activity) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      activity();
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 2 * 1024 * 1024)
        throw new Error("State event too large");
      let end;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const lines = frame.split("\n");
        if (!lines.includes("event: states")) continue;
        const line = lines.find((line) => line.startsWith("data: "));
        const snapshot = JSON.parse(line?.slice(6) ?? "null");
        if (!validStateSnapshot(snapshot))
          throw new Error("Invalid state event");
        receive(snapshot);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function watchDeviceStates(state, receive) {
  let token = state.ui_token,
    controller,
    retry,
    idle;
  let disposed = false,
    suspended = false;
  const visible = () => !disposed && !suspended && !document.hidden;
  async function request(path, signal) {
    const response = await fetch(path, {
      headers: { "X-Cajui-Workspace": token },
      cache: "no-store",
      signal,
    });
    if (response.status === 403 && !signal.aborted) {
      // The local capability rotates when the server restarts. Obtain a new one
      // from the local page, never put it in a URL or browser storage.
      const fresh = await fetchSnapshot(location.pathname);
      token = fresh.ui_token;
    }
    return response;
  }
  async function connect() {
    if (!visible() || controller) return;
    clearTimeout(retry);
    const current = new AbortController();
    controller = current;
    const activity = () => {
      clearTimeout(idle);
      idle = setTimeout(() => current.abort(), 35000);
    };
    try {
      activity();
      const response = await request(
        "/ui-api/device-states/events",
        current.signal,
      );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      )
        throw new Error("State stream unavailable");
      await readStateEvents(
        response.body,
        (next) => {
          if (visible()) receive(next);
        },
        activity,
      );
    } catch {
      // A proxy or unavailable stream must not require a manual page refresh.
    } finally {
      clearTimeout(idle);
      current.abort();
      if (visible()) {
        const recovery = new AbortController();
        controller = recovery;
        const timeout = setTimeout(() => recovery.abort(), 5000);
        try {
          const response = await request(
            "/ui-api/device-states",
            recovery.signal,
          );
          if (response.ok) {
            const next = await response.json();
            if (visible() && validStateSnapshot(next)) receive(next);
          }
        } catch {
          /* Retry while the page is visible. */
        } finally {
          clearTimeout(timeout);
        }
      }
      controller = null;
      if (visible()) retry = setTimeout(connect, 2000);
    }
  }
  function pause() {
    clearTimeout(retry);
    controller?.abort();
  }
  function visibility() {
    if (visible()) connect();
    else pause();
  }
  function hide() {
    suspended = true;
    pause();
  }
  function show() {
    suspended = false;
    visibility();
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  connect();
  return () => {
    disposed = true;
    pause();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
  };
}
