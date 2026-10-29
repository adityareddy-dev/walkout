import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildScoreboard, loadBoard } from "../src/scoreboard/build.ts";
import { serveDir } from "../src/scoreboard/serve.ts";
import { ROOT } from "../src/shop.ts";

test("the shipped recording opens every real shopper and the saved patch", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "walkout-recording-"));
  const opts = {
    runsRoot: join(ROOT, "evidence"),
    before: "2026-10-270453-before",
    after: "2026-10-270458-after",
    outDir,
  };
  const data = await loadBoard(opts);
  assert.equal(data.before.bought, 2);
  assert.equal(data.after?.bought, 8);
  assert.equal(data.personas.length, 12);
  assert.equal(data.fix?.kept, true);
  assert.equal(data.fix?.testsPassed, true);
  assert.match(data.fix?.diff ?? "", /quantity \* Number\(units\)/);
  await buildScoreboard(opts);
  const server = await serveDir(outDir, 0);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    assert.equal(await page.locator(".tile").count(), 12);
    for (const persona of data.personas) {
      await page.locator(`.tile[data-persona="${persona.id}"]`).click();
      for (const round of ["before", "after"] as const) {
        await page.locator(`dialog .seg button[data-round="${round}"]`).click();
        const run = data[round]!.runs[persona.id];
        assert.ok(run.steps.length > 0, `${persona.id} ${round} has saved decisions`);
        assert.equal(await page.locator("dialog .textsteps li").count(), run.steps.length);
        if (run.sentence) assert.equal(await page.locator("dialog .sentence").textContent(), run.sentence);
      }
      await page.keyboard.press("Escape");
    }
    await page.locator("details.fix-diff summary").click();
    assert.ok(await page.locator(".diff .add").first().isVisible());
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});
