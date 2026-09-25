// Original 24 × 24 line icons; currentColor keeps the same semantic palette.
const paths = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  temperature:
    '<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z"/><path d="M12 9v9m0 0h.01"/>',
  humidity:
    '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M8.5 15a3.5 3.5 0 0 0 3.5 3.5"/>',
  battery:
    '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M6 10v4m4-4v4m4-4v4"/>',
  signal: '<path d="M4 20v-3m5 3v-7m5 7V9m5 11V4"/>',
  light:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  level:
    '<path d="M5 3v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3M5 13c4-4 10 4 14 0M9 6h2m-2 4h2m-2 7h2"/>',
  door: '<path d="M5 21V3h14v18M2 21h20M5 3l10 3v15M11 12h.01"/>',
  motion:
    '<circle cx="14" cy="4" r="2"/><path d="m7 10 4-3 5 4h4M11 7l-1 7 5 3 1 5m-6-8-4 8M3 8h3m-4 4h3"/>',
  air: '<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3"/>',
  soil: '<path d="M3 20h18M12 20V9M12 14C6 14 5 8 5 6c6 0 7 3 7 8Zm0-5c0-5 3-7 7-7 0 4-2 7-7 7Z"/>',
  alert:
    '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5m0 3h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh:
    '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-6v6h6M4 14a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r=".5"/><circle cx="13" cy="7" r=".5"/><circle cx="17" cy="11" r=".5"/><path d="M12 21c-3-4 4-4 0-7-3-2-6 1-9-1"/>',
  components: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  book: '<path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2V3Z"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  device:
    '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6m-6 4h6m-3 6h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
};
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Object.hasOwn(paths, name) ? paths[name] : paths.device}</svg>`;
}
export function mark() {
  return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M48 16a23 23 0 1 0 0 32" stroke="currentColor" stroke-width="10" stroke-linecap="round"/><path d="M44 32H29" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><circle cx="53" cy="32" r="5" fill="currentColor"/></svg>';
}
export const metricIcon = (metric) =>
  ({
    temperature: "temperature",
    humidity: "humidity",
    soil_moisture: "soil",
    illuminance: "light",
    light: "light",
    battery: "battery",
    co2: "air",
    water_level: "level",
    contact: "door",
    motion: "motion",
  })[metric] ?? "device";
