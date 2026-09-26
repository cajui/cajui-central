import {
  escapeHTML as e,
  age,
  label,
  formatValue,
  formatUnit,
  isLinkDiagnostic,
} from "./model.mjs";
import { environmentalSensors, workspaceGroups } from "./workspace-model.mjs";
import { saveWorkspace, createDialog } from "./workspace-api.mjs";
import { icon } from "./icons.mjs";

export function mountRegistry(root, { state, kind }) {
  const sensors = kind === "sensors";
  const catalog = state.workspace;
  const entries = sensors ? environmentalSensors(catalog) : catalog.devices;
  const groups = workspaceGroups(state);
  const devices = new Map(catalog.devices.map((d) => [d.id, d]));
  const title = sensors ? "Sensors" : "Devices";
  const singular = sensors ? "sensor" : "device";
  let query = "";
  root.innerHTML = `<header class="page-heading"><div><h1>${title}</h1><p>${sensors ? "Name your sensors and see which device reports each measurement." : "Name the devices that send your measurements."}</p></div><div class="top-actions"><button class="button" id="refresh">${icon("refresh")}Refresh</button><button class="button primary" id="add-entry">Add ${singular}</button></div></header><div class="notice" id="discovery-note"></div><label class="search registry-search">${icon("search")}<span class="sr-only">Search ${kind}</span><input type="search" placeholder="Search ${kind}…"></label><div id="registry-list"></div>`;
  root
    .querySelector("#refresh")
    .addEventListener("click", () => location.reload());
  const available = entries.filter((d) => !d.name);
  root.querySelector("#discovery-note").textContent =
    `${available.length} ${available.length === 1 ? singular : kind} available to add. ${sensors ? "Available sensors come from received measurements; register their device first." : "Devices appear after sending data. Adding a device here does not pair radios or grant network access."}`;
  function dataFor(entry) {
    const device = sensors ? devices.get(entry.device_id) : entry;
    const group = groups.find((g) => g.registryID === device?.id);
    const sensor = sensors
      ? group?.sensors.find((s) => s.registryID === entry.id)
      : null;
    return { device, group, sensor };
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
      list.innerHTML = `<div class="empty">${icon(sensors ? "temperature" : "device")}<h2>${query ? "No matches" : `No registered ${kind} yet`}</h2><p>${query ? "Try a different name or location." : `Choose Add ${singular} to select one from the available ${kind}.`}</p></div>`;
      return;
    }
    list.innerHTML = `<div class="panel scroll"><table class="registry-table"><caption class="sr-only">Registered ${kind}</caption><thead><tr><th scope="col">Name / location</th><th scope="col">${sensors ? "Device" : "Sensors"}</th><th scope="col">${sensors ? "Measurements" : "Last report"}</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>${registered
      .map((entry) => {
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
                  `${label(m.metric)}: ${m.status === "ok" ? formatValue(m.value) + " " + formatUnit(m.unit) : label(m.status)}`,
              )
              .join(" · ")
          : age(device.received_at, Date.parse(state.generated_at));
        return `<tr><td><strong>${e(entry.name)}</strong><span class="registry-secondary">${e(entry.location || "No location")}</span></td><td>${sensors ? `<a href="/devices">${e(device.name || device.device)}</a>` : `${group?.sensors.filter((s) => s.registered).length ?? 0} registered / ${group?.sensors.length ?? 0} detected`}</td><td>${e(detail)}</td><td><cj-badge state="${status}"></cj-badge></td><td><button class="button" data-edit="${entry.id}" aria-label="Edit ${e(entry.name)}">Edit</button></td></tr>`;
      })
      .join("")}</tbody></table></div>`;
    for (const b of list.querySelectorAll("[data-edit]"))
      b.addEventListener("click", () =>
        edit(entries.find((d) => d.id === Number(b.dataset.edit))),
      );
  }
  function edit(entry, existingDialog) {
    const dialog =
      existingDialog ??
      createDialog(root, `${entry.name ? "Edit" : "Add"} ${singular}`);
    dialog.querySelector("h2").textContent =
      `${entry.name ? "Edit" : "Add"} ${singular}`;
    dialog.querySelector(".dialog-body")?.remove();
    const body = document.createElement("div");
    body.className = "dialog-body";
    const { device } = dataFor(entry);
    body.innerHTML = `<p>${sensors ? `Device: ${e(device.name || device.device)} · Sensor: ${e(entry.sensor)}` : `${e(entry.transport.toUpperCase())} · ${e(entry.source)} · ${e(entry.device)}`}</p><form class="workspace-form"><label>Name<input class="input" name="name" required maxlength="80" value="${e(entry.name)}" autocomplete="off"></label><label>Location <span class="muted">(optional)</span><input class="input" name="location" maxlength="80" value="${e(entry.location)}" autocomplete="off"></label><p class="muted">Names can change. Identity and recorded history stay the same.</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">Save ${singular}</button></form>`;
    dialog.append(body);
    const form = body.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      const data = new FormData(form);
      try {
        await saveWorkspace(state, `${kind}/${entry.id}`, {
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
    if (!dialog.open) dialog.showModal();
    form.elements.name.focus();
  }
  root.querySelector("#add-entry").addEventListener("click", () => {
    const dialog = createDialog(root, `Add ${singular}`);
    const body = document.createElement("div");
    body.className = "dialog-body";
    body.innerHTML = available.length
      ? `<p>Select a detected ${singular} to give it a name.</p><div class="scroll"><table class="registry-table"><caption class="sr-only">Available ${kind}</caption><thead><tr><th scope="col">${sensors ? "Sensor / measurements" : "Device / source"}</th><th scope="col">${sensors ? "Device" : "Transport"}</th><th scope="col">Action</th></tr></thead><tbody>${available
          .map((entry) => {
            const { device } = dataFor(entry);
            const blocked = sensors && !device.name;
            return `<tr><td><strong>${e(sensors ? entry.sensor : entry.device)}</strong><span class="registry-secondary">${e(
              sensors
                ? entry.measurements
                    .filter(
                      (m) => !isLinkDiagnostic({ sensor: entry.sensor, ...m }),
                    )
                    .map((m) => label(m.metric))
                    .join(" · ")
                : entry.source,
            )}</span></td><td>${e(sensors ? device.name || device.device : entry.transport.toUpperCase())}</td><td>${blocked ? '<a href="/devices">Register device first</a>' : `<button class="button" data-select="${entry.id}" aria-label="Select ${e(sensors ? entry.sensor : entry.device)}">Select</button>`}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : `<div class="empty"><h3>No new ${kind} detected</h3><p>Send measurements from a device, then refresh this page.</p></div>`;
    dialog.append(body);
    for (const b of body.querySelectorAll("[data-select]"))
      b.addEventListener("click", () =>
        edit(
          entries.find((d) => d.id === Number(b.dataset.select)),
          dialog,
        ),
      );
    dialog.showModal();
  });
  root
    .querySelector('input[type="search"]')
    .addEventListener("input", (event) => {
      query = event.target.value.toLowerCase();
      render();
    });
  render();
}
