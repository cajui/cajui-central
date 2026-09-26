import "/ui/components.mjs";
import { icon, mark } from "/ui/icons.mjs";
import { mountDashboard } from "./example-dashboard.mjs";
import { mountBrand, mountComponents, mountResearch } from "./design.mjs";

const mode = document.body.dataset.page;
const names = {
  live: "Overview",
  demo: "Example dashboard",
  brand: "Visual identity",
  components: "Component library",
  research: "Design research",
};
try {
  const theme = localStorage.getItem("cajui-theme");
  if (theme === "dark" || theme === "light")
    document.documentElement.dataset.theme = theme;
} catch {
  /* Storage is optional. */
}
const sidebar = document.querySelector("#sidebar");
const nav = (href, name, iconName, key) =>
  `<a href="${href}" ${key === mode ? 'aria-current="page"' : ""}>${icon(iconName)}${name}</a>`;
sidebar.innerHTML = `<a class="wordmark" href="/design/brand" aria-label="Cajuí visual identity">${mark()}<span>Cajuí<small>Central</small></span></a><p class="eyebrow sidebar-label">Examples</p><nav class="nav" aria-label="Workspace">${nav("/design/dashboard", "Example dashboard", "device", "demo")}</nav><p class="eyebrow sidebar-label">Design system</p><nav class="nav" aria-label="Design system">${nav("/design/brand", "Visual identity", "palette", "brand")}${nav("/design/components", "Components", "components", "components")}${nav("/design/research", "Research & scope", "book", "research")}</nav><div class="sidebar-bottom"><div class="sidebar-note"><strong>Made to observe.</strong>One place for the things you measure.</div></div>`;
const topbar = document.querySelector("#topbar");
topbar.innerHTML = `<div class="crumb"><button class="icon-button mobile-menu" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar" id="menu">${icon("menu")}</button><span class="muted">Cajuí Central</span><span class="muted">/</span><strong>${names[mode]}</strong></div><div class="top-actions"><span class="eyebrow">${"DESIGN DOCUMENTATION"}</span><button class="icon-button" id="theme" aria-label="Switch color theme">${icon("moon")}</button></div>`;
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
  if (event.key === "Escape") {
    closeMenu();
  }
});
document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target) && !menu.contains(event.target))
    closeMenu();
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
if (mode === "brand") mountBrand(root, notify);
else if (mode === "components") mountComponents(root, notify);
else if (mode === "research") mountResearch(root);
else
  mountDashboard(root, {
    demo: mode === "demo",
    state: JSON.parse(document.querySelector("#initial-state").textContent),
    notify,
  });
document.documentElement.classList.add("ready");
