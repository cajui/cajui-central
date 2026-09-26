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
document.querySelector("#topbar").innerHTML =
  `<a class="wordmark" href="/" aria-label="Cajuí Central home">${mark()}<span>Cajuí<small>Central</small></span></a><div class="top-actions"><span class="screen-title">Overview</span><button class="icon-button" id="theme" aria-label="Switch color theme">${icon("moon")}</button></div>`;
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
