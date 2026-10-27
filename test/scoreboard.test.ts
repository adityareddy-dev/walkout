import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { buildScoreboard } from "../src/scoreboard/build.ts";
import { serveDir } from "../src/scoreboard/serve.ts";
import type { RunRecord } from "../src/types.ts";
import { FIXTURE_AFTER, FIXTURE_BEFORE, makeFixture } from "./fixtures/make-fixture.ts";

const GRID_SHOT = "/tmp/walkout-scoreboard-grid.png";
const DIALOG_SHOT = "/tmp/walkout-scoreboard-dialog.png";

let root = "";
let html = "";
let boardUrl = "";
let server: { url: string; close: () => Promise<void> } | undefined;
let browser: Browser | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "walkout-scoreboard-"));
  await makeFixture(root);
  const file = await buildScoreboard({ runsRoot: root, before: FIXTURE_BEFORE, after: FIXTURE_AFTER, outDir: join(root, "board") });
  assert.equal(file, join(root, "board", "index.html"));
  html = await readFile(file, "utf8");
  server = await serveDir(root, 0);
  boardUrl = new URL("board/index.html", server.url).href;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

async function openBoard(width = 1920, height = 1080): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(boardUrl);
  (page as Page & { errors?: string[] }).errors = errors;
  return page;
}

function pageErrors(page: Page): string[] {
  return (page as Page & { errors?: string[] }).errors ?? [];
}

async function waitForShot(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>("dialog[open] .frame img");
    return !!img && !img.hidden && img.complete && img.naturalWidth > 0;
  });
}

async function readRun(round: string, persona: string): Promise<RunRecord> {
  return JSON.parse(await readFile(join(root, round, persona, "run.json"), "utf8")) as RunRecord;
}

function rawGet(path: string): Promise<{ status: number; type: string | undefined }> {
  const { port } = new URL(server!.url);
  return new Promise((ok, bad) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: res.headers["content-type"] }));
    });
    req.on("error", bad);
    req.end();
  });
}

test("board html carries both counts, costs and embedded data", () => {
  assert.ok(html.includes("4 of 12"), "before count");
  assert.ok(html.includes("11 of 12"), "after count");
  assert.match(html, /Bought before/);
  assert.match(html, /Bought after/);
  assert.match(html, /\d+\.\d\d USD/);
  assert.match(html, /<script type="application\/json" id="board-data">/);
  assert.doesNotMatch(html, /<(link|script)[^>]+(href|src)="https?:/, "no external assets");
  assert.ok(html.includes("../fixture-before/p01/shots/step-01.png"), "relative screenshot paths");
});

test("before-only board renders with one state per tile", async () => {
  const file = await buildScoreboard({ runsRoot: root, before: FIXTURE_BEFORE, outDir: join(root, "board-before"), title: "Walkout check" });
  const only = await readFile(file, "utf8");
  assert.ok(only.includes("4 of 12"));
  assert.ok(!only.includes("Bought after"));
  const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(new URL("board-before/index.html", server!.url).href);
  assert.equal(await page.locator(".tile").count(), 12);
  assert.equal(await page.locator(".tile .state").count(), 12);
  assert.equal(await page.locator("h1").textContent(), "Walkout check");
  await page.locator('.tile[data-persona="p03"]').click();
  await waitForShot(page);
  assert.equal(await page.locator("dialog .seg").count(), 0, "no round switch without an after round");
  await page.close();
});

test("server sets content types and refuses paths outside the root", async () => {
  assert.equal((await rawGet("/board/index.html")).type, "text/html; charset=utf-8");
  assert.equal((await rawGet("/fixture-before/p01/shots/step-01.png")).type, "image/png");
  assert.equal((await rawGet("/fixture-before/round.json")).type, "application/json; charset=utf-8");
  for (const path of ["/../../../etc/passwd", "/%2e%2e/%2e%2e/%2e%2e/etc/passwd", "/board/..%2f..%2f..%2fetc%2fpasswd", "/%2e%2e%5c%2e%2e%5cetc%5cpasswd"]) {
    const { status } = await rawGet(path);
    assert.ok(status === 403 || status === 404, `${path} gave ${status}`);
  }
  assert.equal((await rawGet("/nope.png")).status, 404);
});

test("grid, detail dialog, replay and Escape", async () => {
  const page = await openBoard();
  assert.equal(await page.locator(".tile").count(), 12);
  assert.equal(await page.locator(".tile .state.good[data-round='before']").count(), 4);
  assert.equal(await page.locator(".tile .state.good[data-round='after']").count(), 11);

  const sentence = (await readRun(FIXTURE_BEFORE, "p01")).sentence!;
  const tile = page.locator('.tile[data-persona="p01"]');
  await tile.click();
  const dialog = page.locator("dialog#detail");
  assert.equal(await dialog.evaluate((d: HTMLDialogElement) => d.open), true);
  assert.equal(await dialog.locator(".sentence").textContent(), sentence);
  await waitForShot(page);
  assert.ok(await dialog.locator(".frame img").evaluate((img: HTMLImageElement) => img.naturalWidth) > 0);
  assert.equal(await dialog.locator(".counter").textContent(), "Step 1 of 6");
  assert.equal(await dialog.locator(".findings li").count(), 3);
  assert.match((await dialog.locator(".findings").textContent()) ?? "", /app-3f9c2\.js:1042/);

  await dialog.getByRole("button", { name: "Next" }).click();
  assert.equal(await dialog.locator(".counter").textContent(), "Step 2 of 6");
  await dialog.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => document.querySelector("dialog .counter")?.textContent === "Step 3 of 6", null, { timeout: 3000 });
  await dialog.getByRole("button", { name: "Pause" }).click();

  await dialog.locator('.seg button[data-round="after"]').click();
  assert.equal(await dialog.locator(".outcome .badge").textContent(), "Bought");
  await waitForShot(page);
  assert.equal(await dialog.locator(".counter").textContent(), "Step 1 of 8");

  await page.keyboard.press("Escape");
  assert.equal(await dialog.evaluate((d: HTMLDialogElement) => d.open), false);
  assert.equal(await tile.evaluate((el) => el === document.activeElement), true, "focus returns to the tile");

  await page.locator('.tile[data-persona="p10"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await dialog.evaluate((d: HTMLDialogElement) => d.open), true);
  await waitForShot(page);
  assert.match((await dialog.locator(".frame img").getAttribute("src")) ?? "", /step-01-marked\.png$/, "falls back to the marked shot");
  await page.keyboard.press("Escape");

  assert.deepEqual(pageErrors(page), []);
  await page.close();
});

test("screen reader run shows its steps as text", async () => {
  const page = await openBoard(1440, 900);
  await page.locator('.tile[data-persona="p05"]').click();
  const dialog = page.locator("dialog#detail");
  const steps = (await readRun(FIXTURE_BEFORE, "p05")).steps.length;
  assert.equal(await dialog.locator(".textsteps li").count(), steps);
  assert.equal(await dialog.locator(".frame img").count(), 0);
  await dialog.locator('.seg button[data-round="after"]').click();
  assert.equal(await dialog.locator(".outcome .badge").textContent(), "Step limit");
  assert.equal(await dialog.locator(".textsteps li").count(), (await readRun(FIXTURE_AFTER, "p05")).steps.length);
  await page.keyboard.press("Escape");
  assert.deepEqual(pageErrors(page), []);
  await page.close();
});

test("narrow screens use two columns", async () => {
  const page = await openBoard(600, 1000);
  const columns = await page.locator(".grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(columns, 2);
  await page.close();
});

test("screenshots of the grid and an open dialog at 1920x1080", async () => {
  const page = await openBoard(1920, 1080);
  await page.screenshot({ path: GRID_SHOT });
  await page.locator('.tile[data-persona="p01"]').click();
  await waitForShot(page);
  const dialog = page.locator("dialog#detail");
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Next" }).click();
  await waitForShot(page);
  await page.screenshot({ path: DIALOG_SHOT });
  await page.close();
});
