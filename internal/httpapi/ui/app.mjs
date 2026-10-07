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
// Transmitters, receivers and the broker are one task: keeping the equipment working.
const equipment = ["/devices", "/receivers", "/broker"];
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
// Navigation by task (ADR 0002): follow, maintain the equipment, name the sensors.
// Places and events join when their data exists.
const sections = [
  ["/", t("common.dashboard"), "overview", route === "/"],
  ["/devices", t("nav.equipment"), "device", equipment.includes(route)],
  ["/sensors", t("common.sensors"), "temperature", route === "/sensors"],
];
const links = sections
  .map(
    ([href, name, glyph, current]) =>
      `<a href="${href}" ${current ? `aria-current="${href === route ? "page" : "true"}"` : ""}>${icon(glyph)}<span>${name}</span></a>`,
  )
  .join("");
sidebar.innerHTML = `<a class="wordmark" href="/" aria-label="${t("nav.home")}">${mark()}<span>Cajuí<small>Central</small></span></a><nav class="nav" aria-label="${t("nav.main")}">${links}</nav>`;
if (equipment.includes(route)) {
  const tabs = document.createElement("nav");
  tabs.className = "subnav";
  tabs.setAttribute("aria-label", t("nav.equipment"));
  tabs.innerHTML = [
    ["/devices", t("common.devices")],
    ["/receivers", t("common.receivers")],
    ["/broker", t("broker.title")],
  ]
    .map(
      ([href, name]) =>
        `<a href="${href}" ${route === href ? 'aria-current="page"' : ""}>${name}</a>`,
    )
    .join("");
  document.querySelector("#app").before(tabs);
}
document.querySelector("#topbar").innerHTML =
  `<div class="crumb"><button class="icon-button mobile-menu" id="menu" aria-label="${t("nav.open")}" aria-expanded="false" aria-controls="sidebar">${icon("menu")}</button><span class="muted">Cajuí Central</span><span class="muted">/</span><strong>${title}</strong></div><div class="top-actions"><label class="locale-picker"><span class="sr-only">${t("nav.language")}</span><select class="input" id="locale"><option value="en-US" lang="en-US">English (US)</option><option value="pt-BR" lang="pt-BR">Português (Brasil)</option></select></label><button class="icon-button" id="theme" aria-label="${t("nav.theme")}">${icon("moon")}</button></div>`;
document.title = `${title} · Cajuí Central`;
const language = document.querySelector("#locale");
language.value = locale();
language.addEventListener("change", () => {
  // A validated query also works when cookies are disabled. No network mutation.
  const url = new URL(location.href);
  url.searchParams.set("lang", language.value);
  location.assign(url);
});
const menu = document.querySelector("#menu");
function closeMenu() {
  sidebar.dataset.open = "false";
  menu.setAttribute("aria-expanded", "false");
}
menu.addEventListener("click", () => {
  const open = sidebar.dataset.open !== "true";
  sidebar.dataset.open = String(open);
  menu.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.dataset.open === "true") {
    const restoreFocus = sidebar.contains(document.activeElement);
    closeMenu();
    if (restoreFocus) menu.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target) && !menu.contains(event.target))
    closeMenu();
});
const themeButton = document.querySelector("#theme");
function themeLabel() {
  themeButton.setAttribute(
    "aria-label",
    document.documentElement.dataset.theme === "dark"
      ? t("nav.light")
      : t("nav.dark"),
  );
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
