import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

test.describe("Templates", () => {
  test("runs a template on its sample data and opens its chart", async ({
    page,
    makeAxeBuilder,
  }) => {
    await page.goto("/app/");
    await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });

    await page.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("button", { name: /^Reject rate by machine/ }).click();
    const dialog = page.getByRole("dialog", { name: "Reject rate by machine" });
    await expect(dialog.getByRole("button", { name: "Run" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Load sample data" }).click();
    await expect(dialog.getByLabel("Table")).toHaveValue("quality_checks");
    await expect(dialog.getByLabel("Machine")).toHaveValue("machine_id");
    const scan = await makeAxeBuilder().include('[role="dialog"]').analyze();
    expect(scan.violations).toEqual([]);

    await dialog.getByRole("button", { name: "Run" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Chart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("img", { name: /^Bar chart of avg\(reject_rate_pct\) by machine_id/ }),
    ).toBeVisible();
  });
});
