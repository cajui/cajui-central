// Loaded as a classic script before styles: no imports may delay the first theme.
(() => {
  const root = document.documentElement;
  let theme;
  try {
    theme = localStorage.getItem("cajui-theme");
  } catch {
    // Storage can be unavailable; the system preference still applies.
  }
  root.dataset.theme =
    theme === "light" || theme === "dark"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  root.classList.add("starting");
  const reveal = () => {
    root.classList.remove("starting");
    clearTimeout(deadline);
    document.removeEventListener("cajui-ready", reveal);
  };
  // A failed module request must not leave the server-rendered fallback hidden.
  const deadline = setTimeout(reveal, 4000);
  document.addEventListener("cajui-ready", reveal, { once: true });
})();
