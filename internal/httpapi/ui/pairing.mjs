import { t } from "./i18n.mjs";
import { icon } from "./icons.mjs";
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
function commandButton(label, command, act, primary) {
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
  button.addEventListener("click", () => act(button, command));
  return button;
}
function stage(kind, title, body, id = "pairing-heading") {
  const box = document.createElement("div");
  box.className = "pairing-stage";
  box.dataset.stage = kind;
  box.innerHTML = `<h3 id="${id}">${e(title)}</h3>${body}`;
  return box;
}
// One transmitter in the flow: a request to add, one being added, or one just added.
function item(title, meta, note, status, focus) {
  const li = document.createElement("li");
  li.className = "pairing-item";
  li.innerHTML = `<span class="pairing-item-text"><strong>${e(title)}</strong>${meta ? `<span class="muted">${e(meta)}</span>` : ""}${note ? `<span class="muted">${e(note)}</span>` : ""}</span>`;
  if (status) {
    li.dataset.phase = status.phase;
    li.insertAdjacentHTML(
      "beforeend",
      `<span class="pairing-progress" role="status">${status.phase === "applied" ? icon("check") : ""}<span>${e(status.text)}</span></span>`,
    );
    // While busy the row has no button; its status keeps focus instead of the body.
    if (focus) {
      const progress = li.querySelector(".pairing-progress");
      progress.tabIndex = -1;
      progress.dataset.focus = focus;
    }
  }
  return li;
}
// Radio pairing for every receiver that offers it. progress holds what this dialog
// did, keyed by node, so each step stays visible after the receiver's own state
// moves on: the request disappears once accepted, the device appears once it reports.
export function pairingSection(snapshot, act, progress = new Map()) {
  const section = document.createElement("section");
  section.className = "add-step pairing";
  section.setAttribute("aria-labelledby", "pairing-heading");
  const receivers = pairingReceivers(snapshot);
  if (!receivers.length) {
    section.append(
      stage(
        "none",
        t("registry.pairing.no_receiver_title"),
        `<p>${e(t("registry.pairing.no_receiver"))}</p>`,
      ),
    );
    return section;
  }
  const now = Date.parse(snapshot.generated_at);
  // Progress is kept per receiver and node: two receivers of one source may hear the
  // same transmitter.
  const stepFor = (r, node) => progress.get(`${r.device_id}/${node}`);
  receivers.forEach((r, index) => {
    const headingID = index ? `pairing-heading-${index}` : "pairing-heading";
    const status = receiverSummary(r).status;
    const badge = { online: "ok", offline: "network", unknown: "empty" }[
      status
    ];
    section.insertAdjacentHTML(
      "beforeend",
      `<p class="pairing-via">${e(t("registry.pairing.via", { receiver: receiverLabel(r.device_id) }))}<span class="badge" data-state="${badge}">${e(t(`receivers.${status}`))}</span></p>`,
    );
    const target = { source_id: r.source_id, device_id: r.device_id };
    if (status !== "online") {
      section.append(
        stage(
          "offline",
          t("registry.pairing.offline_title"),
          `<p>${e(t("registry.pairing.offline"))}</p>`,
          headingID,
        ),
      );
    } else if (!r.pairing?.open) {
      // After a pairing here the steps are known; offer another one without them.
      const again = [...progress.values()].some(
        (step) => step.phase === "applied" && step.receiver === r.device_id,
      );
      const box = stage(
        "idle",
        t(
          again
            ? "registry.pairing.again_title"
            : "registry.pairing.idle_title",
        ),
        again
          ? ""
          : `<ol class="pairing-steps">${["step_search", "step_button", "step_accept"].map((k) => `<li>${e(t(`registry.pairing.${k}`))}</li>`).join("")}</ol>`,
        headingID,
      );
      box.append(
        commandButton(
          t("commands.search"),
          { ...target, type: "pairing.open" },
          act,
          !again,
        ),
      );
      section.append(box);
    } else {
      const left = pairingRemaining(r, now);
      const box = stage(
        "searching",
        t("registry.pairing.searching_title"),
        `${left === null ? "" : `<p class="pairing-clock">${e(t("registry.pairing.time_left", { time: clockText(left) }))}</p>`}<p>${e(t("registry.pairing.hold_button"))}</p>`,
        headingID,
      );
      box.append(
        commandButton(
          t("commands.stop"),
          { ...target, type: "pairing.close" },
          act,
          false,
        ),
      );
      section.append(box);
    }
    const list = document.createElement("ul");
    list.className = "pairing-list";
    list.setAttribute("aria-label", t("commands.requests"));
    const shown = new Set();
    for (const request of status === "online" && r.pairing?.open
      ? (r.pairing.requests ?? [])
      : []) {
      const step = stepFor(r, request.node_id);
      if (step?.phase === "applied") continue;
      shown.add(request.node_id);
      const known = knownDevice(snapshot, r.source_id, request.node_id);
      const meta = [
        t("registry.pairing.id", { id: shortID(request.node_id) }),
        typeof request.rssi_dbm === "number"
          ? t("registry.pairing.signal", {
              value: formatValue(request.rssi_dbm, 0),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const busy = step && ["sending", "waiting"].includes(step.phase);
      const li = item(
        known?.name || t("registry.pairing.new_device"),
        meta,
        request.conflict
          ? t("commands.conflict")
          : known
            ? t("registry.pairing.known")
            : "",
        step ? { phase: step.phase, text: step.text } : null,
        ["pairing.accept", r.source_id, r.device_id, request.node_id].join("/"),
      );
      if (!busy) {
        const add = commandButton(
          step?.phase === "failed"
            ? t("registry.pairing.retry")
            : t("commands.add"),
          { ...target, type: "pairing.accept", node_id: request.node_id },
          act,
          true,
        );
        add.disabled = Boolean(request.conflict);
        li.append(add);
      }
      list.append(li);
    }
    for (const step of progress.values()) {
      const node = step.node;
      if (shown.has(node) || step.receiver !== r.device_id) continue;
      if (step.phase !== "applied" && step.phase !== "failed") continue;
      const device = knownDevice(snapshot, r.source_id, node);
      const reporting =
        device && Date.parse(device.received_at) >= step.at - 1000;
      const text =
        step.phase === "failed"
          ? step.text
          : !reporting
            ? t("registry.pairing.done_waiting")
            : device.name
              ? t("registry.pairing.done_reporting")
              : t("registry.pairing.done_name");
      const li = item(
        device?.name || step.name || t("registry.pairing.new_device"),
        t("registry.pairing.id", { id: shortID(node) }),
        "",
        { phase: step.phase, text },
      );
      if (reporting && !device.name) {
        const name = document.createElement("button");
        name.type = "button";
        name.className = "button primary";
        name.dataset.select = String(device.id);
        name.dataset.focus = `select/${device.id}`;
        name.textContent = t("registry.name_action");
        li.append(name);
      }
      list.append(li);
    }
    if (list.children.length) section.append(list);
  });
  return section;
}
