import { t } from "./i18n.mjs";
import {
  escapeHTML as e,
  age,
  measurementLabel,
  states,
  formatValue,
  formatUnit,
  isLinkDiagnostic,
  deviceStateFor,
  receiverLabel,
} from "./model.mjs";
import { environmentalSensors, workspaceGroups } from "./workspace-model.mjs";
import {
  saveWorkspace,
  createDialog,
  localizeValidation,
} from "./workspace-api.mjs";
import { icon } from "./icons.mjs";
import { fetchSnapshot } from "./snapshot-api.mjs";
import { commandRunner } from "./command-api.mjs";
import {
  offers,
  shortID,
  awaitingFirstReading,
  pairingRequests,
  pairingSection,
} from "./pairing.mjs";

export function mountRegistry(root, { state, kind, notify }) {
  const sensors = kind === "sensors";
  const title = sensors ? t("common.sensors") : t("common.devices");
  const message = (key, values) => t(`registry.${kind}.${key}`, values);
  let snapshot = state,
    query = "",
    entries = [],
    groups = [],
    devices = new Map(),
    available = [],
    addDialog = null,
    pending = false;
  const commands = commandRunner({
    session: () => snapshot,
    notify,
    done: () => refresh(),
  });
  root.innerHTML = `<header class="page-heading"><div><h1>${title}</h1><p>${message("description")}</p></div><div class="top-actions"><button class="button" id="refresh">${icon("refresh")}${t("common.refresh")}</button><button class="button primary" id="add-entry">${message("add")}</button></div></header><div id="fetch-error" class="notice hidden" role="status"></div><div class="notice hidden" id="discovery-note"></div><label class="search registry-search">${icon("search")}<span class="sr-only">${message("search")}</span><input type="search" placeholder="${message("search")}…"></label><div id="registry-list"></div>`;
  root.querySelector("#refresh").addEventListener("click", () => refresh());
  function update() {
    const catalog = snapshot.workspace;
    entries = sensors ? environmentalSensors(catalog) : catalog.devices;
    groups = workspaceGroups(snapshot);
    devices = new Map(catalog.devices.map((d) => [d.id, d]));
    available = entries.filter((d) => !d.name);
    const note = root.querySelector("#discovery-note");
    note.classList.toggle("hidden", !available.length);
    note.textContent = `${message("count", { count: available.length })} ${message("discovery")}`;
  }
  function dataFor(entry) {
    const device = sensors ? devices.get(entry.device_id) : entry;
    const group = groups.find((g) => g.registryID === device?.id);
    const sensor = sensors
      ? group?.sensors.find((s) => s.registryID === entry.id)
      : null;
    return { device, group, sensor };
  }
  // Battery, radio link and receiver of a device, from its diagnostics and state. A
  // value keeps its own state: an old one says so and a failed read is not "missing".
  function health(entry, group) {
    const none = t("dashboard.not_reported");
    const channel = (metric) =>
      group?.diagnostics.find(
        (c) => c.metric === metric && c.state !== "empty",
      );
    const shown = (c, text) =>
      !c
        ? none
        : ["ok", "recorded"].includes(c.state)
          ? text(c)
          : c.state === "stale"
            ? `${text(c)} · ${states.stale}`
            : (states[c.state] ?? c.state);
    const battery = channel("voltage");
    const rssi = channel("rssi");
    const snr = channel("snr");
    const node = deviceStateFor(
      snapshot.device_states ?? [],
      entry.source,
      entry.device,
    );
    return [
      [
        t("metrics.battery"),
        e(shown(battery, (c) => `${formatValue(c.value, 2)} V`)),
      ],
      [
        t("registry.signal"),
        e(
          shown(rssi, (c) =>
            [
              `${formatValue(c.value, 0)} dBm`,
              snr && ["ok", "recorded", "stale"].includes(snr.state)
                ? `SNR ${formatValue(snr.value, 1)} dB`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
      ],
      [
        t("receivers.receiver"),
        e(
          node?.receiver_id
            ? [
                receiverLabel(node.receiver_id),
                node.binding === "revoked"
                  ? t("receivers.binding_revoked")
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : none,
        ),
      ],
    ];
  }
  function render() {
    const registered = entries.filter(
      (d) =>
        d.name &&
        [d.name, d.location, d.sensor, d.device, devices.get(d.device_id)?.name]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );
    const list = root.querySelector("#registry-list");
    if (!registered.length) {
      list.innerHTML = `<div class="empty">${icon(sensors ? "temperature" : "device")}<h2>${query ? t("registry.no_matches") : message("empty")}</h2><p>${query ? t("registry.try_search") : message("choose")}</p></div>`;
      return;
    }
    const revoked = (entry) =>
      !sensors && bindingOf(entry)?.binding === "revoked";
    const rowsFor = (items) =>
      items.map((entry) => {
        const { device, group, sensor } = dataFor(entry);
        const status = group?.stale
          ? "stale"
          : sensor?.channels.some((c) =>
                ["error", "skipped", "stale"].includes(c.state),
              )
            ? "error"
            : group?.transport === "http"
              ? "recorded"
              : "ok";
        const detail = sensors
          ? entry.measurements
              .filter((m) => !isLinkDiagnostic({ sensor: entry.sensor, ...m }))
              .map(
                (m) =>
                  `${measurementLabel(m.metric)}: ${m.status === "ok" ? formatValue(m.value) + " " + formatUnit(m.unit) : (states[m.status] ?? m.status)}`,
              )
              .join(" · ")
          : age(device.received_at, Date.parse(snapshot.generated_at));
        const cells = [
          [
            t("registry.name_location"),
            `<strong>${e(entry.name)}</strong><span class="registry-secondary">${e(entry.location || t("common.no_location"))}</span>`,
          ],
          [
            sensors ? t("common.device") : t("common.sensors"),
            sensors
              ? `<a href="/devices">${e(device.name || device.device)}</a>`
              : e(
                  t("registry.counts", {
                    registered:
                      group?.sensors.filter((s) => s.registered).length ?? 0,
                    detected: group?.sensors.length ?? 0,
                  }),
                ),
          ],
          [
            sensors ? t("common.measurements") : t("common.last_report"),
            e(detail),
          ],
          ...(sensors ? [] : health(entry, group)),
          [
            t("common.status"),
            revoked(entry)
              ? `<span class="badge" data-state="empty">${e(t("receivers.binding_revoked"))}</span>`
              : `<cj-badge state="${status}"></cj-badge>`,
          ],
          [
            t("common.actions"),
            `<span class="row-actions"><button class="button" data-edit="${entry.id}" aria-label="${e(t("registry.edit_name", { name: entry.name }))}">${t("common.edit")}</button>${revoked(entry) ? `<button class="button" data-repair aria-label="${e(t("registry.pairing.repair_name", { name: entry.name }))}">${t("registry.pairing.repair")}</button>` : ""}</span>`,
          ],
        ];
        return cells;
      });
    const table = (items, caption) => {
      const rows = rowsFor(items);
      return `<div class="panel scroll"><table class="registry-table" role="table"><caption class="sr-only">${e(caption)}</caption><thead role="rowgroup"><tr role="row">${rows[0].map(([label]) => `<th scope="col" role="columnheader">${e(label)}</th>`).join("")}</tr></thead><tbody role="rowgroup">${rows
        .map(
          (cells) =>
            `<tr role="row">${cells.map(([label, html]) => `<td role="cell" data-label="${e(label)}">${html}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
    };
    const active = registered.filter((entry) => !revoked(entry));
    const gone = registered.filter(revoked);
    // Revoked devices keep their name and history but sit apart, below the working ones.
    list.innerHTML = `${active.length ? table(active, message("registered")) : ""}${gone.length ? `<section class="registry-revoked" aria-labelledby="revoked-heading"><h2 id="revoked-heading">${e(t("registry.pairing.revoked_heading"))}</h2><p class="muted">${e(t("registry.pairing.revoked_note"))}</p>${table(gone, t("registry.pairing.revoked_heading"))}</section>` : ""}`;
    for (const b of list.querySelectorAll("[data-repair]"))
      b.addEventListener("click", openAdd);
    for (const b of list.querySelectorAll("[data-edit]"))
      b.addEventListener("click", () =>
        edit(entries.find((d) => d.id === Number(b.dataset.edit))),
      );
  }
  function edit(entry, existingDialog) {
    const dialog =
      existingDialog ??
      createDialog(root, message(entry.name ? "edit" : "add"));
    dialog.querySelector("h2").textContent = message(
      entry.name ? "edit" : "add",
    );
    dialog.dataset.mode = "form";
    dialog.querySelector(".dialog-body")?.remove();
    const body = document.createElement("div");
    body.className = "dialog-body";
    const { device } = dataFor(entry);
    body.innerHTML = `<p>${sensors ? e(t("registry.sensor_identity", { device: device.name || device.device, sensor: entry.sensor })) : `${e(entry.transport.toUpperCase())} · ${e(entry.source)} · ${e(entry.device)}`}</p><form class="workspace-form"><label>${t("common.name")}<input class="input" name="name" required maxlength="80" value="${e(entry.name)}" autocomplete="off"></label><label>${t("common.location")} <span class="muted">${t("common.optional")}</span><input class="input" name="location" maxlength="80" value="${e(entry.location)}" autocomplete="off"></label><p class="muted">${t("registry.identity_note")}</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">${message("save")}</button></form>`;
    dialog.append(body);
    const form = body.querySelector("form");
    localizeValidation(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      const data = new FormData(form);
      try {
        await saveWorkspace(snapshot, `${kind}/${entry.id}`, {
          name: data.get("name").trim(),
          location: data.get("location").trim(),
          revision: entry.revision,
        });
        location.reload();
      } catch (error) {
        form.querySelector('[role="alert"]').textContent = error.message;
        button.disabled = false;
      }
    });
    const revoke = sensors ? null : revokeButton(entry, dialog);
    if (revoke) body.append(revoke);
    else if (!sensors && bindingOf(entry)?.binding === "revoked")
      body.insertAdjacentHTML(
        "beforeend",
        `<p class="notice">${e(t("registry.pairing.revoked"))}</p>`,
      );
    if (!dialog.open) dialog.showModal();
    form.elements.name.focus();
  }
  // Revocation is management, not monitoring: it lives with the device's name.
  function bindingOf(entry) {
    return entry.transport === "mqtt"
      ? deviceStateFor(snapshot.device_states ?? [], entry.source, entry.device)
      : null;
  }
  function revokeButton(entry, dialog) {
    if (entry.transport !== "mqtt") return null;
    const states = snapshot.device_states ?? [];
    const node = bindingOf(entry);
    const receiver = node?.receiver_id
      ? deviceStateFor(states, entry.source, node.receiver_id)
      : null;
    if (!offers(receiver, "revoke") || node.binding === "revoked") return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button danger";
    button.textContent = t("commands.revoke");
    button.addEventListener("click", () => {
      if (commands.running) {
        notify(t("commands.in_progress"));
        return;
      }
      const name = entry.name || entry.device;
      if (!window.confirm(t("commands.revoke_confirm", { name }))) return;
      dialog.close();
      commands.run(button, {
        source_id: entry.source,
        device_id: node.receiver_id,
        type: "node.revoke",
        node_id: entry.device,
      });
    });
    return button;
  }
  // Short ID for a first-party node; other sources keep the identifier they send.
  function deviceLabel(entry) {
    return entry.transport === "mqtt" && /^[0-9a-f]{16}$/.test(entry.device)
      ? t("commands.request_name", { id: shortID(entry.device) })
      : entry.device;
  }
  function availableItems() {
    return available
      .map((entry) => {
        const { device } = dataFor(entry);
        const blocked = sensors && !device.name;
        const secondary = sensors
          ? [
              device.name || device.device,
              ...entry.measurements
                .filter(
                  (m) => !isLinkDiagnostic({ sensor: entry.sensor, ...m }),
                )
                .map((m) => measurementLabel(m.metric)),
            ].join(" · ")
          : `${entry.source} · ${entry.transport.toUpperCase()}`;
        const action = blocked
          ? `<a href="/devices">${t("registry.register_parent")}</a>`
          : `<button class="button" data-select="${entry.id}" data-focus="select/${entry.id}" aria-label="${e(t("registry.select_name", { name: sensors ? entry.sensor : entry.device }))}">${t("registry.name_action")}</button>`;
        return `<li><span><strong>${e(sensors ? entry.sensor : deviceLabel(entry))}</strong><span class="muted">${e(secondary)}</span></span>${action}</li>`;
      })
      .join("");
  }
  // The add dialog follows the live snapshot until a form replaces its list.
  function renderAdd() {
    const dialog = addDialog;
    if (!dialog || dialog.dataset.mode === "form") return;
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : undefined;
    dialog.querySelector(".dialog-body")?.remove();
    const body = document.createElement("div");
    body.className = "dialog-body";
    if (!sensors) body.append(pairingSection(snapshot, commands.run));
    const naming = document.createElement("section");
    naming.className = "add-step";
    const waiting = sensors ? [] : awaitingFirstReading(snapshot);
    const heading = sensors
      ? ""
      : `<h3>${e(t("registry.pairing.naming_heading"))}</h3>`;
    naming.innerHTML =
      available.length || waiting.length
        ? `${heading}<p>${message("select")}</p><ul class="add-list" aria-label="${e(message("available"))}">${availableItems()}${waiting.map((s) => `<li><span><strong>${e(t("commands.request_name", { id: shortID(s.device_id) }))}</strong><span class="muted">${e(t("registry.pairing.awaiting_data"))}</span></span></li>`).join("")}</ul>`
        : !sensors && pairingRequests(snapshot)
          ? `${heading}<p class="muted">${e(t("registry.pairing.after_add"))}</p>`
          : `${heading}<div class="empty"><h3>${message("no_new")}</h3><p>${t("registry.send")}</p></div>`;
    body.append(naming);
    dialog.append(body);
    for (const b of body.querySelectorAll("[data-select]"))
      b.addEventListener("click", () =>
        edit(
          entries.find((d) => d.id === Number(b.dataset.select)),
          dialog,
        ),
      );
    if (focused)
      body.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
  }
  function openAdd() {
    addDialog = createDialog(root, message("add"));
    const dialog = addDialog;
    dialog.addEventListener("close", () => {
      if (addDialog === dialog) addDialog = null;
    });
    renderAdd();
    dialog.showModal();
  }
  root.querySelector("#add-entry").addEventListener("click", openAdd);
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = root.querySelector("#refresh");
    button.disabled = true;
    try {
      snapshot = await fetchSnapshot(location.pathname);
      root.querySelector("#fetch-error").classList.add("hidden");
      const edit = document.activeElement?.dataset?.edit;
      update();
      render();
      if (edit)
        root.querySelector(`[data-edit="${CSS.escape(edit)}"]`)?.focus();
      renderAdd();
    } catch {
      root.querySelector("#fetch-error").textContent = t(
        "dashboard.refresh_error",
      );
      root.querySelector("#fetch-error").classList.remove("hidden");
    } finally {
      pending = false;
      button.disabled = false;
    }
  }
  root
    .querySelector('input[type="search"]')
    .addEventListener("input", (event) => {
      query = event.target.value.toLowerCase();
      render();
    });
  update();
  render();
  // New devices and pairing requests appear within seconds while the add dialog is
  // open; the list itself follows the dashboard's 30 s cadence.
  const idle = () => !document.hidden && !commands.running;
  const timer = setInterval(() => {
    if (idle()) refresh();
  }, 30000);
  const addTimer = setInterval(() => {
    if (idle() && addDialog && addDialog.dataset.mode !== "form") refresh();
  }, 3000);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      clearInterval(addTimer);
    },
    { once: true },
  );
}
