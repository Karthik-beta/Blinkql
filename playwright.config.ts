import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = "http://localhost:4173";

// https://playwright.dev/docs/test-configuration
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // The results table groups numbers in the browser's locale, and the tests expect 1,000.
    locale: "en-US",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Test the production build, not the dev server: it's what users get.
  webServer: {
    command: "pnpm build && pnpm preview",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
