// Real shop checks, no model calls. Run against the local demo stack only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { ROOT, waitForShop } from "../src/shop.ts";

const build = process.argv[2];
assert.ok(["defect", "fix", "clean"].includes(build), "use defect, fix or clean");
const url = build === "clean" ? "http://localhost:8082" : "http://localhost:8080";
const total = build === "defect" ? "$128.93" : "$332.85";
const money = (value: string) => new RegExp(`^\\$\\s*${value.slice(1).replace(".", "\\.")}$`);
const out = join(ROOT, "runs", "smoke", build);
await mkdir(out, { recursive: true });
await waitForShop(url);
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const name = mobile ? "phone" : "desktop";
    const context = await browser.newContext({
      viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await context.tracing.start({ screenshots: true, snapshots: true });
    try {
      await page.goto(url);
      await page.locator('a[href="/product/OLJCESPC7Z"]').first().click();
      await page.locator('[data-cy="product-quantity"]').selectOption("3");
      await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === "/api/cart" && r.request().method() === "POST" && r.ok()),
        page.getByRole("button", { name: "Add To Cart" }).click(),
      ]);
      await page.goto(`${url}/cart`);
      await page.getByRole("heading", { name: "Shopping Cart", exact: true }).waitFor();
      const section = page.locator("section").filter({ has: page.getByText("Shipping", { exact: true }) });
      await section.getByText(money("$26.97")).waitFor();
      await section.getByText(money(total)).waitFor();
      await section.getByText(money("$101.96")).waitFor();
      if (build === "clean") assert.equal(await section.locator("select").inputValue(), "3");
      else await section.getByText("3", { exact: true }).waitFor();
      await page.screenshot({ path: join(out, `${name}-cart.png`), fullPage: true });
      console.log(`${build} ${name}: three at $101.96, shipping $26.97, displayed total ${total}`);

      // The demo's local payment service uses its prefilled sample card.
      if (build !== "defect") {
        await page.getByRole("button", { name: "Place Order", exact: true }).click();
        await page.waitForURL(/\/checkout\/[0-9a-f-]{8,}/);
        await page.getByText("Your order is complete", { exact: false }).waitFor();
        await page.screenshot({ path: join(out, `${name}-order.png`), fullPage: true });
        console.log(`${build} ${name}: order confirmed`);
      }
    } catch (err) {
      await page.screenshot({ path: join(out, `${name}-failure.png`), fullPage: true }).catch(() => {});
      throw err;
    } finally {
      await context.tracing.stop({ path: join(out, `${name}-trace.zip`) });
      await context.close();
    }
  }
} finally {
  await browser.close();
}
