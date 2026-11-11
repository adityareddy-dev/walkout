import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";

test("tap and fetch retain their IDs in memory and OTLP, without global SDK changes", { timeout: 30_000 }, async () => {
  const batches: any[] = [];
  const headers: Record<string, string | undefined> = {};
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.end();
    } else if (req.url === "/v1/traces") {
      let text = "";
      for await (const chunk of req) text += chunk;
      batches.push(JSON.parse(text));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end("{}");
    } else if (req.url === "/api/cart") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      headers[req.method === "POST" ? "cart" : "foreign"] = req.headers.traceparent as string;
      res.end("{}");
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<button onclick="fetch(\'/api/cart\', {method: \'POST\'}).then(r=>r.text())">Add To Cart</button>');
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ isMobile: true, hasTouch: true });
    const records: any[] = [];
    await context.exposeFunction("__walkoutEmit", (batch: any[]) => records.push(...batch));
    await context.addInitScript({ content: `window.__walkoutConfig = ${JSON.stringify({ tracesEndpoint: url + "/v1/traces", persona: "Rosa", run: "otlp-test" })}` });
    await context.addInitScript({ path: join(import.meta.dirname, "..", "dist/probe.js") });
    const page = await context.newPage();
    await page.goto(url);
    const globalBefore = await page.evaluate(() => Object.getOwnPropertySymbols(globalThis).filter(s => String(s).includes("opentelemetry")).map(String));
    await page.getByRole("button", { name: "Add To Cart" }).tap();
    await page.waitForTimeout(700);
    await page.evaluate("window.__walkoutFlush()");
    const local = records.filter(r => r.kind === "span");
    const tap = local.find(s => s.name.includes("Add To Cart"));
    const fetchSpan = local.find(s => s.attributes["url.full"]?.endsWith("/api/cart"));
    assert.ok(tap && fetchSpan, JSON.stringify(local));
    assert.equal(fetchSpan.parentSpanId, tap.spanId);
    assert.equal(fetchSpan.traceId, tap.traceId);
    assert.equal(headers.cart, `00-${fetchSpan.traceId}-${fetchSpan.spanId}-01`);
    const sent = batches.flatMap(b => b.resourceSpans).flatMap(r => r.scopeSpans).flatMap(s => s.spans);
    assert.ok(sent.some(s => s.traceId === tap.traceId && s.spanId === tap.spanId));
    assert.ok(sent.some(s => s.traceId === fetchSpan.traceId && s.spanId === fetchSpan.spanId && s.parentSpanId === tap.spanId));
    assert.ok(!local.some(s => s.attributes["url.full"]?.endsWith("/v1/traces")), "export does not trace itself");
    const resource = batches.flatMap(b => b.resourceSpans).find(r => r.resource.attributes.some((a: any) => a.key === "walkout.persona"));
    assert.ok(resource.resource.attributes.some((a: any) => a.key === "service.name" && a.value.stringValue === "walkout-browser"));
    assert.ok(resource.resource.attributes.some((a: any) => a.key === "walkout.persona" && a.value.stringValue === "Rosa"));
    assert.deepEqual(await page.evaluate(() => Object.getOwnPropertySymbols(globalThis).filter(s => String(s).includes("opentelemetry")).map(String)), globalBefore);
    await page.evaluate(foreign => fetch(foreign).then(r => r.text()), url.replace("127.0.0.1", "localhost") + "/api/cart");
    await page.evaluate("window.__walkoutFlush()");
    assert.equal(headers.foreign, undefined, "no trace headers sent to another origin");
    const foreign = records.find(r => r.kind === "span" && r.attributes["url.full"]?.startsWith("http://localhost:"));
    assert.ok(foreign && !foreign.parentSpanId, "a later background fetch does not inherit the tap");
    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});
