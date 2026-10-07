(() => {
  const root = document.documentElement;
  let theme;
  try {
    theme = localStorage.getItem("cajui-theme");
  } catch {}
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
  const deadline = setTimeout(reveal, 4000);
  document.addEventListener("cajui-ready", reveal, { once: true });
})();
