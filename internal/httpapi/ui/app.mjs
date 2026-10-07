import { t, locale, setLocale } from "./i18n.mjs";
import "./components.mjs";
import { icon, mark } from "./icons.mjs";
import { mountDashboard } from "./dashboard.mjs";
import { mountRegistry } from "./registry.mjs";
import { mountBroker } from "./broker.mjs";
import { mountReceivers } from "./receivers.mjs";
const state = JSON.parse(document.querySelector("#initial-state").textContent);
setLocale(state.locale ?? document.documentElement.lang);
document.documentElement.lang = locale();
const route = location.pathname;
const title =
  {
    "/devices": t("common.devices"),
    "/receivers": t("common.receivers"),
    "/broker": t("broker.title"),
    "/sensors": t("common.sensors"),
  }[route] ?? t("common.dashboard");

// A theme chosen with the toggle wins; until then the page follows the system.
let chosenTheme = null;
try {
  const theme = localStorage.getItem("cajui-theme");
  if (theme === "dark" || theme === "light") chosenTheme = theme;
} catch {
  /* Storage is optional. */
}
const systemDark = matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme =
  chosenTheme ?? (systemDark.matches ? "dark" : "light");
const sidebar = document.querySelector("#sidebar");
// The overview on its own, then areas (ADR 0002): the equipment someone installs,
// sensors included, and the system it reports through, which is a service rather than
// a device. Places and events join when their data exists.
const overview = ["/", t("common.dashboard"), "overview"];
const areas = [
  [
    "equipment",
    t("nav.equipment"),
    "device",
    [
      ["/devices", t("common.devices"), "device"],
      ["/receivers", t("common.receivers"), "signal"],
      ["/sensors", t("common.sensors"), "temperature"],
    ],
  ],
  [
    "system",
    t("nav.system"),
    "components",
    [["/broker", t("broker.title"), "components"]],
  ],
];
const link = ([href, name, glyph], className = "") =>
  `<a ${className ? `class="${className}" ` : ""}href="${href}" ${route === href ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${name}</span></a>`;
sidebar.innerHTML = `<a class="wordmark" href="/" aria-label="${t("nav.home")}">${mark()}<span>Cajuí<small>Central</small></span></a><nav class="nav" aria-label="${t("nav.main")}">${link(overview)}${areas
  .map(
    ([id, name, , pages]) =>
      `<p class="eyebrow sidebar-label" id="area-${id}">${name}</p><div class="nav-group" role="group" aria-labelledby="area-${id}">${pages.map((page) => link(page)).join("")}</div>`,
  )
  .join("")}</nav>`;
document.querySelector("#topbar").innerHTML =
  `<div class="crumb"><span class="muted">Cajuí Central</span><span class="muted">/</span><strong>${title}</strong></div><div class="top-actions" id="top-settings"><div class="shell-settings" id="settings"><label class="locale-picker"><span class="settings-label">${t("nav.language")}</span><select class="input" id="locale"><option value="en-US" lang="en-US">English (US)</option><option value="pt-BR" lang="pt-BR">Português (Brasil)</option></select></label><button class="icon-button theme-button" id="theme" type="button">${icon("moon")}<span class="settings-label" id="theme-text"></span></button></div></div>`;
// On a phone the menu sits at the bottom, within reach of the thumb: the overview, one
// tab per area that opens a sheet with its pages, and More for language and theme,
// which would otherwise crowd the top bar. Each control exists once and moves between
// the top bar and that sheet.
function sheet(id, label, content) {
  const element = document.createElement("div");
  element.id = id;
  element.className = "nav-sheet";
  element.popover = "auto";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", label);
  element.innerHTML = content;
  return element;
}
const tabbar = document.createElement("nav");
tabbar.className = "tabbar";
tabbar.setAttribute("aria-label", t("nav.main"));
tabbar.innerHTML = `${link(overview, "tab")}${areas
  .map(
    ([id, name, glyph, pages]) =>
      `<button class="tab" type="button" popovertarget="sheet-${id}" ${pages.some(([href]) => href === route) ? 'aria-current="true"' : ""}>${icon(glyph)}<span>${name}</span></button>`,
  )
  .join(
    "",
  )}<button class="tab" type="button" popovertarget="more">${icon("menu")}<span>${t("nav.more")}</span></button>`;
const more = sheet("more", t("nav.more"), "");
document
  .querySelector(".shell")
  .append(
    tabbar,
    ...areas.map(([id, name, , pages]) =>
      sheet(
        `sheet-${id}`,
        name,
        `<div class="sheet-links">${pages.map((page) => link(page)).join("")}</div>`,
      ),
    ),
    more,
  );
const settings = document.querySelector("#settings");
const phone = matchMedia("(max-width: 1000px)");
function placeSettings() {
  // Moving a focused control drops focus to the page; give it back when the control
  // stays visible (a closed More sheet cannot hold focus).
  const focused = settings.contains(document.activeElement)
    ? document.activeElement
    : null;
  if (phone.matches) more.append(settings);
  else {
    for (const open of document.querySelectorAll(".nav-sheet:popover-open"))
      open.hidePopover();
    document.querySelector("#top-settings").append(settings);
  }
  focused?.focus();
}
placeSettings();
phone.addEventListener("change", placeSettings);
document.title = `${title} · Cajuí Central`;
const language = document.querySelector("#locale");
language.value = locale();
language.addEventListener("change", () => {
  // A validated query also works when cookies are disabled. No network mutation.
  const url = new URL(location.href);
  url.searchParams.set("lang", language.value);
  location.assign(url);
});
const themeButton = document.querySelector("#theme");
// The button says what it does: hidden next to the icon on a wide screen, written out
// under More on a phone.
function themeLabel() {
  themeButton.querySelector("#theme-text").textContent =
    document.documentElement.dataset.theme === "dark"
      ? t("nav.light")
      : t("nav.dark");
}
themeLabel();
themeButton.addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("cajui-theme", theme);
  } catch {
    /* Theme still works without storage. */
  }
  chosenTheme = theme;
  themeLabel();
  window.dispatchEvent(new Event("cajui-theme"));
});
systemDark.addEventListener("change", (event) => {
  if (chosenTheme) return;
  document.documentElement.dataset.theme = event.matches ? "dark" : "light";
  themeLabel();
  window.dispatchEvent(new Event("cajui-theme"));
});
let toastTimer;
function notify(text) {
  clearTimeout(toastTimer);
  let toast = document.querySelector("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    // A popover sits in the top layer, so a notice stays readable above an open
    // modal dialog instead of behind its backdrop.
    toast.popover = "manual";
    document.body.append(toast);
  }
  toast.textContent = text;
  if (toast.matches(":popover-open")) toast.hidePopover();
  toast.showPopover();
  toastTimer = setTimeout(() => toast.hidePopover(), 3000);
}
const root = document.querySelector("#app");
if (route === "/devices" || route === "/sensors")
  mountRegistry(root, { state, kind: route.slice(1), notify });
else if (route === "/broker") mountBroker(root, { state });
else if (route === "/receivers") mountReceivers(root, { state, notify });
else mountDashboard(root, { state, notify });
document.documentElement.classList.add("ready");

document.dispatchEvent(new Event("cajui-ready"));
