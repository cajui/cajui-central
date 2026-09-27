import { t } from "./i18n.mjs";
import {
  escapeHTML as e,
  formatValue,
  receiverLabel,
  receiverSummary,
} from "./model.mjs";

export function offers(state, family) {
  return (state?.capabilities ?? []).includes(family);
}
export function shortID(id) {
  return String(id ?? "")
    .slice(-4)
    .toUpperCase();
}
// Seconds left in a receiver's pairing window, counted from when its state arrived.
export function pairingRemaining(receiver, now) {
  const left = receiver.pairing?.remaining_s;
  if (typeof left !== "number") return null;
  const elapsed = receiver.retained
    ? 0
    : Math.floor((now - Date.parse(receiver.received_at)) / 1000);
  return Math.max(0, left - Math.max(0, elapsed));
}
export function clockText(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
// Transmitters a receiver accepted that have not sent a reading yet, so the catalog
// has nothing to name.
export function awaitingFirstReading(snapshot) {
  const known = new Set(
    (snapshot.workspace?.devices ?? [])
      .filter((d) => d.transport === "mqtt")
      .map((d) => `${d.source}\u0000${d.device}`),
  );
  return (snapshot.device_states ?? []).filter(
    (s) =>
      s.role === "transmitter" &&
      s.binding !== "revoked" &&
      !known.has(`${s.source_id}\u0000${s.device_id}`),
  );
}
// A node Central already knows asks again after losing its key or a reset; accepting
// pairs it anew under the same identity, name and history.
export function knownDevice(snapshot, source, node) {
  return (snapshot.workspace?.devices ?? []).find(
    (d) => d.transport === "mqtt" && d.source === source && d.device === node,
  );
}
function pairingReceivers(snapshot) {
  return (snapshot.device_states ?? []).filter(
    (s) => s.role === "receiver" && offers(s, "pairing"),
  );
}
// Whether a request the section shows will add a device that still needs a name.
export function pairingRequests(snapshot) {
  return pairingReceivers(snapshot).some(
    (r) =>
      receiverSummary(r).status === "online" &&
      r.pairing?.open &&
      (r.pairing.requests ?? []).some(
        (q) => !knownDevice(snapshot, r.source_id, q.node_id),
      ),
  );
}
function commandButton(label, command, run, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "button primary" : "button";
  button.textContent = label;
  button.dataset.focus = [
    command.type,
    command.source_id,
    command.device_id,
    command.node_id ?? "",
  ].join("/");
  button.addEventListener("click", () => run(button, command));
  return button;
}
// Radio pairing for every receiver that offers it: search, the button hint on the
// transmitter, and the requests to accept.
export function pairingSection(snapshot, run) {
  const section = document.createElement("section");
  section.className = "add-step";
  section.setAttribute("aria-labelledby", "pairing-heading");
  section.innerHTML = `<h3 id="pairing-heading">${e(t("registry.pairing.heading"))}</h3>`;
  const receivers = pairingReceivers(snapshot);
  if (!receivers.length) {
    section.insertAdjacentHTML(
      "beforeend",
      `<p class="muted">${e(t("registry.pairing.no_receiver"))}</p>`,
    );
    return section;
  }
  const now = Date.parse(snapshot.generated_at);
  for (const r of receivers) {
    const status = receiverSummary(r).status;
    const badge = { online: "ok", offline: "error", unknown: "empty" }[status];
    const block = document.createElement("div");
    block.className = "pairing-receiver";
    block.innerHTML = `<p class="pairing-receiver-name"><strong>${e(receiverLabel(r.device_id))}</strong><span class="badge" data-state="${badge}">${e(t(`receivers.${status}`))}</span></p>`;
    const target = { source_id: r.source_id, device_id: r.device_id };
    if (status !== "online") {
      block.insertAdjacentHTML(
        "beforeend",
        `<p class="muted">${e(t("registry.pairing.offline"))}</p>`,
      );
    } else if (!r.pairing?.open) {
      block.insertAdjacentHTML(
        "beforeend",
        `<ol class="pairing-steps">${["step_search", "step_button", "step_accept"].map((k) => `<li>${e(t(`registry.pairing.${k}`))}</li>`).join("")}</ol>`,
      );
      block.append(
        commandButton(
          t("commands.search"),
          { ...target, type: "pairing.open" },
          run,
          true,
        ),
      );
    } else {
      const left = pairingRemaining(r, now);
      const requests = r.pairing.requests ?? [];
      const head = document.createElement("div");
      head.className = "pairing-open";
      head.innerHTML = `<p><strong>${e(left === null ? t("registry.pairing.searching") : t("registry.pairing.searching_left", { time: clockText(left) }))}</strong><span class="muted">${e(t("commands.no_requests"))}</span></p>`;
      head.append(
        commandButton(
          t("commands.stop"),
          { ...target, type: "pairing.close" },
          run,
          false,
        ),
      );
      block.append(head);
      const list = document.createElement("div");
      list.className = "pairing-requests";
      list.innerHTML = `<h4>${e(t("commands.requests"))}</h4>${requests.length ? "" : `<p class="muted">${e(t("registry.pairing.no_requests"))}</p>`}`;
      for (const request of requests) {
        const known = knownDevice(snapshot, r.source_id, request.node_id);
        const row = document.createElement("div");
        row.className = "pairing-request";
        const signal =
          typeof request.rssi_dbm === "number"
            ? t("registry.pairing.signal", {
                value: formatValue(request.rssi_dbm, 0),
              })
            : "";
        const title =
          known?.name ||
          t("commands.request_name", { id: shortID(request.node_id) });
        row.innerHTML = `<span><strong>${e(title)}</strong><span class="muted">${e(signal)}</span>${known ? `<span class="muted">${e(t("registry.pairing.known"))}</span>` : ""}${request.conflict ? `<small>${e(t("commands.conflict"))}</small>` : ""}</span>`;
        const add = commandButton(
          t("commands.add"),
          { ...target, type: "pairing.accept", node_id: request.node_id },
          run,
          true,
        );
        add.disabled = Boolean(request.conflict);
        row.append(add);
        list.append(row);
      }
      block.append(list);
    }
    section.append(block);
  }
  return section;
}
