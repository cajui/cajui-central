import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

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
    await page.goto("/design/dashboard");
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
    expect(requests.every((url) => url.startsWith(baseURL))).toBeTruthy();
  });
}
test("component states, literal text and keyboard chart inspection", async ({
  page,
}) => {
  await page.goto("/design/components");
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
  await page.goto("/design/brand");
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
    await page.goto(path);
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
  await page.goto("/design/components");
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
  await page.goto("/design/dashboard");
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
  await page.goto("/design/components");
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
