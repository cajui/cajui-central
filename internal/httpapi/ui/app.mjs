import "./components.mjs";
import { icon, mark } from "./icons.mjs";
import { mountDashboard } from "./dashboard.mjs";

try {
  const theme = localStorage.getItem("cajui-theme");
  if (theme === "dark" || theme === "light")
    document.documentElement.dataset.theme = theme;
} catch {
  /* Storage is optional. */
}
const sidebar = document.querySelector("#sidebar");
sidebar.innerHTML = `<a class="wordmark" href="/" aria-label="Cajuí Central home">${mark()}<span>Cajuí<small>Central</small></span></a><p class="eyebrow sidebar-label">Workspace</p><nav class="nav" aria-label="Workspace"><a href="/" aria-current="page">${icon("overview")}Overview</a></nav>`;
document.querySelector("#topbar").innerHTML =
  `<div class="crumb"><button class="icon-button mobile-menu" id="menu" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">${icon("menu")}</button><span class="muted">Cajuí Central</span><span class="muted">/</span><strong>Overview</strong></div><button class="icon-button" id="theme" aria-label="Switch color theme">${icon("moon")}</button>`;
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
      ? "Switch to light theme"
      : "Switch to dark theme",
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
mountDashboard(root, {
  state: JSON.parse(document.querySelector("#initial-state").textContent),
  notify,
});
document.documentElement.classList.add("ready");
