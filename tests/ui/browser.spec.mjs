import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
const referenceURL = "http://127.0.0.1:8092";

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
  await expect(page.locator("#contrast-audit tr")).toHaveCount(11);
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
    page.getByRole("heading", { name: "Dashboard", exact: true }),
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
  await expect(page.locator("#chart-legend")).toContainText("Humidity");
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
  await expect(card.locator(".badge svg")).toHaveCount(1);
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
  const reading = page.getByRole("button", { name: /Inspect Humidity:/ });
  await reading.click();
  await expect(page.locator("#history-heading")).toBeFocused();
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
    await expect(page.locator(".dashboard-item")).toHaveCount(2);
    await expect(page.locator(".sensor-group")).toHaveCount(1);
    await expect(page.locator(".reading-button")).toHaveCount(2);
    await expect(page.locator("#summary")).toContainText(
      "1 device / 1 sensor / 2 measurements",
    );
    await expect(page.locator('a[href^="/design/"]')).toHaveCount(0);
    await expect(page.locator(".diagnostic-button").first()).not.toBeVisible();
    await expect(page.locator("#history-panel")).not.toBeVisible();
    await page.getByRole("button", { name: /Inspect Humidity:/ }).click();
    await expect(page.locator("#history-heading")).toBeFocused();
    await expect(page.locator("#chart-legend")).toContainText("Humidity");
    await page
      .getByRole("button", { name: "Details for Device 1", exact: true })
      .click();
    await expect(page.locator(".diagnostic-button")).toHaveCount(2);
    await page.getByRole("button", { name: /Inspect RSSI history/ }).click();
    await expect(page.locator("#chart-legend")).toContainText("RSSI");
    await page.locator("#refresh").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".transmitter-card button")).toHaveCount(1);
    await page.getByRole("searchbox").fill("Humidity");
    await expect(page.locator(".reading-button")).toHaveCount(2);
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
  const tile = page.locator("cj-reading").first();
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
  await page.goto("/sensors");
  await page.getByRole("button", { name: "Add sensor", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Name the device first");
  await page.keyboard.press("Escape");
  await page.goto("/devices");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await page
    .getByRole("button", { name: `Select ${node}`, exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(deviceName);
  await page.getByLabel("Location", { exact: false }).fill("North");
  await page.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${deviceName}`, exact: true }),
  ).toBeVisible();
  await page.goto("/sensors");
  await page.getByRole("button", { name: "Add sensor", exact: true }).click();
  const available = page
    .getByRole("dialog")
    .getByRole("listitem")
    .filter({ hasText: deviceName });
  await available
    .getByRole("button", { name: "Select ambient", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(sensorName);
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
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${renamed}`, exact: true }),
  ).toBeVisible();
  await other.getByLabel("Name", { exact: true }).fill("Stale edit");
  await other.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(other.getByRole("alert")).toContainText("changed");
  await other.close();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Organize dashboard", exact: true })
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
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(page.locator(".dashboard-section > h2")).toHaveText([
    "Equipment",
    "Climate",
  ]);
  await expect(page.locator(".sensor-group")).toContainText(renamed);
  await expect(page.locator("cj-reading")).toHaveCount(2);
  await expect(page.locator("#app img")).toHaveCount(0);
  await page.getByRole("button", { name: /Inspect Humidity:/ }).click();
  await expect(page.locator("#history-context")).toContainText(renamed);
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
    .getByRole("button", { name: "Organize dashboard", exact: true })
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
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(page.locator("cj-reading")).toHaveCount(1);
  await expect(page.locator("cj-reading")).toContainText("Temperature");
  await page
    .getByRole("button", { name: "Organize dashboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
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
  await page.getByLabel("Name", { exact: true }).fill("Unsaved name");
  await page.route("**/ui-api/sensors/*", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.getByRole("button", { name: "Save sensor", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
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
    page.getByRole("heading", { name: "Painel", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Transmissores", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transmissores", exact: true }),
  ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Adicionar sensor", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Adicionar sensor");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
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
    await expect(page.locator(".reading-title").first()).toHaveText(
      pt ? "Temperatura" : "Temperature",
    );
    await expect(page.locator(".sensor-group h3")).toHaveText("Sensor 1");
    await expect(page.locator("#summary")).toContainText(
      pt ? "1 transmissor" : "1 device",
    );
    await page.locator(".reading-button").first().click();
    await expect(page.locator("#history-heading")).toHaveText(
      pt ? "Histórico de Temperatura" : "Temperature history",
    );
    await expect(page.locator("#history svg.plot")).toHaveAttribute(
      "aria-label",
      pt ? /4 observações/ : /4 observations/,
    );
    await page.locator("#history summary").click();
    await expect(page.locator("#history table th").first()).toHaveText(
      pt ? "Horário (local)" : "Time (local)",
    );
    await page
      .getByRole("button", {
        name: pt ? "Organizar painel" : "Organize dashboard",
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
        device_id: "000048ca433c5e10",
        role: "receiver",
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
  await page.route("**/ui-api/commands", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        command_id: "c1",
        status: "applied",
        type: JSON.parse(route.request().postData()).type,
      }),
    }),
  );
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Pair by radio");
  await expect(dialog).toContainText("hold the PRG button");
  await expect(dialog).toContainText("No new devices detected");
  await expect(dialog).toContainText(
    "Devices and sensors appear here after their first measurement.",
  );
  const receiver = state.device_states[0];
  receiver.pairing = {
    open: true,
    remaining_s: 120,
    requests: [{ node_id: "000048ca433c776c", rssi_dbm: -60, conflict: false }],
  };
  await serve(state);
  await dialog
    .getByRole("button", { name: "Search for transmitters", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText(
    "Search started for two minutes.",
  );
  await expect(dialog).toContainText("Searching · 2:00 left");
  await expect(dialog).toContainText("Transmitter 776C");
  receiver.pairing = { open: false, requests: [] };
  state.device_states.push({
    source_id: "site",
    device_id: "000048ca433c776c",
    role: "transmitter",
    receiver_id: receiver.device_id,
    binding: "pending",
    received_at: state.generated_at,
  });
  await serve(state);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("#toast")).toHaveText("Transmitter paired.");
  await expect(dialog).toContainText("Paired, waiting for its first reading");
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "000048ca433c776c",
    name: "",
    location: "",
    revision: 0,
    received_at: state.generated_at,
    interval: 300,
  });
  await serve(state);
  await page.clock.fastForward(3100);
  await expect(dialog).not.toContainText("waiting for its first reading");
  await dialog
    .getByRole("button", { name: "Select 000048ca433c776c", exact: true })
    .click();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#discovery-note")).toContainText(
    "1 device available to add.",
  );
});
test("revocation lives with the device name, not on the dashboard", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states.push({
    source_id: "site",
    device_id: "000048ca433c776c",
    role: "transmitter",
    receiver_id: "000048ca433c5e10",
    binding: "active",
    received_at: state.generated_at,
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "000048ca433c776c",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row).toContainText("Receiver 5E10");
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
  await edit.click();
  await expect(
    page.getByRole("button", { name: "Revoke transmitter", exact: true }),
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
  await expect(page.locator(".receiver-status")).toHaveCount(1);
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
  await expect(page.locator(".receiver-card")).toContainText("Receiver 5E10");
  await expect(page.locator(".receiver-card")).toContainText("0 of 128");
  const offline = structuredClone(state);
  offline.device_states[0].availability = "offline";
  await inject("/", offline);
  await page.goto("/");
  const line = page.locator(".receiver-status");
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("href", "/receivers");
  await expect(line).toContainText("Offline");
  await expect(line).toContainText("Check the receiver's power and Wi-Fi");
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
    device_id: "000048ca433c776c",
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
    device: "000048ca433c776c",
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
    requests: [{ node_id: "000048ca433c776c", rssi_dbm: -82, conflict: false }],
  };
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "000048ca433c776c",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  await liveDevices(page, state);
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const request = dialog.locator(".pairing-request");
  await expect(request).toContainText("Coop");
  await expect(request).toContainText("Already paired");
  await expect(request).not.toContainText("Transmitter 776C");
  await expect(dialog).not.toContainText("After you add it");
  state.device_states[0].pairing.requests.push({
    node_id: "000048ca433c9f01",
    rssi_dbm: -70,
    conflict: false,
  });
  await liveDevices(page, state);
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await expect(dialog).toContainText("After you add it");
  await expect(dialog).not.toContainText("No new devices detected");
  state.device_states[0].availability = "offline";
  await liveDevices(page, state);
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await expect(dialog).not.toContainText("After you add it");
});

test("a revoked transmitter says so instead of offering Revoke", async ({
  page,
}) => {
  const state = pairingSnapshot();
  state.device_states.push({
    source_id: "site",
    device_id: "000048ca433c776c",
    role: "transmitter",
    receiver_id: "000048ca433c5e10",
    binding: "revoked",
    received_at: state.generated_at,
  });
  state.workspace.devices.push({
    id: 7,
    transport: "mqtt",
    source: "site",
    device: "000048ca433c776c",
    name: "Coop",
    location: "",
    revision: 1,
    received_at: state.generated_at,
    interval: 300,
  });
  await liveDevices(page, state);
  const row = page.getByRole("row").filter({ hasText: "Coop" });
  await expect(row.locator('td[data-label="Receiver"]')).toHaveText(
    "Receiver 5E10 · Revoked",
  );
  await page.getByRole("button", { name: "Edit Coop", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Revoked: the receiver");
  await expect(
    page.getByRole("button", { name: "Revoke transmitter" }),
  ).toHaveCount(0);
});
