import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
const referenceURL = "http://127.0.0.1:8092";

// Existing page fixtures own their states; keep the live transport isolated from
// the disposable server's inventory. Dedicated tests below drive actual SSE frames.
test.beforeEach(async ({ page }) => {
  await page.route("**/ui-api/device-states/events", (route) => route.abort());
  await page.route("**/ui-api/device-states", async (route) => {
    const snapshot = await page.evaluate(() =>
      JSON.parse(document.querySelector("#initial-state").textContent),
    );
    await route.fulfill({
      json: {
        generated_at: snapshot.generated_at,
        device_states: snapshot.device_states ?? [],
      },
    });
  });
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
]) {
  test(`dashboard interactions and local assets ${viewport.width}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(referenceURL + "/design/dashboard");
    await expect(page.locator("cj-sensor")).toHaveCount(4);
    await expect(
      page.getByText(
        "All readings and device names on this page are simulated.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page
      .getByRole("button", { name: "Needs attention", exact: true })
      .click();
    await expect(page.locator("#sensors cj-sensor")).toHaveCount(1);
    await page
      .getByRole("button", { name: "All sensors", exact: true })
      .click();
    await page.getByRole("searchbox").fill("humidity");
    await expect(page.locator("#sensors cj-sensor")).toHaveCount(1);
    await page.getByRole("searchbox").fill("no-such-sensor");
    await expect(page.getByText("No matching sensors")).toBeVisible();
    await page.getByRole("searchbox").fill("");
    await page.getByLabel("Chart period").selectOption("1");
    await expect(page.locator("#plot-count")).toHaveText("2 observations");
    await page
      .getByRole("button", { name: "Climate sensor", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(
      "cajui-example-readings.csv",
    );
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (viewport.width <= 1000) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("navigation", { name: "Design system" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    expect(requests.every((url) => url.startsWith(referenceURL))).toBeTruthy();
  });
}
test("component states, literal text and keyboard chart inspection", async ({
  page,
}) => {
  await page.goto(referenceURL + "/design/components");
  await expect(page.locator("#playground")).toBeVisible();
  await page.locator("#play-value").fill("0");
  await expect(page.locator("#playground .measurement")).toContainText("0");
  await page.locator("#play-value").fill("");
  await expect(page.locator("#playground .measurement")).toContainText("—");
  await page.locator("#play-value").fill("24.6");
  await page.locator("#play-state").selectOption("error");
  await expect(page.locator("#playground .measurement")).toContainText("—");
  await page
    .locator("#playground")
    .evaluate((el) =>
      el.setAttribute("label", '<img src=x onerror="window.pwned=true">'),
    );
  await expect(page.locator("#playground h3")).toHaveText(
    '<img src=x onerror="window.pwned=true">',
  );
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.locator("#playground img").count()).toBe(0);
  const slider = page.locator("#catalog-chart input");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await page.locator("#catalog-chart summary").click();
  await expect(page.locator("#catalog-chart table")).toBeVisible();
});
test("brand contrast audit updates with theme and navigation works", async ({
  page,
}) => {
  await page.goto(referenceURL + "/design/brand");
  await expect(page.locator("#contrast-audit tr")).toHaveCount(14);
  await expect(page.locator("#contrast-audit")).not.toContainText(
    "Below target",
  );
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("#contrast-audit")).not.toContainText(
    "Below target",
  );
  await page
    .getByRole("link", { name: "Research & scope", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Learn from the familiar." }),
  ).toBeVisible();
});
test("live view refresh preserves data after a network failure", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.route("**/", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator("#fetch-error")).toBeVisible();
  await expect(page.locator("#fetch-error")).toContainText(
    "last loaded snapshot",
  );
});

for (const path of [
  "/design/brand",
  "/design/components",
  "/design/dashboard",
]) {
  test(`accessibility audit ${path}`, async ({ page }) => {
    await page.goto(referenceURL + path);
    await page.locator("html.ready").waitFor();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page
          .getByRole("button", { name: "Switch to dark theme" })
          .click();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
  });
}

test("isolated chart observations and invalid binary states remain visible", async ({
  page,
}) => {
  await page.goto(referenceURL + "/design/components");
  await page.locator("#catalog-chart").evaluate(
    (el) =>
      (el.data = {
        label: "Gaps",
        unit: "degC",
        points: [
          { time: 1, value: 0 },
          { time: 2, value: null },
          { time: 3, value: 2 },
        ],
      }),
  );
  await expect(page.locator("#catalog-chart .point")).toHaveCount(2);
  const state = page.locator("cj-state").first();
  await state.evaluate((el) => el.setAttribute("state", "error"));
  await expect(state.locator(".state-value")).toHaveText("Unknown");
});

test("tablet recognition, touch targets and history keep quantity separate from state", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    baseURL,
  });
  const page = await context.newPage();
  await page.goto(referenceURL + "/design/dashboard");
  const temperature = page.locator("#sensors cj-sensor").nth(0);
  const humidity = page.locator("#sensors cj-sensor").nth(1);
  const accent = (locator) =>
    locator
      .locator(".metric-icon")
      .evaluate((el) => getComputedStyle(el).color);
  expect(await accent(temperature)).not.toBe(await accent(humidity));
  const sizes = await temperature.evaluate((el) =>
    Object.fromEntries(
      [".card-title", ".card-context", ".measurement", ".reading-age"].map(
        (selector) => [
          selector,
          parseFloat(getComputedStyle(el.querySelector(selector)).fontSize),
        ],
      ),
    ),
  );
  expect(sizes[".card-title"]).toBeGreaterThanOrEqual(18);
  expect(sizes[".card-context"]).toBeGreaterThanOrEqual(16);
  expect(sizes[".measurement"]).toBeGreaterThanOrEqual(40);
  expect(sizes[".reading-age"]).toBeGreaterThanOrEqual(16);
  for (const selector of [
    "#refresh",
    "#export",
    "#search",
    "[data-filter=attention]",
    "#period",
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.height, selector).toBeGreaterThanOrEqual(48);
    expect(box.width, selector).toBeGreaterThanOrEqual(48);
  }
  const temperatureBox = await temperature.boundingBox();
  const humidityBox = await humidity.boundingBox();
  expect(temperatureBox.y).toBe(humidityBox.y);
  await humidity.tap();
  await expect(page.locator("#history-heading")).toBeFocused();
  await expect(page.locator("#metric-select option:checked")).toContainText(
    "Humidity",
  );
  const color = await page
    .locator("#history .series")
    .evaluate((el) => getComputedStyle(el).stroke);
  expect(color).toBe(await accent(humidity));
  await page.locator(".summary-link").tap();
  await expect(page.locator("#attention-panel h2")).toBeInViewport();
  await context.close();
});

test("measurement identity survives failures and unknown metric names stay neutral", async ({
  page,
}) => {
  await page.goto(referenceURL + "/design/components");
  const card = page.locator("#playground");
  const before = await card
    .locator(".metric-icon")
    .evaluate((el) => getComputedStyle(el).color);
  await page.locator("#play-state").selectOption("error");
  expect(
    await card
      .locator(".metric-icon")
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe(before);
  await expect(card.locator(".reading-note")).toHaveText("Value unavailable");
  // An abnormal state carries a shape besides colour and text (ADR 0002).
  const shape = (state) =>
    card
      .locator(`.badge[data-state="${state}"]`)
      .evaluate((el) => getComputedStyle(el, "::before").content);
  expect(await shape("error")).not.toBe("none");
  // Forced colours replace author backgrounds; the shape must still be drawn.
  await page.emulateMedia({ forcedColors: "active" });
  const [fill, canvas] = await card
    .locator('.badge[data-state="error"]')
    .evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.background = "Canvas";
      document.body.append(probe);
      const ground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [getComputedStyle(el, "::before").backgroundColor, ground];
    });
  expect(fill).not.toBe(canvas);
  await page.emulateMedia({ forcedColors: "none" });
  for (const metric of [
    "custom_metric",
    "__proto__",
    "constructor",
    '<img src=x onerror="window.pwned=true">',
  ]) {
    await card.evaluate((el, name) => el.setAttribute("metric", name), metric);
    await expect(card.locator("article")).toHaveAttribute(
      "data-kind",
      "device",
    );
    await expect(card.locator("img")).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

async function liveWorkspace(page, language = "en-US") {
  const now = Date.now();
  const snapshot = {
    locale: language,
    generated_at: new Date(now).toISOString(),
    readings: [],
    devices: [
      {
        source_id: "receiver",
        device_id: "device-1",
        last_received_at: new Date(now - 60000).toISOString(),
        expected_interval_seconds: 300,
        stale: false,
        sensor_error: false,
      },
    ],
    samples: [],
  };
  for (let i = 0; i < 4; i++)
    snapshot.samples.push({
      source_id: "receiver",
      device_id: "device-1",
      sample_id: `sample-${i}`,
      received_at: new Date(now - 60000 - i * 300000).toISOString(),
      expected_interval_seconds: 300,
      readings: [
        {
          sensor_id: "sensor-1",
          metric: "temperature",
          unit: "degC",
          value: 24 + i,
          status: "ok",
        },
        {
          sensor_id: "sensor-1",
          metric: "humidity",
          unit: "%",
          value: 60 + i,
          status: "ok",
        },
        {
          sensor_id: "radio",
          metric: "rssi",
          unit: "dBm",
          value: -85,
          status: "ok",
        },
        {
          sensor_id: "radio",
          metric: "snr",
          unit: "dB",
          value: 12,
          status: "ok",
        },
      ],
    });
  snapshot.workspace = {
    devices: [
      {
        id: 1,
        transport: "mqtt",
        source: "receiver",
        device: "device-1",
        name: "Device 1",
        location: "",
        revision: 1,
        received_at: snapshot.samples[0].received_at,
        interval: 300,
      },
    ],
    sensors: ["sensor-1", "radio"].map((sensor, index) => ({
      id: index + 1,
      device_id: 1,
      sensor,
      name: sensor === "radio" ? "" : "Sensor 1",
      location: "",
      revision: sensor === "radio" ? 0 : 1,
      measurements: snapshot.samples[0].readings
        .filter((r) => r.sensor_id === sensor)
        .map((r) => ({
          ...r,
          received_at: snapshot.samples[0].received_at,
          interval: 300,
        })),
    })),
    layout: { revision: 0, sections: null },
  };
  const response = await page.request.get(`/?lang=${language}`);
  const html = await response.text();
  const serve = (state) => {
    const json = JSON.stringify(state).replaceAll("<", "\\u003c");
    return page.route("**/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: html.replace(
          /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
          `$1${json}$2`,
        ),
      }),
    );
  };
  await serve(snapshot);
  await page.goto("/");
  await page.locator("html.ready").waitFor();
  return { snapshot, serve };
}
test("live data keeps refreshing while a chart or dialog is open", async ({
  page,
}) => {
  await page.clock.install();
  const { snapshot, serve } = await liveWorkspace(page);
  const reading = page.locator(".reading-button").nth(1);
  await reading.click();
  await expect(page.locator("#history-heading")).toBeFocused();
  await page.locator("#history summary").click();
  await expect(page.locator("#history details")).toHaveAttribute("open", "");
  const next = structuredClone(snapshot);
  const humidity = (state, value) => {
    state.samples[0].readings[1].value = value;
    state.workspace.sensors[0].measurements[1].value = value;
  };
  humidity(next, 71);
  await serve(next);
  await page.clock.fastForward(31000);
  await expect(reading).toHaveAccessibleName(/Inspect Humidity: 71/);
  await expect(page.locator("#history-panel")).toBeVisible();
  await expect(page.locator("#history details")).toHaveAttribute("open", "");
  await expect(page.locator("#history summary")).toBeFocused();
  await page.locator("#history summary").click();
  await page.clock.fastForward(31000);
  await expect(page.locator("#history details")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.keyboard.press("Escape");
  await expect(reading).toBeFocused();
  await page
    .getByRole("button", { name: "Details for Device 1", exact: true })
    .focus();
  humidity(next, 72);
  await serve(next);
  await page.clock.fastForward(31000);
  await expect(reading).toHaveAccessibleName(/Inspect Humidity: 72/);
  await expect(
    page.getByRole("button", { name: "Details for Device 1", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  humidity(next, 73);
  await serve(next);
  await page.clock.fastForward(31000);
  await expect(reading).toHaveAccessibleName(/Inspect Humidity: 73/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Details for Device 1", exact: true }),
  ).toBeFocused();
});
for (const width of [390, 820, 1440]) {
  test(`product groups one device and one sensor at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1180 });
    await liveWorkspace(page);
    // One place per transmitter, its readings as rows, and nothing to report.
    await expect(page.locator(".place")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Places", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".places-heading")).toContainText(
      "trend of the last 3 h",
    );
    await expect(page.locator(".reading-button")).toHaveCount(2);
    // A known measurement keeps its decimals: 24 °C reads "24.0", like "47.4 %".
    await expect(page.locator(".row-value").first()).toContainText("24.0");
    await expect(page.locator("#summary")).toContainText("All clear");
    await expect(page.locator("#summary")).toContainText("1 device");
    await expect(page.locator("#attention")).toBeHidden();
    await expect(page.locator("#toolbar")).toBeHidden();
    await expect(page.locator('a[href^="/design/"]')).toHaveCount(0);
    await expect(page.locator(".diagnostic-button").first()).not.toBeVisible();
    await expect(page.locator("#history-panel")).not.toBeVisible();
    await page.getByRole("button", { name: /Inspect Humidity:/ }).click();
    await expect(page.locator("#history-heading")).toBeFocused();
    await expect(page.locator("#metric-select option:checked")).toContainText(
      "Humidity",
    );
    await expect(page.locator("#metric-select option")).toHaveText([
      "Temperature · °C",
      "Humidity · %",
    ]);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Details for Device 1", exact: true })
      .click();
    await expect(page.locator(".diagnostic-button")).toHaveCount(2);
    await page
      .getByRole("button", { name: /Inspect Signal strength \(RSSI\) history/ })
      .click();
    await expect(page.locator("#metric-select option:checked")).toContainText(
      "RSSI",
    );
    await page.keyboard.press("Escape");
    await page.locator("#refresh").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".place [data-details]")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Details for Device 1", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("device-1");
    await page.keyboard.press("Escape");
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    expect((await download).suggestedFilename()).toBe("cajui-readings.csv");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}
test("on a phone the menu sits at the bottom, with language and theme under More", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await liveWorkspace(page);
  const tabs = page.getByRole("navigation", { name: "Main navigation" });
  await expect(tabs).toBeVisible();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const language = page.getByRole("combobox", { name: "Language" });
  await expect(language).toBeHidden();
  const more = tabs.getByRole("button", { name: "More" });
  await more.click();
  await expect(language).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(language).toBeHidden();
  // The end of the page stays readable above the bar.
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const bar = await tabs.boundingBox();
  const footer = await page.locator(".footer").boundingBox();
  expect(footer.y + footer.height).toBeLessThanOrEqual(bar.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  // Each area opens a sheet with its pages, and the area stays marked on them.
  await tabs.getByRole("button", { name: "Equipment" }).click();
  const equipment = page.getByRole("dialog", { name: "Equipment" });
  await expect(equipment.getByRole("link")).toHaveText([
    "Devices",
    "Receivers",
    "Sensors",
  ]);
  await equipment.getByRole("link", { name: "Devices" }).click();
  await expect(
    page.getByRole("heading", { name: "Devices", exact: true, level: 1 }),
  ).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Main navigation" });
  await expect(menu.getByRole("button", { name: "Equipment" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await menu.getByRole("button", { name: "System" }).click();
  await expect(
    page.getByRole("dialog", { name: "System" }).getByRole("link"),
  ).toHaveText(["MQTT broker"]);
});

test("known measurements keep their decimals on every screen", async ({
  page,
}) => {
  const { snapshot, serve } = await liveWorkspace(page);
  const button = page.locator(".reading-button").first();
  await expect(button).toHaveAccessibleName(/Inspect Temperature: 24\.0 °C/);
  await button.click();
  await expect(page.locator("#history-value")).toContainText("24.0");
  await expect(page.locator("#history .chart-selection")).toHaveText(
    /· 24\.0 °C$/,
  );
  await page.locator("#history summary").click();
  await expect(page.locator("#history tbody td").nth(1)).toHaveText("24.0");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Details for Device 1", exact: true })
    .click();
  await expect(page.locator("#device-detail")).toContainText("12.0 dB");
  await page.keyboard.press("Escape");
  snapshot.samples[0].readings.push({
    sensor_id: "battery",
    metric: "voltage",
    unit: "V",
    value: 3.3,
    status: "ok",
  });
  snapshot.workspace.layout.sections = [
    { title: "Climate", items: [{ kind: "sensor", sensor_id: 1 }] },
  ];
  await serve(snapshot);
  await page.goto("/");
  await expect(page.locator("#attention")).toContainText(
    "Device 1: battery at 3.30 V",
  );
  await expect(page.locator("#attention")).toContainText("Below 3.40 V");
  await expect(page.locator("cj-reading .measurement").first()).toContainText(
    "24.0",
  );
});
test("devices and sensors pages keep the same decimals", async ({ page }) => {
  const state = pairingSnapshot();
  const at = new Date(Date.now() - 60000).toISOString();
  state.samples.push({
    source_id: "site",
    device_id: "0000aa000000b002",
    sample_id: "s1",
    received_at: at,
    expected_interval_seconds: 300,
    readings: [
      {
        sensor_id: "battery",
        metric: "voltage",
        unit: "V",
        value: 4,
        status: "ok",
      },
      {
        sensor_id: "radio",
        metric: "rssi",
        unit: "dBm",
        value: -71,
        status: "ok",
      },
      { sensor_id: "radio", metric: "snr", unit: "dB", value: 9, status: "ok" },
    ],
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: at,
    interval: 300,
  });
  await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row.locator('td[data-label="Battery"]')).toHaveText("4.00 V");
  await expect(row.locator('td[data-label="Signal"]')).toHaveText(
    "-71 dBm · SNR 9.0 dB",
  );
  const { snapshot } = await liveWorkspace(page);
  const html = await (await page.request.get("/sensors?lang=en-US")).text();
  await page.route("**/sensors", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html.replace(
        /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
        `$1${JSON.stringify(snapshot).replaceAll("<", "\\u003c")}$2`,
      ),
    }),
  );
  await page.goto("/sensors");
  await page.locator("html.ready").waitFor();
  await expect(page.locator("#registry-list")).toContainText(
    "Temperature: 24.0 °C · Humidity: 60.0 %",
  );
});

test("product accessibility and isolated reference routes", async ({
  page,
}) => {
  await liveWorkspace(page);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  // The reading component still renders custom layouts; check its escaping directly.
  await page.evaluate(() =>
    document.querySelector("#app").append(document.createElement("cj-reading")),
  );
  const tile = page.locator("cj-reading").last();
  await tile.evaluate(
    (el) =>
      (el.data = {
        title: '<img src=x onerror="window.pwned=true">',
        metric: "constructor",
        unit: "<svg>",
        state: "ok",
        value: 0,
      }),
  );
  await expect(tile.locator("img, svg:not(.icon)")).toHaveCount(0);
  await expect(tile.locator(".reading-title")).toHaveText(
    '<img src=x onerror="window.pwned=true">',
  );
  await expect(tile.locator(".reading-tile")).toHaveAttribute(
    "data-kind",
    "device",
  );
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  for (const path of [
    "/design/brand",
    "/design/dashboard",
    "/ui/demo.mjs",
    "/ui/design.mjs",
  ]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
});

test("persistent registration, independent dashboard composition and safe edits", async ({
  page,
  context,
  baseURL,
}) => {
  const { readFile } = await import("node:fs/promises");
  const apiToken = (
    await readFile(
      process.env.CAJUI_UI_API_TOKEN_FILE ?? "/tmp/cajui-ui-token",
      "utf8",
    )
  ).trim();
  const suffix = Date.now().toString(36),
    node = `ui-${suffix}`,
    deviceName = `Station ${suffix}`,
    sensorName = `Ambient ${suffix}`,
    renamed = `Ambient <img> ${suffix}`;
  for (const [metric, value, unit] of [
    ["temperature", 24.5, "degC"],
    ["humidity", 52, "%"],
  ]) {
    const response = await page.request.post("/api/v1/readings", {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        node_id: node,
        sensor_id: "ambient",
        session_id: "ui-test",
        sequence: 0,
        metric,
        value,
        unit,
      },
    });
    expect(response.status()).toBe(201);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 820, height: 1180 });
  // Sensors come with their device: none is listed, and none can be added by hand.
  await page.goto("/sensors");
  await expect(
    page.getByRole("button", { name: "Add sensor", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Edit Temperature and humidity/ }),
  ).toHaveCount(0);
  await page.goto("/devices");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await page
    .getByRole("button", { name: `Select ${node}`, exact: true })
    .click();
  await page.getByRole("textbox", { name: /^Name/ }).fill(deviceName);
  await page.getByLabel("Location", { exact: false }).fill("North");
  await page.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${deviceName}`, exact: true }),
  ).toBeVisible();
  // Once the device was added its sensor is listed with a name from its readings.
  await page.goto("/sensors");
  const row = page.getByRole("row").filter({ hasText: deviceName });
  await expect(row).toContainText("Temperature and humidity");
  await row
    .getByRole("button", { name: "Edit Temperature and humidity", exact: true })
    .click();
  await page.getByRole("textbox", { name: /^Name/ }).fill(sensorName);
  await page.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${sensorName}`, exact: true }),
  ).toBeVisible();
  // The second tab keeps an old revision; its edit must not overwrite the first.
  const other = await context.newPage();
  await other.goto("/sensors");
  await other
    .getByRole("button", { name: `Edit ${sensorName}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: `Edit ${sensorName}`, exact: true })
    .click();
  await page.getByRole("textbox", { name: /^Name/ }).fill(renamed);
  await page.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${renamed}`, exact: true }),
  ).toBeVisible();
  await other.getByRole("textbox", { name: /^Name/ }).fill("Stale edit");
  await other.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(other.getByRole("alert")).toContainText("changed");
  await other.close();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Organize overview", exact: true })
    .click();
  // Start with a deliberately empty composition, preserving all registrations.
  while (
    await page
      .getByRole("button", { name: "Remove section", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Remove section", exact: true })
      .first()
      .click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section title", { exact: true }).fill("Climate");
  await page
    .getByRole("combobox", { name: "Add to this section", exact: true })
    .selectOption({ label: `Sensor · ${renamed} · ${deviceName}` });
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page
    .getByLabel("Section title", { exact: true })
    .last()
    .fill("Equipment");
  await page
    .getByRole("combobox", { name: "Add to this section", exact: true })
    .last()
    .selectOption({ label: `Device · ${deviceName}` });
  await page
    .getByRole("button", { name: "Add item", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Move section 2 up", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save overview", exact: true })
    .click();
  await expect(page.locator(".dashboard-section > h2")).toHaveText([
    "Equipment",
    "Climate",
  ]);
  await expect(page.locator(".sensor-group")).toContainText(renamed);
  await expect(page.locator("cj-reading")).toHaveCount(2);
  await expect(page.locator("#app img")).toHaveCount(0);
  await page.getByRole("button", { name: /Inspect Humidity:/ }).click();
  await expect(page.locator("#history-heading")).toContainText(renamed);
  await page.reload();
  await expect(page.locator(".dashboard-section > h2")).toHaveText([
    "Equipment",
    "Climate",
  ]);
  for (const path of ["/devices", "/sensors", "/"]) {
    await page.goto(path);
    await page.locator("html.ready").waitFor();
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: 1180 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    }
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page
    .getByRole("button", { name: "Organize overview", exact: true })
    .click();
  // Select a single measurement independently of its physical sensor.
  const climate = page.getByRole("group", { name: "Section 2", exact: true });
  await climate
    .getByRole("button", { name: "Remove item 1", exact: true })
    .click();
  await climate
    .getByRole("combobox", { name: "Add to this section", exact: true })
    .selectOption({ label: `Temperature (degC) · ${renamed} · ${deviceName}` });
  await climate.getByRole("button", { name: "Add item", exact: true }).click();
  const editorAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(editorAudit.violations.map((v) => v.id)).toEqual([]);
  await page
    .getByRole("button", { name: "Save overview", exact: true })
    .click();
  await expect(page.locator("cj-reading")).toHaveCount(1);
  await expect(page.locator("cj-reading")).toContainText("Temperature");
  await page
    .getByRole("button", { name: "Organize overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Save overview", exact: true })
    .click();
  await expect(page.locator("cj-reading")).toHaveCount(0);
  await page.goto("/sensors");
  await expect(
    page.getByRole("button", { name: `Edit ${renamed}`, exact: true }),
  ).toBeVisible();
  // Failed saves retain the user's draft rather than reporting success.
  await page
    .getByRole("button", { name: `Edit ${renamed}`, exact: true })
    .click();
  await page.getByRole("textbox", { name: /^Name/ }).fill("Unsaved name");
  await page.route("**/ui-api/sensors/*", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByRole("textbox", { name: /^Name/ })).toHaveValue(
    "Unsaved name",
  );
  expect(errors).toEqual([]);
});

test("language selection persists across navigation and server-rendered pages", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?lang=en-US");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  // The equipment pages are an area of the menu, the broker another.
  await page
    .getByRole("group", { name: "Equipamentos" })
    .getByRole("link", { name: "Transmissores", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transmissores", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Equipamentos" })
      .getByRole("link", { name: "Transmissores", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("group", { name: "Sistema" }).getByRole("link"),
  ).toHaveText(["Broker MQTT"]);
  await page
    .getByRole("button", { name: "Adicionar transmissor", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Adicionar transmissor");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Sensores", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sensores", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Buscar sensores" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Idioma", exact: true }),
  ).toHaveValue("pt-BR");
  const response = await page.request.get("/");
  expect(response.headers()["content-language"]).toBe("pt-BR");
  expect(await response.text()).toContain("Leituras recebidas");
  await page
    .getByRole("combobox", { name: "Idioma", exact: true })
    .selectOption("en-US");
  await expect(
    page.getByRole("heading", { name: "Sensors", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const language of ["pt-BR", "en-US"]) {
  test(`localized readings, chart, editor and tablet layout ${language}`, async ({
    page,
  }) => {
    const pt = language === "pt-BR";
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 820, height: 1180 });
    await liveWorkspace(page, language);
    await expect(page.locator(".row-title").first()).toHaveText(
      pt ? "Temperatura" : "Temperature",
    );
    await expect(page.locator(".row-sub").first()).toHaveText("Sensor 1");
    await expect(page.locator("#summary")).toContainText(
      pt ? "1 transmissor" : "1 device",
    );
    await page.locator(".reading-button").first().click();
    await expect(page.locator("#history-heading")).toHaveText("Sensor 1");
    await expect(page.locator("#history svg.plot")).toHaveAttribute(
      "aria-label",
      pt ? /4 observações/ : /4 observations/,
    );
    await page.locator("#history summary").click();
    await expect(page.locator("#history table th").first()).toHaveText(
      pt ? "Recebido no Central" : "Received at Central",
    );
    await page
      .getByRole("button", {
        name: pt ? "Fechar histórico" : "Close history",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: pt ? "Organizar visão geral" : "Organize overview",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      pt ? "Título da seção" : "Section title",
    );
    await page
      .getByRole("button", { name: pt ? "Cancelar" : "Cancel", exact: true })
      .click();
    // Native input attributes remain protocol-neutral when visible text changes.
    await page.evaluate(async () => {
      const device = document.createElement("cj-device");
      device.setAttribute("battery", "72");
      device.setAttribute("signal", "-85");
      document.querySelector("#app").append(device);
    });
    await expect(page.locator("cj-device cj-battery")).toContainText("72%");
    await expect(page.locator("cj-device cj-signal")).toContainText("-85 dBm");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  });
}

test("Portuguese registration keeps typed names and translates save failures", async ({
  page,
}) => {
  // Read-only UI fixture: no changes to the service's persisted inventory.
  const response = await page.request.get("/devices?lang=pt-BR");
  const html = await response.text();
  const state = JSON.parse(
    html.match(
      /<script type="application\/json" id="initial-state">([\s\S]*?)<\/script>/,
    )[1],
  );
  state.workspace.devices = [
    {
      id: 1,
      transport: "mqtt",
      source: "receiver",
      device: "temperature",
      name: "",
      location: "",
      revision: 0,
      received_at: state.generated_at,
      interval: 300,
    },
  ];
  state.workspace.sensors = [];
  const fixture = html.replace(
    /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
    `$1${JSON.stringify(state).replaceAll("<", "\\u003c")}$2`,
  );
  await page.route("**/devices", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await page.route("**/ui-api/devices/1", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/devices");
  await page
    .getByRole("button", { name: "Adicionar transmissor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Selecionar temperature", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Nome", exact: true })
    .fill("Temperature <custom>");
  await page
    .getByRole("button", { name: "Salvar transmissor", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Estas configurações mudaram",
  );
  await expect(
    page.getByRole("textbox", { name: "Nome", exact: true }),
  ).toHaveValue("Temperature <custom>");
});

// A receiver that pairs by radio, and the devices page following it live.
async function liveDevices(page, snapshot) {
  const html = await (await page.request.get("/devices?lang=en-US")).text();
  const serve = (state) => {
    const json = JSON.stringify(state).replaceAll("<", "\\u003c");
    return page.route("**/devices", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: html.replace(
          /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
          `$1${json}$2`,
        ),
      }),
    );
  };
  await serve(snapshot);
  await page.goto("/devices");
  await page.locator("html.ready").waitFor();
  return serve;
}
function pairingSnapshot() {
  const now = new Date().toISOString();
  return {
    locale: "en-US",
    ui_token: "test",
    generated_at: now,
    readings: [],
    samples: [],
    devices: [],
    device_states: [
      {
        source_id: "site",
        device_id: "0000aa000000a001",
        role: "receiver",
        retained: false,
        availability: "online",
        capabilities: ["pairing", "revoke"],
        received_at: now,
        pairing: { open: false, requests: [] },
      },
    ],
    workspace: {
      devices: [],
      sensors: [],
      layout: { revision: 0, sections: null },
    },
  };
}
test("one dialog pairs a transmitter by radio and names it as it appears", async ({
  page,
}) => {
  await page.clock.install();
  const state = pairingSnapshot();
  const serve = await liveDevices(page, state);
  await page.route("**/ui-api/commands", (route) => {
    const type = JSON.parse(route.request().postData()).type;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        command_id: type === "pairing.accept" ? "c2" : "c1",
        status: type === "pairing.accept" ? "pending" : "applied",
        type,
      }),
    });
  });
  await page.route("**/ui-api/commands/c2", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        command_id: "c2",
        status: "applied",
        type: "pairing.accept",
      }),
    }),
  );
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Pair a transmitter" }),
  ).toBeVisible();
  await expect(dialog).toContainText("hold the PRG button");
  await expect(dialog).not.toContainText("No new devices detected");
  const receiver = state.device_states[0];
  receiver.pairing = {
    open: true,
    remaining_s: 120,
    requests: [{ node_id: "0000aa000000b002", rssi_dbm: -60, conflict: false }],
  };
  await serve(state);
  await dialog
    .getByRole("button", { name: "Search for transmitters", exact: true })
    .click();
  // The notice sits in the top layer, above the modal's backdrop.
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#toast")).toHaveText(
    "Search started for two minutes.",
  );
  await expect(
    dialog.getByRole("heading", { name: "Searching for transmitters" }),
  ).toBeVisible();
  await expect(dialog).toContainText("2:00 left");
  const request = dialog.locator(".pairing-item");
  await expect(request).toContainText("New transmitter");
  await expect(request).toContainText("ID B002 · Signal -60 dBm");
  await request.getByRole("button", { name: "Add", exact: true }).click();
  await expect(request).toContainText("waiting for the transmitter to confirm");
  await expect(request.getByRole("button")).toHaveCount(0);
  receiver.pairing = { open: false, requests: [] };
  state.device_states.push({
    source_id: "site",
    device_id: "0000aa000000b002",
    role: "transmitter",
    receiver_id: receiver.device_id,
    binding: "pending",
    received_at: state.generated_at,
  });
  await serve(state);
  await page.clock.fastForward(1100);
  await expect(dialog.locator(".pairing-item")).toContainText(
    "Paired. Waiting for its first reading…",
  );
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "",
    location: "",
    revision: 0,
    received_at: state.generated_at,
    interval: 300,
  });
  await serve(state);
  await page.clock.fastForward(3100);
  await expect(dialog.locator(".pairing-item")).toContainText(
    "Paired and sending readings. Give it a name.",
  );
  await expect(dialog).not.toContainText("Give it a name</h3>");
  await dialog.getByRole("button", { name: "Name it", exact: true }).click();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("revocation lives with the device name, not on the dashboard", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states.push({
    source_id: "site",
    device_id: "0000aa000000b002",
    role: "transmitter",
    receiver_id: "0000aa000000a001",
    binding: "active",
    received_at: state.generated_at,
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row).toContainText("Receiver A001");
  await expect(row.locator('td[data-label="Battery"]')).toHaveText(
    "Not reported",
  );
  const edit = page.getByRole("button", { name: "Edit Coop", exact: true });
  const box = await edit.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(
    row.getByRole("button", { name: "Revoke transmitter", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Remove Coop from the list", exact: true }),
  ).toBeVisible();
  await edit.click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Revoke transmitter", exact: true }),
  ).toBeVisible();
  const home = await (await page.request.get("/?lang=en-US")).text();
  await page.route("**/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: home.replace(
        /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
        `$1${JSON.stringify(state).replaceAll("<", "\\u003c")}$2`,
      ),
    }),
  );
  await page.goto("/");
  // A healthy receiver is not listed on the overview; only problems are.
  await expect(page.locator("#summary")).toContainText(/\d+ devices?/);
  await expect(page.locator("#attention")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Search for transmitters" }),
  ).toHaveCount(0);
});

test("receivers have their own page and one status line on the dashboard", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states[0].queue = { depth: 0, capacity: 128 };
  state.device_states[0].firmware = { version: "1.2.0", state: "valid" };
  const inject = async (path, snapshot) => {
    const html = await (await page.request.get(`${path}?lang=en-US`)).text();
    await page.route(`**${path}`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: html.replace(
          /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
          `$1${JSON.stringify(snapshot).replaceAll("<", "\\u003c")}$2`,
        ),
      }),
    );
  };
  await inject("/receivers", state);
  await page.goto("/receivers");
  await expect(
    page.getByRole("heading", { name: "Receivers", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Receivers" }).first(),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".receiver-card")).toContainText("Receiver A001");
  await expect(page.locator(".receiver-card")).toContainText("0 of 128");
  let removal = null;
  await page.route(
    "**/ui-api/receivers/site/0000aa000000a001/archive",
    (route) => {
      removal = JSON.parse(route.request().postData());
      return route.fulfill({ status: 204 });
    },
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Remove Receiver A001 from the list",
      exact: true,
    })
    .click();
  await expect(page.locator("#toast")).toContainText("removed from the list");
  expect(removal).toEqual({ received_at: state.device_states[0].received_at });
  const offline = structuredClone(state);
  offline.device_states[0].availability = "offline";
  await inject("/", offline);
  await page.goto("/");
  const line = page.locator("#attention li");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Receiver A001 offline");
  await expect(line).toContainText("No device depends on it right now.");
  await expect(line.locator('a[href="/receivers"]')).toHaveCount(1);
  await expect(page.locator(".receiver-card")).toHaveCount(0);
  const empty = pairingSnapshot();
  empty.device_states = [];
  await inject("/receivers", empty);
  await page.goto("/receivers");
  await expect(page.getByText("No receivers yet")).toBeVisible();
});

test("device health shows current, old and failed diagnostics honestly", async ({
  page,
}) => {
  const state = pairingSnapshot();
  const at = new Date(Date.now() - 60000).toISOString();
  state.samples.push({
    source_id: "site",
    device_id: "0000aa000000b002",
    sample_id: "s1",
    received_at: at,
    expected_interval_seconds: 300,
    readings: [
      {
        sensor_id: "battery",
        metric: "voltage",
        unit: "V",
        value: 4.12,
        status: "ok",
      },
      {
        sensor_id: "radio",
        metric: "rssi",
        unit: "dBm",
        value: -71,
        status: "ok",
      },
      {
        sensor_id: "radio",
        metric: "snr",
        unit: "dB",
        value: 9.5,
        status: "ok",
      },
      {
        sensor_id: "soil",
        metric: "voltage",
        unit: "V",
        value: 1.5,
        status: "ok",
      },
    ],
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: at,
    interval: 300,
  });
  await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row.locator('td[data-label="Battery"]')).toHaveText("4.12 V");
  await expect(row.locator('td[data-label="Signal"]')).toHaveText(
    "-71 dBm · SNR 9.5 dB",
  );
  state.samples[0].readings[0].status = "error";
  state.samples[0].readings[0].value = null;
  await liveDevices(page, state);
  await expect(row.locator('td[data-label="Battery"]')).not.toHaveText(
    "Not reported",
  );
  await expect(row.locator('td[data-label="Battery"]')).not.toContainText(
    "1.5",
  );
});

test("the theme follows the system until one is chosen", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/devices");
  await page.locator("html.ready").waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a known transmitter asking again shows its name, not a new device", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states[0].pairing = {
    open: true,
    remaining_s: 90,
    requests: [{ node_id: "0000aa000000b002", rssi_dbm: -82, conflict: false }],
  };
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  await liveDevices(page, state);
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const request = dialog.locator(".pairing-item");
  await expect(request).toContainText("Coop");
  await expect(request).toContainText("Already paired");
  await expect(request).not.toContainText("New transmitter");
  state.device_states[0].availability = "offline";
  await liveDevices(page, state);
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Receiver offline" }),
  ).toBeVisible();
  await expect(dialog.locator(".pairing-item")).toHaveCount(0);
});

test("a revoked transmitter says so instead of offering Revoke", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states.push({
    source_id: "site",
    device_id: "0000aa000000b002",
    role: "transmitter",
    receiver_id: "0000aa000000a001",
    binding: "revoked",
    received_at: state.generated_at,
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "0000aa000000b002",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  const serve = await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row.locator('td[data-label="Receiver"]')).toHaveText(
    "Receiver A001 · Revoked",
  );
  const section = page.getByRole("region", { name: "Revoked" });
  await expect(
    section.getByRole("row").filter({ hasText: "Coop" }),
  ).toHaveCount(1);
  await expect(row.locator('td[data-label="Status"]')).toHaveText("Revoked");
  await page.getByRole("button", { name: "Edit Coop", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Revoked: the receiver");
  await expect(
    page.getByRole("button", { name: "Revoke transmitter" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Pair Coop again", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Pair a transmitter");
  await page.keyboard.press("Escape");
  let archived = null;
  await page.route("**/ui-api/devices/7/archive", (route) => {
    archived = JSON.parse(route.request().postData());
    return route.fulfill({ status: 204 });
  });
  page.once("dialog", (d) => d.accept());
  const gone = structuredClone(state);
  gone.workspace.devices = [];
  await serve(gone);
  await page
    .getByRole("button", { name: "Remove Coop from the list", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText(
    "Coop removed from the list.",
  );
  expect(archived).toEqual({ revision: 1 });
  await expect(page.getByRole("region", { name: "Revoked" })).toHaveCount(0);
});
test("a revoked transmitter leaves the dashboard", async ({ page }) => {
  const { snapshot, serve } = await liveWorkspace(page);
  snapshot.device_states = [
    {
      source_id: "receiver",
      device_id: "device-1",
      role: "transmitter",
      receiver_id: "0000aa000000a001",
      binding: "revoked",
      received_at: snapshot.generated_at,
    },
  ];
  await serve(snapshot);
  await page.goto("/");
  await expect(page.locator(".place")).toHaveCount(0);
  await expect(page.locator("#summary")).toContainText("0 devices");
  await expect(
    page.getByText("No matching items in this section."),
  ).toHaveCount(0);
  await expect(page.locator("#devices .empty")).toBeVisible();
});

function brokerFixture() {
  return {
    configured: true,
    connected: true,
    host: "broker",
    port: 1883,
    username: "central",
    client_id: "test",
    topics: ["telemetry/v1/+/+/samples"],
    total: 2,
    rejected: 1,
    limit: 100,
    receiver_host: "192.168.1.10",
    receiver_port: 1883,
    receiver_username: "receiver-1",
    credentials_available: true,
    messages: [
      {
        id: 2,
        at: new Date().toISOString(),
        topic: "telemetry/v1/demo/device/samples",
        source: "demo",
        device: "device",
        status: "accepted",
        bytes: 40,
        payload: { text: "<script>bad()</script>", value: 24 },
      },
      {
        id: 1,
        at: new Date().toISOString(),
        topic: "manage/v1/other/device/state",
        source: "other",
        device: "device",
        status: "rejected",
        retained: true,
        bytes: 10,
      },
    ],
  };
}
test("broker viewer filters normalized JSON and fits a tablet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const broker = brokerFixture();
  await page.route("**/ui-api/broker", (r) => r.fulfill({ json: broker }));
  await page.goto("/broker?lang=en-US");
  await expect(page.locator(".broker-message")).toHaveCount(2);
  await page.locator(".broker-message button").first().click();
  await expect(page.locator(".broker-detail:not([hidden]) pre")).toContainText(
    "<script>bad()</script>",
  );
  const original = await page
    .locator(".broker-detail:not([hidden]) pre")
    .elementHandle();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(
      document.querySelector(".broker-detail:not([hidden]) pre"),
    );
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const selected = await page.evaluate(() => getSelection().toString());
  broker.messages.unshift({
    ...broker.messages[0],
    id: 3,
    device: "new-device",
  });
  const refreshed = page.waitForResponse((r) =>
    r.url().endsWith("/ui-api/broker"),
  );
  await page.evaluate(() => document.querySelector("#broker-refresh").click());
  await refreshed;
  await expect(page.locator(".broker-message")).toHaveCount(3);
  expect(await original.evaluate((el) => el.isConnected)).toBeTruthy();
  expect(await page.evaluate(() => getSelection().toString())).toBe(selected);
  await expect(
    page.locator('.broker-message button[aria-expanded="true"]'),
  ).toHaveCount(1);
  await expect(page.locator(".broker-message time").first()).toHaveText(
    /\d{2}:\d{2}:\d{2}/,
  );
  await page.locator("#broker-search").fill("other");
  await expect(page.locator(".broker-message")).toHaveCount(1);
  await page.locator("#broker-status").selectOption("accepted");
  await expect(page.locator(".broker-message")).toHaveCount(0);
  await page.locator("#broker-search").fill("");
  await expect(page.locator(".broker-message")).toHaveCount(2);
  await page.locator("#broker-pause").click();
  await expect(page.locator("#broker-pause")).toHaveText("Resume");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/cajui-broker-tablet.png",
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
});
test("receiver wizard retrieves secrets explicitly and waits for new connections without typing an identifier", async ({
  page,
}) => {
  let credentials = 0,
    snapshots = 0;
  await page.route("**/ui-api/broker", (r) =>
    r.fulfill({ json: brokerFixture() }),
  );
  await page.route("**/ui-api/receiver-credentials", (r) => {
    credentials++;
    return r.fulfill({
      json: { username: "receiver-1", password: "fixture-secret" },
    });
  });
  const state = pairingSnapshot();
  state.device_states.push({
    ...state.device_states[0],
    device_id: "0000aa000000c003",
  });
  state.device_states[0].availability = "offline";
  state.device_states[0].received_at = "2020-01-01T00:00:00Z";
  await page.route("**/ui-api/receiver-states", (r) => {
    snapshots++;
    return r.fulfill({
      json: {
        generated_at: state.generated_at,
        device_states: state.device_states,
      },
    });
  });
  const html = await (await page.request.get("/receivers?lang=en-US")).text();
  await page.route("**/receivers", (r) => {
    return r.fulfill({
      contentType: "text/html",
      body: html.replace(
        /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
        () =>
          '<script type="application/json" id="initial-state">' +
          JSON.stringify(state) +
          "</script>",
      ),
    });
  });
  await page.goto("/receivers");
  await page.getByRole("button", { name: "Add receiver", exact: true }).click();
  await expect(page.locator("#receiver-step-title")).toHaveText(
    "Connect to receiver",
  );
  await expect(page.locator("#receiver-values")).toHaveCount(0);
  await page.locator("#setup-next").click();
  await expect(page.locator("#receiver-show")).toBeVisible();
  await expect(page.locator("#receiver-values input")).toHaveCount(0);
  expect(credentials).toBe(0);
  expect(await page.content()).not.toContain("fixture-secret");
  await page.locator("#receiver-show").click();
  await expect(page.locator("#receiver-values")).toContainText(
    "fixture-secret",
  );
  await page.locator("#receiver-show").click();
  expect(await page.locator("#receiver-values").innerText()).not.toContain(
    "fixture-secret",
  );
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/cajui-wizard-mobile.png",
    fullPage: true,
  });
  await page.locator("#setup-back").click();
  await expect(page.locator("#receiver-step-title")).toHaveText(
    "Connect to receiver",
  );
  await page.locator("#setup-next").click();
  expect(await page.locator("#receiver-values").innerText()).not.toContain(
    "fixture-secret",
  );
  expect(credentials).toBe(1);
  await expect(page.locator('[name="suffix"]')).toHaveCount(0);
  await page.locator("#setup-next").click();
  await expect.poll(() => snapshots).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#setup-result button")).toHaveCount(0);
  state.device_states[0].availability = "online";
  state.device_states[1].received_at = new Date(
    Date.now() + 1000,
  ).toISOString();
  state.device_states[0].received_at = new Date(
    Date.now() + 1000,
  ).toISOString();
  state.device_states[0].retained = true;
  const previous = snapshots;
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(page.locator("#setup-result button")).toHaveCount(0);
  state.device_states[0].retained = false;
  await expect(page.locator("#setup-result button")).toBeVisible({
    timeout: 10000,
  });
  const second = { ...state.device_states[0], device_id: "0000aa000000d004" };
  state.device_states.push(second);
  await expect(page.locator("#setup-result button")).toHaveCount(2);
  await expect(page.locator("#setup-result")).toContainText(
    "More than one receiver connected",
  );
  expect(await page.locator("#setup-result").innerText()).not.toContain("C003");
  second.availability = "offline";
  await expect(page.locator("#setup-result button")).toHaveCount(1);
  await page.locator("#setup-result button").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.content()).not.toContain("fixture-secret");
});

test("receiver setup asks for a missing address only in the details step", async ({
  page,
}) => {
  await page.route("**/ui-api/broker", (r) =>
    r.fulfill({
      json: {
        ...brokerFixture(),
        receiver_host: "",
        credentials_available: false,
      },
    }),
  );
  await page.goto("/receivers?lang=pt-BR&setup=1");
  await expect(page.locator("#receiver-step-title")).toHaveText(
    "Conectar ao receptor",
  );
  await page.locator("#setup-next").click();
  await expect(page.locator(".receiver-address")).toHaveAttribute("open", "");
  await page.locator("#setup-next").click();
  await expect(page.locator("#setup-error")).not.toBeEmpty();
  await page.locator('[name="host"]').fill("localhost");
  await page.locator('#receiver-address-form [type="submit"]').click();
  await expect(page.locator("#receiver-step-title")).toHaveText(
    "Dados de conexão",
  );
  await page.locator('[name="host"]').fill("192.168.1.20");
  await page.locator('#receiver-address-form [type="submit"]').click();
  await expect(page.locator("#receiver-values")).toContainText("192.168.1.20");
  await expect(page.locator(".receiver-address")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator("#setup-next").click();
  await expect(page.locator("#receiver-step-title")).toHaveText(
    "Encontrar receptor",
  );
});

test("receiver setup consumes its URL trigger and prevents duplicate dialogs", async ({
  page,
}) => {
  await page.route("**/ui-api/broker", (r) =>
    r.fulfill({ json: brokerFixture() }),
  );
  await page.goto("/receivers?lang=en-US&setup=1");
  await expect(page.locator("dialog.receiver-wizard")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has("setup")).toBeFalsy();
  await page.locator("#add-receiver").evaluate((el) => {
    el.click();
    el.click();
  });
  await expect(page.locator("dialog.receiver-wizard")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.locator("html.ready")).toBeVisible();
  await expect(page.locator("dialog")).toHaveCount(0);
});
test("HTTP devices do not offer radio revocation", async ({ page }) => {
  const state = pairingSnapshot();
  state.workspace.devices = [
    {
      id: 1,
      transport: "http",
      source: "http",
      device: "http-device",
      name: "HTTP device",
      location: "",
      revision: 0,
    },
  ];
  await liveDevices(page, state);
  await expect(
    page.getByRole("button", { name: /Revoke transmitter/ }),
  ).toHaveCount(0);
});

for (const path of ["/receivers", "/"]) {
  test(`connection status follows SSE without page refresh on ${path}`, async ({
    page,
  }) => {
    const snapshot = pairingSnapshot();
    snapshot.device_states[0].availability = "offline";
    let pageLoads = 0;
    const html = await (await page.request.get(`${path}?lang=en-US`)).text();
    await page.route(`**${path}`, (route) => {
      pageLoads++;
      return route.fulfill({
        contentType: "text/html",
        body: html.replace(
          /(<script type="application\/json" id="initial-state">)[\s\S]*?(<\/script>)/,
          `$1${JSON.stringify(snapshot).replaceAll("<", "\\u003c")}$2`,
        ),
      });
    });
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      window.fetch = (url, options) => {
        if (url !== "/ui-api/device-states/events")
          return realFetch(url, options);
        window.stateStreamConnections =
          (window.stateStreamConnections ?? 0) + 1;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                window.pushState = (value) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      `event: states\ndata: ${JSON.stringify(value)}\n\n`,
                    ),
                  );
                window.breakStateStream = () =>
                  controller.error(new Error("lost connection"));
                options.signal.addEventListener("abort", () => {
                  try {
                    controller.close();
                  } catch {}
                });
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      };
    });
    await page.goto(path);
    // The overview lists an offline receiver as a problem and drops it once it is back.
    const indicator = page
      .locator(path === "/" ? "#attention" : ".receiver-card")
      .first();
    const offline = () =>
      expect(indicator).toContainText(
        path === "/" ? "Receiver A001 offline" : "Offline",
      );
    const online = () =>
      path === "/"
        ? expect(indicator).toBeHidden()
        : expect(indicator).toContainText("Online");
    await offline();
    await page.waitForFunction(() => typeof window.pushState === "function");
    snapshot.device_states[0].availability = "online";
    snapshot.generated_at = new Date(Date.now() + 1000).toISOString();
    await page.evaluate((value) => window.pushState(value), snapshot);
    await online();
    snapshot.device_states[0].availability = "offline";
    snapshot.generated_at = new Date(Date.now() + 2000).toISOString();
    await page.evaluate((value) => window.pushState(value), snapshot);
    await offline();
    // The fallback reads only states, then the stream reconnects automatically.
    snapshot.device_states[0].availability = "online";
    snapshot.generated_at = new Date(Date.now() + 3000).toISOString();
    await page.route("**/ui-api/device-states", (route) =>
      route.fulfill({ json: snapshot }),
    );
    await page.evaluate(() => window.breakStateStream());
    await online();
    await expect
      .poll(() => page.evaluate(() => window.stateStreamConnections))
      .toBe(2);
    expect(pageLoads).toBe(1);
  });
}

test("history dialogs isolate sensor and device diagnostics and restore focus", async ({
  page,
}) => {
  const { snapshot, serve } = await liveWorkspace(page);
  const battery = {
    sensor_id: "battery",
    metric: "voltage",
    unit: "V",
    value: 3.8,
    status: "ok",
  };
  snapshot.samples[0].readings.push(battery);
  const extra = {
    sensor_id: "sensor-2",
    metric: "temperature",
    unit: "degC",
    value: 19,
    status: "ok",
  };
  snapshot.samples[0].readings.push(extra);
  snapshot.workspace.sensors.push({
    id: 3,
    device_id: 1,
    sensor: "sensor-2",
    name: "Other sensor",
    location: "",
    revision: 1,
    measurements: [
      { ...extra, received_at: snapshot.samples[0].received_at, interval: 300 },
    ],
  });
  const secondSample = structuredClone(snapshot.samples[0]);
  secondSample.device_id = "device-2";
  snapshot.samples.push(secondSample);
  snapshot.workspace.devices.push({
    ...snapshot.workspace.devices[0],
    id: 2,
    device: "device-2",
    name: "Device 2",
  });
  snapshot.workspace.sensors.push({
    ...snapshot.workspace.sensors[0],
    id: 4,
    device_id: 2,
    name: "Second device sensor",
  });
  await serve(snapshot);
  await page.reload();
  await page.locator("html.ready").waitFor();
  const opener = page.locator(".reading-button").first();
  await opener.click();
  const dialog = page.locator("#history-panel");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(dialog).toHaveAttribute(
    "aria-labelledby",
    "history-heading history-accessible",
  );
  await expect(page.locator("#metric-select option")).toHaveText([
    "Temperature · °C",
    "Humidity · %",
  ]);
  await expect(page.locator("#history-heading")).toContainText("Sensor 1");
  await page.locator("#metric-select").selectOption({ label: "Humidity · %" });
  await expect(page.locator("#history-heading")).toHaveText("Sensor 1");
  await page.locator("#period").selectOption("0");
  await expect(page.locator("#history-value")).not.toHaveText("");
  const controls = await page
    .locator(".history-controls select")
    .evaluateAll((els) =>
      els.map((el) => ({
        top: el.getBoundingClientRect().top,
        height: el.getBoundingClientRect().height,
      })),
    );
  expect(controls[0]).toEqual(controls[1]);
  const slider = page.locator("#history input[type=range]");
  await slider.focus();
  await page.keyboard.press("Home");
  const cursor = page.locator("#history .cursor");
  await expect(cursor).toHaveAttribute("x1", "0");
  await page.keyboard.press("End");
  await expect(cursor).not.toHaveAttribute("x1", "0");
  const plot = page.locator("#history svg");
  await plot.click({ position: { x: 64, y: 40 } });
  await expect(cursor).toHaveAttribute("x1", "0");
  await expect(page.locator("#history .selected-point")).toBeVisible();
  const violations = await new AxeBuilder({ page }).analyze();
  expect(violations.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  const details = page.getByRole("button", {
    name: "Details for Device 1",
    exact: true,
  });
  await details.click();
  await page
    .getByRole("button", {
      name: "Inspect Battery history for Device 1",
      exact: true,
    })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(page.locator("#history-context")).toContainText("Device 1");
  const labels = await page.locator("#metric-select option").allTextContents();
  expect(labels.sort()).toEqual([
    "Battery · V",
    "Signal strength (RSSI) · dBm",
    "Signal-to-noise ratio (SNR) · dB",
  ]);
  await page
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(details).toBeFocused();
  await page.locator(".reading-button").nth(2).click();
  await expect(page.locator("#metric-select option")).toHaveCount(1);
  await expect(page.locator("#history-heading")).toContainText("Other sensor");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
});

test("history receipt times use the browser zone independently of UI language", async ({
  browser,
}) => {
  for (const [timezoneId, time] of [
    ["Asia/Tokyo", "21:00:00"],
    ["UTC", "12:00:00"],
  ]) {
    const context = await browser.newContext({ timezoneId });
    try {
      const page = await context.newPage();
      const { snapshot, serve } = await liveWorkspace(page, "pt-BR");
      const next = structuredClone(snapshot);
      next.generated_at = "2026-10-06T12:01:00Z";
      next.samples.forEach((sample, index) => {
        sample.received_at =
          index === 0 ? "2026-10-06T12:00:00Z" : "2026-10-06T11:00:00Z";
      });
      for (const sensor of next.workspace.sensors)
        for (const measurement of sensor.measurements)
          measurement.received_at = "2026-10-06T12:00:00Z";
      await serve(next);
      await page.reload();
      await page.locator(".reading-button").first().click();
      await page.locator("#history summary").click();
      await expect(page.locator("#history tbody tr").first()).toContainText(
        time,
      );
      await expect(page.locator("#history th").first()).toHaveText(
        "Recebido no Central",
      );
    } finally {
      await context.close();
    }
  }
});

test("chart refresh follows latest until explicit inspection and preserves slider focus", async ({
  page,
}) => {
  await liveWorkspace(page);
  await page.locator(".reading-button").first().click();
  const chart = page.locator("#history");
  const slider = chart.locator("input[type=range]");
  const append = () =>
    chart.evaluate((el) => {
      const points = [
        ...el.data.points,
        { time: el.data.points.at(-1).time + 60000, value: 27 },
      ];
      el.data = { ...el.data, points };
    });
  await slider.focus();
  await append();
  await expect(slider).toBeFocused();
  expect(await slider.inputValue()).toBe(await slider.getAttribute("max"));
  await page.keyboard.press("Home");
  const pinned = await chart.locator(".chart-selection").textContent();
  await append();
  await expect(slider).toBeFocused();
  await expect(chart.locator(".chart-selection")).toHaveText(pinned);
  await chart.locator("summary").click();
  await page.keyboard.press("Escape");
  await page.locator(".reading-button").first().click();
  await expect(chart.locator("details")).not.toHaveAttribute("open", "");
  expect(await slider.inputValue()).toBe(await slider.getAttribute("max"));
  await slider.focus();
  await page.keyboard.press("Home");
  await chart.locator("summary").click();
  await page.locator("#metric-select").selectOption({ label: "Humidity · %" });
  await expect(chart.locator("details")).not.toHaveAttribute("open", "");
  expect(await slider.inputValue()).toBe(await slider.getAttribute("max"));
});

test("focused history selector keeps receiving fresh readings and exposes channel state", async ({
  page,
}) => {
  await page.clock.install();
  const { snapshot, serve } = await liveWorkspace(page);
  await page.locator(".reading-button").first().click();
  await page.locator("#metric-select").focus();
  const next = structuredClone(snapshot);
  next.samples[0].readings[0].status = "error";
  next.workspace.sensors[0].measurements[0].status = "error";
  await serve(next);
  await page.clock.fastForward(31000);
  await expect(page.locator("#metric-select")).toBeFocused();
  await expect(page.locator("#history-value")).toContainText("—");
  await expect(page.locator("#history-state")).toHaveAttribute(
    "state",
    "error",
  );
  await expect(page.locator("#history-state")).toContainText("Reading error");
  await expect(page.locator("#history-panel")).toHaveAccessibleName(
    /Sensor 1.*Temperature history.*Device 1.*receiver/,
  );
});

test("the overview shows names as text and trends of the last hours", async ({
  page,
}) => {
  const { snapshot, serve } = await liveWorkspace(page);
  const markup = '<img src=x onerror="window.injected=1">';
  snapshot.workspace.devices[0].name = `Coop ${markup}`;
  snapshot.workspace.devices[0].location = `Yard ${markup}`;
  snapshot.workspace.sensors[0].name = `Probe ${markup}`;
  // A reading older than the trend window stays in history but not in the trend.
  const old = structuredClone(snapshot.samples[0]);
  old.sample_id = "sample-old";
  old.received_at = new Date(Date.now() - 5 * 3600000).toISOString();
  snapshot.samples.push(old);
  await serve(snapshot);
  await page.goto("/");
  const place = page.locator(".place");
  await expect(place.locator("h3")).toHaveText(`Coop ${markup}`);
  await expect(place.locator(".place-head p")).toContainText(`Yard ${markup}`);
  await expect(place.locator(".row-sub").first()).toHaveText(`Probe ${markup}`);
  await expect(page.locator(".place img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  // The newest of the loaded readings is 16 minutes old: the trend starts near its end.
  const path = await place.locator(".row-trend path").first().getAttribute("d");
  expect(Number(path.match(/^M([\d.]+),/)[1])).toBeGreaterThan(80);
});

test("a saved layout keeps its search and a filter that matches the attention list", async ({
  page,
}) => {
  const { snapshot, serve } = await liveWorkspace(page);
  snapshot.samples[0].readings.push({
    sensor_id: "battery",
    metric: "voltage",
    unit: "V",
    value: 3.35,
    status: "ok",
  });
  snapshot.workspace.layout.sections = [
    { title: "Climate", items: [{ kind: "sensor", sensor_id: 1 }] },
  ];
  await serve(snapshot);
  await page.goto("/");
  await expect(page.locator("#attention")).toContainText(
    "Device 1: battery at 3.35 V",
  );
  await expect(page.locator("#toolbar")).toBeVisible();
  await page.getByRole("searchbox").fill("Humidity");
  await expect(page.locator(".reading-button")).toHaveCount(2);
  await page.getByRole("searchbox").fill("no such sensor");
  await expect(page.locator(".reading-button")).toHaveCount(0);
  await page.getByRole("searchbox").fill("");
  // A low battery needs attention, so the filter keeps its device.
  await page.locator('[data-filter="attention"]').click();
  await expect(page.locator(".reading-button")).toHaveCount(2);
});

test("normal readings stay quiet and an offline receiver is counted apart", async ({
  page,
}) => {
  const { snapshot, serve } = await liveWorkspace(page);
  await expect(page.locator(".reading-button")).toHaveCount(2);
  await expect(page.locator(".reading-button .badge")).toHaveCount(0);
  await expect(page.locator(".place-head p")).toContainText("Last reading:");
  snapshot.device_states = [
    {
      source_id: "receiver",
      device_id: "0000aa000000a001",
      role: "receiver",
      availability: "offline",
      received_at: snapshot.generated_at,
    },
    {
      source_id: "receiver",
      device_id: "device-1",
      role: "transmitter",
      receiver_id: "0000aa000000a001",
      binding: "active",
      received_at: snapshot.generated_at,
    },
  ];
  await serve(snapshot);
  await page.goto("/");
  // The transmitter behind it is the receiver's problem, counted once.
  const summary = page.locator("#summary");
  await expect(summary).toContainText("1 problem");
  await expect(summary.locator('.badge[data-state="network"]')).toHaveCount(1);
  await expect(summary.locator('.badge[data-state="warning"]')).toHaveCount(0);
  await expect(page.locator("#attention")).toContainText(
    "Receiver A001 offline",
  );
  // Its place says why it is quiet, with the network shape.
  await expect(
    page.locator('.place-notes .badge[data-state="network"]'),
  ).toHaveCount(1);
});
