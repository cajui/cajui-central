// A live view fetches its own server-rendered page again and reads the embedded state,
// so it needs no separate read API or token.
export async function fetchSnapshot(path) {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("refresh failed");
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const next = JSON.parse(doc.querySelector("#initial-state").textContent);
  if (
    !Array.isArray(next.samples) ||
    !Array.isArray(next.readings) ||
    !Array.isArray(next.devices)
  )
    throw new Error("invalid snapshot");
  return next;
}
