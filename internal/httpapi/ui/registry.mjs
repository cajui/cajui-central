import { t } from "./i18n.mjs";
import {
  escapeHTML as e,
  age,
  measurementLabel,
  states,
  formatValue,
  formatUnit,
  isLinkDiagnostic,
} from "./model.mjs";
import { environmentalSensors, workspaceGroups } from "./workspace-model.mjs";
import {
  saveWorkspace,
  createDialog,
  localizeValidation,
} from "./workspace-api.mjs";
import { icon } from "./icons.mjs";

export function mountRegistry(root, { state, kind }) {
  const sensors = kind === "sensors";
  const catalog = state.workspace;
  const entries = sensors ? environmentalSensors(catalog) : catalog.devices;
  const groups = workspaceGroups(state);
  const devices = new Map(catalog.devices.map((d) => [d.id, d]));
  const title = sensors ? t("common.sensors") : t("common.devices");
  const message = (key, values) => t(`registry.${kind}.${key}`, values);
  let query = "";
  root.innerHTML = `<header class="page-heading"><div><h1>${title}</h1><p>${message("description")}</p></div><div class="top-actions"><button class="button" id="refresh">${icon("refresh")}${t("common.refresh")}</button><button class="button primary" id="add-entry">${message("add")}</button></div></header><div class="notice" id="discovery-note"></div><label class="search registry-search">${icon("search")}<span class="sr-only">${message("search")}</span><input type="search" placeholder="${message("search")}…"></label><div id="registry-list"></div>`;
  root
    .querySelector("#refresh")
    .addEventListener("click", () => location.reload());
  const available = entries.filter((d) => !d.name);
  root.querySelector("#discovery-note").textContent =
    `${message("count", { count: available.length })} ${message("discovery")}`;
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
      list.innerHTML = `<div class="empty">${icon(sensors ? "temperature" : "device")}<h2>${query ? t("registry.no_matches") : message("empty")}</h2><p>${query ? t("registry.try_search") : message("choose")}</p></div>`;
      return;
    }
    list.innerHTML = `<div class="panel scroll"><table class="registry-table"><caption class="sr-only">${message("registered")}</caption><thead><tr><th scope="col">${t("registry.name_location")}</th><th scope="col">${sensors ? t("common.device") : t("common.sensors")}</th><th scope="col">${sensors ? t("common.measurements") : t("common.last_report")}</th><th scope="col">${t("common.status")}</th><th scope="col">${t("common.actions")}</th></tr></thead><tbody>${registered
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
                  `${measurementLabel(m.metric)}: ${m.status === "ok" ? formatValue(m.value) + " " + formatUnit(m.unit) : (states[m.status] ?? m.status)}`,
              )
              .join(" · ")
          : age(device.received_at, Date.parse(state.generated_at));
        return `<tr><td><strong>${e(entry.name)}</strong><span class="registry-secondary">${e(entry.location || t("common.no_location"))}</span></td><td>${sensors ? `<a href="/devices">${e(device.name || device.device)}</a>` : t("registry.counts", { registered: group?.sensors.filter((s) => s.registered).length ?? 0, detected: group?.sensors.length ?? 0 })}</td><td>${e(detail)}</td><td><cj-badge state="${status}"></cj-badge></td><td><button class="button" data-edit="${entry.id}" aria-label="${e(t("registry.edit_name", { name: entry.name }))}">${t("common.edit")}</button></td></tr>`;
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
      createDialog(root, message(entry.name ? "edit" : "add"));
    dialog.querySelector("h2").textContent = message(
      entry.name ? "edit" : "add",
    );
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
    const dialog = createDialog(root, message("add"));
    const body = document.createElement("div");
    body.className = "dialog-body";
    body.innerHTML = available.length
      ? `<p>${message("select")}</p><div class="scroll"><table class="registry-table"><caption class="sr-only">${message("available")}</caption><thead><tr><th scope="col">${sensors ? t("registry.sensor_measurements") : t("registry.device_source")}</th><th scope="col">${sensors ? t("common.device") : t("common.transport")}</th><th scope="col">${t("common.action")}</th></tr></thead><tbody>${available
          .map((entry) => {
            const { device } = dataFor(entry);
            const blocked = sensors && !device.name;
            return `<tr><td><strong>${e(sensors ? entry.sensor : entry.device)}</strong><span class="registry-secondary">${e(
              sensors
                ? entry.measurements
                    .filter(
                      (m) => !isLinkDiagnostic({ sensor: entry.sensor, ...m }),
                    )
                    .map((m) => measurementLabel(m.metric))
                    .join(" · ")
                : entry.source,
            )}</span></td><td>${e(sensors ? device.name || device.device : entry.transport.toUpperCase())}</td><td>${blocked ? `<a href="/devices">${t("registry.register_parent")}</a>` : `<button class="button" data-select="${entry.id}" aria-label="${e(t("registry.select_name", { name: sensors ? entry.sensor : entry.device }))}">${t("common.select")}</button>`}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : `<div class="empty"><h3>${message("no_new")}</h3><p>${t("registry.send")}</p></div>`;
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
