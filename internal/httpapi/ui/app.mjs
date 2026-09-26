import { t, locale, setLocale } from "./i18n.mjs";
import "./components.mjs";
import { icon, mark } from "./icons.mjs";
import { mountDashboard } from "./dashboard.mjs";
import { mountRegistry } from "./registry.mjs";
const state = JSON.parse(document.querySelector("#initial-state").textContent);
setLocale(state.locale ?? document.documentElement.lang);
document.documentElement.lang = locale();
const route = location.pathname;
const title =
  route === "/devices"
    ? t("common.devices")
    : route === "/sensors"
      ? t("common.sensors")
      : t("common.dashboard");

try {
  const theme = localStorage.getItem("cajui-theme");
  if (theme === "dark" || theme === "light")
    document.documentElement.dataset.theme = theme;
} catch {
  /* Storage is optional. */
}
const sidebar = document.querySelector("#sidebar");
sidebar.innerHTML = `<a class="wordmark" href="/" aria-label="${t("nav.home")}">${mark()}<span>Cajuí<small>Central</small></span></a><p class="eyebrow sidebar-label">${t("nav.workspace")}</p><nav class="nav" aria-label="${t("nav.workspace")}">${[
  ["/", t("common.dashboard"), "overview"],
  ["/devices", t("common.devices"), "device"],
  ["/sensors", t("common.sensors"), "temperature"],
]
  .map(
    ([href, name, glyph]) =>
      `<a href="${href}" ${route === href ? 'aria-current="page"' : ""}>${icon(glyph)}${name}</a>`,
  )
  .join("")}</nav>`;
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
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}
const root = document.querySelector("#app");
if (route === "/devices" || route === "/sensors")
  mountRegistry(root, { state, kind: route.slice(1) });
else mountDashboard(root, { state, notify });
document.documentElement.classList.add("ready");
