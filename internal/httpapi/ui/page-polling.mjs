export function pollWhileVisible(callback, interval) {
  const tick = () => {
    if (!document.hidden) callback();
  };
  let timer = setInterval(tick, interval);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    timer = null;
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || timer !== null) return;
    timer = setInterval(tick, interval);
    tick();
  });
}
