import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.mjs",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: process.env.CAJUI_UI_TEST_URL ?? "http://127.0.0.1:8091",
    headless: true,
  },
  webServer: {
    command: "python3 ../../scripts/serve_brand.py",
    url: "http://127.0.0.1:8092/design/brand",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
  outputDir: "test-results",
});
