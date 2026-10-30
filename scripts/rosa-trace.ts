// Scripted Add To Cart, using Rosa's existing device profile. No model calls.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { personaById } from "../src/personas.ts";
import { dressContext } from "../src/runner.ts";
import type { RawTelemetry } from "../src/types.ts";

const url = process.argv[2] ?? "http://localhost:8080";
const out = process.argv[3] ?? "runs/rosa-trace";
const mode = process.argv[4] ?? "phone";
const persona = structuredClone(personaById("p01"));
if (mode === "unthrottled") { persona.device.cpuThrottle = 1; delete persona.device.network; }
assert.ok(["phone", "unthrottled", "journey"].includes(mode));
const raw: RawTelemetry = { inputs: [], mutations: [], requests: [], navigations: [], eventTimings: [], loafs: [], vitals: [], errors: [], spans: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const { ctx, page } = await dressContext(browser, persona, join(import.meta.dirname, "..", "dist/probe.js"), raw);
  page.setDefaultTimeout(120_000);
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const network: unknown[] = [];
  page.on("requestfinished", async r => {
    if (new URL(r.url()).pathname !== "/api/cart" || r.method() !== "POST") return;
    network.push({ url: r.url(), traceparent: (await r.allHeaders()).traceparent, timing: r.timing() });
  });
  if (mode === "journey") {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForTimeout(3000);
    await page.getByRole("link", { name: "Go Shopping" }).first().tap();
    await page.waitForTimeout(3000);
    await page.locator('a[href="/product/OLJCESPC7Z"]').first().tap();
    await page.waitForTimeout(3000);
  } else {
    await page.goto(`${url}/product/OLJCESPC7Z`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  }
  console.log("product loaded");
  const button = page.getByRole("button", { name: "Add To Cart" });
  await page.locator('[data-cy="product-quantity"]').selectOption("3");
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(mode === "journey" ? 3000 : 6000);
  console.log("ready to tap");
  await page.screenshot({ path: join(out, "before-tap.png") });
  const start = Date.now();
  let responseMs = 0;
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cart" && r.request().method() === "POST").then(async r => {
    await r.finished(); responseMs = Date.now() - start; return r;
  });
  await button.tap();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(out, "three-seconds.png") });
  const r = await response;
  await r.finished();
  const elapsedMs = responseMs;
  await page.waitForTimeout(1000);
  await page.evaluate("window.__walkoutFlush?.()");
  await page.screenshot({ path: join(out, "after-response.png") });
  const post = raw.spans.find(s => s.attributes["url.full"]?.toString().includes("/api/cart") && s.attributes["http.request.method"] === "POST");
  assert.ok(post, "POST cart span captured");
  const tap = raw.spans.find(s => s.spanId === post.parentSpanId);
  assert.ok(tap && tap.name.includes("Add To Cart"), "tap is the request's parent");
  assert.equal(r.status(), 200);
  await writeFile(join(out, "telemetry.json"), JSON.stringify(raw, null, 2));
  await writeFile(join(out, "summary.json"), JSON.stringify({ capturedAt: new Date().toISOString(), mode, device: persona.device, url, elapsedMs, browserSpanMs: post.end - post.start, traceId: post.traceId, tapSpanId: tap.spanId, fetchSpanId: post.spanId, network }, null, 2));
  console.log(JSON.stringify({ mode, elapsedMs, browserSpanMs: post.end - post.start, traceId: post.traceId }));
  await ctx.tracing.stop({ path: join(out, "browser-trace.zip") });
  await ctx.close();
} finally { await browser.close(); }
