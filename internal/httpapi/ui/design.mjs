import { escapeHTML as e, contrast } from "./model.mjs";
import { mark, icon } from "./icons.mjs";
import { buildChannels } from "./model.mjs";
import { demoData } from "./demo.mjs";
const intro = (number, title, text) =>
  `<div class="section-intro"><div><p class="eyebrow">${number}</p><h2>${title}</h2></div><p>${text}</p></div>`;
const code = (source) =>
  `<pre class="code-example"><code>${e(source)}</code></pre>`;
const heading = (eyebrow, title, description) =>
  `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div><a class="button" href="/design/dashboard">See it in context ${icon("arrow")}</a></header>`;
export function mountBrand(root, notify) {
  root.innerHTML = `<section class="design-hero"><div><p class="eyebrow">CAJUÍ · VISUAL FOUNDATION 0.1</p><h1 class="display">Small signals.<br>A clearer picture.</h1><p class="lead">Cajuí brings the things you measure into view. Its identity gives those measurements room, a clear hierarchy, and a language you can trust at a glance.</p><div class="top-actions brand-actions"><a class="button primary" href="/design/components">Explore components ${icon("arrow")}</a><a class="button" href="/ui/tokens.css" download>Download tokens</a></div></div><div class="identity-art">${mark()}<span class="art-caption">Observe · connect · understand</span></div></section>
 <section class="design-section" id="principles">${intro("01 / Intent", "Quiet by design", "A monitoring interface should help you notice a change without asking for constant attention. Every choice starts with the measurement and the person reading it.")}<div class="three-grid"><article class="panel"><span class="principle-number">01</span><h3>Give the number room.</h3><p>The measurement leads. Its unit, source and freshness stay close enough to give it meaning.</p></article><article class="panel"><span class="principle-number">02</span><h3>Make uncertainty visible.</h3><p>Missing, old and failed readings have their own states. None of them becomes a reassuring zero.</p></article><article class="panel"><span class="principle-number">03</span><h3>Keep the next step near.</h3><p>Move from a reading to its history and device details without leaving the context behind.</p></article></div></section>
 <section class="design-section" id="mark">${intro("02 / Signature", "A signal with a center", "An open C surrounds a measurement point. A short line connects it to the next point: an observation becoming part of a wider picture. The same rounded ends appear in the icons and charts.")}<div class="logo-variants"><div class="logo-tile"><div class="wordmark">${mark()}Cajuí</div></div><div class="logo-tile inverse"><div class="wordmark">${mark()}Cajuí</div></div></div><p class="muted small brand-caption">Keep one dot’s diameter of clear space around the symbol. Minimum symbol size: 24 px. Use the single-color mark; preserve its proportions.</p><a class="button" href="/ui/assets/cajui-mark.svg" download>${icon("download")}Download SVG mark</a></section>
 <section class="design-section" id="color">${intro("03 / Color", "A purpose for every color", "Chalk and ink carry most of the interface. Leaf marks navigation and deliberate actions. Ochre, clay and water carry specific meanings; status is always written as well as colored.")}<div class="swatches">${[
   ["chalk", "Chalk", "#F5F6F2"],
   ["ink", "Ink", "#20342E"],
   ["leaf", "Leaf", "#265D48"],
   ["ochre", "Ochre", "#825513"],
   ["clay", "Clay", "#A23838"],
   ["water", "Water", "#356E8A"],
 ]
   .map(
     ([name, label, hex]) =>
       `<button class="swatch" data-color="${name}" data-copy="${hex}" aria-label="Copy ${label} ${hex}"><strong>${label}</strong><small>${hex}</small></button>`,
   )
   .join(
     "",
   )}</div><div class="table-wrap brand-table"><table><thead><tr><th>Role</th><th>Use</th><th>Token</th></tr></thead><tbody><tr><td>Leaf</td><td>Primary actions, selection, the identity</td><td><code>--brand</code></td></tr><tr><td>Green status</td><td>A recently reported reading; never a guarantee of connectivity</td><td><code>--good</code></td></tr><tr><td>Ochre</td><td>Silence, caution, an item needing attention</td><td><code>--warning</code></td></tr><tr><td>Clay</td><td>A reported measurement failure</td><td><code>--danger</code></td></tr><tr><td>Water</td><td>Informational context or a labeled chart series</td><td><code>--info</code></td></tr></tbody></table></div></section>
 <section class="design-section" id="contrast">${intro("04 / Accessibility", "Contrast is measurable.", "These ratios are calculated from the active CSS tokens, including the dark theme. Body text targets at least 4.5:1. Labels, icons, patterns and words provide meaning alongside color.")}<div class="table-wrap"><table><thead><tr><th>Pair</th><th>Sample</th><th>Contrast</th><th>Text target</th></tr></thead><tbody id="contrast-audit"></tbody></table></div></section>
 <section class="design-section" id="type">${intro("05 / Typography", "Friendly forms. Precise figures.", "Manrope brings open shapes and a restrained geometric rhythm. Variable weights provide hierarchy in one local font file. Measurements use tabular figures; technical identifiers use the system monospace.")}<div class="type-specimen"><small>Display · 52–76 px</small><p class="display">A clearer picture.</p></div><div class="type-specimen"><small>Heading · 28–40 px</small><h1>Your connected space</h1></div><div class="type-specimen"><small>Measurement · 29–42 px</small><p class="measurement">24.6 <span class="unit">°C</span></p></div><div class="type-specimen"><small>Body · 14 px / 1.6</small><p>Keep the value, unit and time together. Make a gap in the data visible.</p></div><div class="type-specimen"><small>Technical · 12 px</small><code>temperature · ambient · sensor-01</code></div><p class="muted small brand-caption">Manrope by the Manrope Project Authors. Bundled under the SIL Open Font License. No font requests leave the application.</p></section>
 <section class="design-section" id="form">${intro("06 / Shape & rhythm", "A consistent frame.", "A four-pixel spacing scale, restrained corners and fine boundaries keep dense information orderly. Space separates sections; a surface groups related measurements. Motion is optional and respects reduced-motion preferences.")}<dl class="token-list"><div class="panel"><dt>Spacing</dt><dd>4 · 8 · 12 · 16 · 24 · 32 · 48</dd></div><div class="panel"><dt>Control radius</dt><dd>8 px</dd></div><div class="panel"><dt>Card / feature radius</dt><dd>14 px / 22 px</dd></div><div class="panel"><dt>Touch target</dt><dd>44 px for primary navigation</dd></div><div class="panel"><dt>Icon grid</dt><dd>24 × 24 · 1.6 px stroke</dd></div><div class="panel"><dt>Focus</dt><dd>3 px ring · 4 px offset</dd></div></dl></section>
 <section class="design-section">${intro("07 / Voice", "Say what is known.", "Use plain descriptions: “No recent samples”, “Reading error”, “Last known value”. Avoid claiming a device is online just because it reported once. Identify simulations and never mix them into real history.")}<div class="inline-demo"><cj-badge state="ok"></cj-badge><cj-badge state="stale" label="No recent samples"></cj-badge><cj-badge state="error"></cj-badge><cj-badge state="empty"></cj-badge></div></section><footer class="footer"><span>Working visual identity · v0.1</span><a href="/design/research">Research behind the system →</a></footer>`;
  const audit = () => {
    const css = getComputedStyle(document.documentElement);
    const pairs = [
      ["Body", "--ink", "--surface"],
      ["Secondary text", "--muted", "--surface"],
      ["Primary button", "--on-brand", "--brand"],
      ["Success label", "--good", "--good-soft"],
      ["Warning label", "--warning", "--warning-soft"],
      ["Error label", "--danger", "--danger-soft"],
    ];
    root.querySelector("#contrast-audit").innerHTML = pairs
      .map(([name, fg, bg]) => {
        const ratio = contrast(
          css.getPropertyValue(fg).trim(),
          css.getPropertyValue(bg).trim(),
        );
        return `<tr><td>${name}</td><td><code>${fg} / ${bg}</code></td><td>${ratio.toFixed(2)}:1</td><td>${ratio >= 4.5 ? "Pass" : "Below target"} · 4.5:1</td></tr>`;
      })
      .join("");
  };
  audit();
  window.addEventListener("cajui-theme", audit);
  wireCopy(root, notify);
}
function wireCopy(root, notify) {
  root.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        notify("Copied to clipboard.");
      } catch {
        notify("Clipboard unavailable. Select and copy the text instead.");
      }
    }),
  );
}
export function mountComponents(root, notify) {
  const sensor =
    '<cj-sensor label="Temperature" metric="temperature" value="24.6" unit="degC" state="ok" context="Workspace · ambient" updated="Just now"></cj-sensor>';
  root.innerHTML = `${heading("CAJUÍ / COMPONENT LIBRARY", "Built for what you measure.", "Reusable components, real states, one shared visual language.")}<div class="catalog-toolbar"><nav class="catalog-index" aria-label="Component categories"><a href="#measurements">Measurements</a><a href="#states">States</a><a href="#binary">Binary & level</a><a href="#history">History</a><a href="#device">Devices</a><a href="#foundations">Foundations</a></nav><cj-badge state="info" label="Interactive examples"></cj-badge></div>
 <section class="design-section" id="measurements">${intro("01 / Measurement", "The sensor card", "A number is only useful with its unit, origin and freshness. The optional sparkline gives a short history; a missing reading stays missing. This component also works without a chart.")}<div class="component-demo"><div class="sensor-grid"><cj-sensor id="playground" label="Temperature" metric="temperature" value="24.6" unit="degC" state="ok" context="Workspace · ambient" updated="Just now"></cj-sensor><cj-sensor label="Humidity" metric="humidity" value="62" unit="%" state="ok" context="Greenhouse · ambient" updated="1 min ago"></cj-sensor><cj-sensor label="Illuminance" metric="illuminance" value="1240" unit="lx" state="ok" context="Terrace · light" updated="1 min ago"></cj-sensor><cj-sensor label="Carbon dioxide" metric="co2" value="684" unit="ppm" state="ok" context="Workspace · air" updated="2 min ago"></cj-sensor></div><div class="toolbar"><label class="small">Try a state <select id="play-state" class="input"><option value="ok">Updated</option><option value="stale">Stale</option><option value="error">Reading error</option><option value="skipped">Not sampled</option><option value="empty">No data</option><option value="loading">Loading</option></select></label><label class="small">Value <input id="play-value" class="input" type="number" value="24.6" step="0.1" min="-50" max="100"></label></div></div><div class="code-label"><code>&lt;cj-sensor&gt;</code><button class="button" data-copy="${e(sensor)}">${icon("copy")}Copy HTML</button></div>${code(sensor)}<p class="muted small brand-caption">Attributes: label, metric, value, unit, state, context, updated. Set <code>element.data</code> for a full model with timestamped points. Live values never need to become HTML.</p></section>
 <section class="design-section" id="states">${intro("02 / Data quality", "Different reasons to pause.", "Stale is an old value. Error is an unsuccessful measurement. Empty is no observation. Loading is an operation in progress. Color reinforces the label; it never replaces it.")}<div class="state-grid"><cj-sensor label="Temperature" metric="temperature" value="21.8" unit="degC" state="stale" context="Last known measurement" updated="42 min ago"></cj-sensor><cj-sensor label="Temperature" metric="temperature" unit="degC" state="error" context="Device reported a failure" updated="Just now"></cj-sensor><cj-sensor label="Temperature" metric="temperature" unit="degC" state="empty" context="Awaiting the first sample"></cj-sensor><cj-sensor label="Temperature" metric="temperature" unit="degC" state="loading" context="Request in progress"></cj-sensor></div><div class="inline-demo brand-actions"><cj-badge state="ok"></cj-badge><cj-badge state="stale"></cj-badge><cj-badge state="error"></cj-badge><cj-badge state="skipped"></cj-badge><cj-badge state="empty"></cj-badge></div>${code('<cj-badge state="error"></cj-badge>')}</section>
 <section class="design-section" id="binary">${intro("03 / More than numbers", "Open, present, full.", "Binary sensors describe an observation, not a control. Percentages use a bounded meter; zero is a real value and an unknown level does not render as empty.")}<div class="three-grid"><cj-state label="Entry door" metric="contact" value="Closed" state="ok" context="Entryway · magnetic contact"></cj-state><cj-state label="Motion" metric="motion" value="Not detected" state="ok" context="Workspace · last observation"></cj-state><cj-level label="Water storage" value="72" context="Tank · reported fill level"></cj-level></div>${code('<cj-state label="Entry door" metric="contact" value="Closed" state="ok"></cj-state>\n<cj-level label="Water storage" value="72" context="Reported level"></cj-level>')}<p class="muted small brand-caption">These examples are display components. The current numeric telemetry contract does not define generic actuator commands or a binary-sensor schema.</p></section>
 <section class="design-section" id="history">${intro("04 / History", "A change, in context.", "A single series keeps its own unit. Inspect with the pointer or keyboard slider, or read the same observations in a table. Gaps are visible; no interpolation invents a missing value.")}<section class="panel"><div class="panel-heading"><div><h3>Temperature</h3><p>Simulated history · °C · local time</p></div><cj-badge state="info" label="Example"></cj-badge></div><cj-chart id="catalog-chart"></cj-chart></section>${code('const chart = document.querySelector("cj-chart");\nchart.data = {\n  label: "Temperature", unit: "degC", interval: 300,\n  points: [\n    { time: Date.parse("2026-01-01T12:00:00Z"), value: 24.6 },\n    { time: Date.parse("2026-01-01T12:05:00Z"), value: null },\n    { time: Date.parse("2026-01-01T12:10:00Z"), value: 24.8 }\n  ]\n};')}</section>
 <section class="design-section" id="device">${intro("05 / Device", "Context behind a reading", "Device identity, last report, battery and received signal strength belong together. Missing battery and signal data remain unknown. A signal reading alone is not a reliability score.")}<div class="three-grid"><cj-device label="Climate sensor" state="ok" battery="86" signal="-72" context="Greenhouse · 1 min ago"></cj-device><cj-device label="Entry sensor" state="stale" context="Entryway · 90 min ago"></cj-device><cj-device label="Soil sensor" state="error" battery="18" signal="-87" context="Greenhouse · reading unavailable"></cj-device></div><div class="inline-demo brand-actions"><cj-battery value="86"></cj-battery><cj-battery value="0"></cj-battery><cj-battery></cj-battery><cj-signal value="-72"></cj-signal><cj-signal></cj-signal></div>${code('<cj-device label="Climate sensor" state="ok" battery="86" signal="-72" context="1 min ago"></cj-device>')}</section>
 <section class="design-section" id="foundations">${intro("06 / Foundations", "The supporting pieces", "Controls use native HTML semantics. Every button in this reference has an action; future capabilities stay outside the product navigation until they exist.")}<div class="panel"><div class="inline-demo"><button id="example-action" class="button primary">${icon("check")}Example action</button><button class="button" data-copy="Cajuí">${icon("copy")}Copy text</button><button class="button" disabled>Unavailable action</button><cj-badge state="info" label="Example"></cj-badge></div><div class="notice brand-actions">${icon("alert")}<span><strong>Could not refresh.</strong> Showing the last loaded snapshot. Its readings may be out of date.</span></div><div class="empty">${icon("device")}<h3>No readings received yet</h3><p>Measurements will appear when a source sends its first sample.</p></div></div></section>
 <section class="design-section">${intro("07 / Integration", "Use the same components.", "Load one stylesheet and the component module. No npm installation, compilation or runtime CDN. The application embeds these files; component tests can use Node as a development tool.")} ${code('<link rel="stylesheet" href="/ui/ui.css">\n<script type="module" src="/ui/components.mjs"></script>\n\n<cj-sensor label="Temperature" metric="temperature"\n  value="24.6" unit="degC" state="ok"></cj-sensor>')}<p class="muted small brand-caption">CSS tokens are the public styling surface. Components use light DOM so the application’s styles and accessibility tools can inspect them. Text values are escaped; dynamic scripts and HTML from telemetry are not supported.</p></section>`;
  root
    .querySelector("#play-state")
    .addEventListener("change", (event) =>
      root
        .querySelector("#playground")
        .setAttribute("state", event.target.value),
    );
  root.querySelector("#play-value").addEventListener("input", (event) => {
    const value = event.target.value;
    if (value === "")
      root.querySelector("#playground").removeAttribute("value");
    else root.querySelector("#playground").setAttribute("value", value);
  });
  root
    .querySelector("#example-action")
    .addEventListener("click", () =>
      notify("Example action completed. No device was controlled."),
    );
  const channel = buildChannels(demoData())[0];
  channel.points[20].value = null;
  root.querySelector("#catalog-chart").data = {
    ...channel,
    label: "Temperature",
  };
  wireCopy(root, notify);
}
export function mountResearch(root) {
  root.innerHTML = `${heading("CAJUÍ / DESIGN NOTES", "Learn from the familiar.", "A focused review of monitoring interfaces, translated into a small first release.")}<p class="lead">The common journey is simple: see what needs attention, understand the change, then inspect the device behind it. Cajuí starts there.</p>
 <section class="design-section">${intro("01 / Reference study", "Four useful perspectives.", "Official product documentation reviewed on 25 September 2026. These are design observations and choices for Cajuí, not claims that every referenced product uses the same implementation.")}
 ${[
   [
     "Home Assistant",
     "A quick path from an entity tile to more information. Sections provide a clear way to group related entities and adapt a dashboard.",
     "Adopt: compact measurement cards, grouping and progressive detail. Defer: a full visual dashboard editor.",
     "https://www.home-assistant.io/dashboards/tile/",
     "Tile cards",
     "https://www.home-assistant.io/dashboards/sections/",
     "Sections",
   ],
   [
     "ThingsBoard",
     "A widget library separates telemetry visualization, alarms, maps and controls. Dashboards assemble those building blocks around a use case.",
     "Adopt: a documented component vocabulary and explicit alert states. Defer: maps, SCADA and device commands.",
     "https://thingsboard.io/docs/user-guide/widgets/",
     "Widget library",
     "https://thingsboard.io/docs/user-guide/dashboards/",
     "Dashboards",
   ],
   [
     "Grafana",
     "Dashboard guidance emphasizes a readable hierarchy and panels organized around the questions a person is trying to answer.",
     "Adopt: overview first, a selectable time range, exact units and a path into history. Defer: query editors and advanced comparisons.",
     "https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/",
     "Dashboard guidance",
     null,
     null,
   ],
   [
     "openHAB",
     "The main UI organizes information into pages and reusable widgets, with different page types serving different purposes.",
     "Adopt: reusable display components and a separation between observation and control. Defer: layout editing and automation controls.",
     "https://www.openhab.org/docs/ui/",
     "UI overview",
     "https://www.openhab.org/docs/ui/building-pages",
     "Components and widgets",
   ],
 ]
   .map(
     ([name, text, decision, url, title, url2, title2]) =>
       `<article class="research-card"><div><h3>${name}</h3><a href="${url}" target="_blank" rel="noreferrer">${title} ↗</a>${url2 ? `<br><a href="${url2}" target="_blank" rel="noreferrer">${title2} ↗</a>` : ""}</div><div><p>${text}</p><p class="brand-caption">${decision}</p></div></article>`,
   )
   .join("")}</section>
 <section class="design-section">${intro("02 / First release", "What belongs in the interface.", "A component belongs here when it answers a monitoring question, remains useful without a complex configuration, and can describe its uncertainty.")}<div class="table-wrap"><table><thead><tr><th>Question</th><th>Component</th><th>Available now</th></tr></thead><tbody><tr><td>What is the latest value?</td><td>Sensor card, unit, source, freshness</td><td>Live + example</td></tr><tr><td>What changed?</td><td>History, period selection, exact-value inspection</td><td>Latest loaded observations</td></tr><tr><td>What needs attention?</td><td>Silence and measurement errors</td><td>Live + example</td></tr><tr><td>Which device reported it?</td><td>Device table and details</td><td>Live + example</td></tr><tr><td>Is it open, active or full?</td><td>Binary state and level meter</td><td>Component examples only</td></tr><tr><td>What if there is no reading?</td><td>Empty, loading, error, stale, skipped</td><td>Shared display states</td></tr><tr><td>Can I use it on my phone?</td><td>Responsive layout and compact navigation</td><td>All reference pages</td></tr></tbody></table></div></section>
 <section class="design-section">${intro("03 / Boundaries", "Leave room for the next step.", "This delivery establishes the visual system. It does not imply that every component example already has a matching server feature.")}<ul class="research-list"><li>Friendly names, areas and favorites need a persistent device registry.</li><li>Full-range historical analysis needs time-based queries and aggregation, beyond the latest 100 records.</li><li>Threshold alerts need explicit units, persistence and clear evaluation rules.</li><li>Controls and automations need authorization, confirmation and delivery state.</li><li>Remote access needs application authentication before the dashboard can leave loopback.</li><li>RSSI, battery and binary state require explicit reported data; the interface never invents them.</li></ul></section><footer class="footer"><span>Research informs the implementation; it does not prescribe a framework.</span><a href="/design/brand">Visual foundations →</a></footer>`;
}
