import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { personaById } from "../src/personas.ts";
import { runPersona } from "../src/runner.ts";
import type { Shop } from "../src/shop.ts";
import type { Action } from "../src/types.ts";
import type { decide } from "../src/agent.ts";
import { serveFixture } from "./helpers.ts";

const PROBE = join(import.meta.dirname, "..", "dist", "probe.js");
const PLAN = ["Add", "Nothing", "Nothing", "Slow", "Load", "Boom", "Next page"];

// A scripted shopper: clicks the fixture's buttons in order, no model calls.
const scripted: typeof decide = async (persona, _goal, perception, _memory, step) => {
  const want = PLAN[step - 1];
  let target: string | undefined;
  if (perception.tree) {
    const line = perception.tree.split("\n").find((l) => l.includes(`"${want}"`));
    target = line?.match(/\[ref=(e\d+)\]/)?.[1];
  } else {
    target = perception.marks?.find((m) => m.label.includes(`"${want}"`))?.id;
  }
  const action: Action = target ? { action: "click", target, why: `press ${want}` } : { action: "give_up", reason: `no ${want}` };
  return { action, usage: { model: "scripted", inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, latencyMs: 0 }, raw: "" };
};

for (const id of ["p08", "p01", "p05"]) {
  test(`probe and findings on the tap fixture, persona ${id}`, { timeout: 180_000 }, async () => {
    const server = await serveFixture(join(import.meta.dirname, "fixtures", "taps"));
    const browser = await chromium.launch();
    try {
      const shop = { id: "fixture", name: "Tap fixture", url: server.url, goal: "test", successText: "your order is placed" } as Shop;
      const rec = await runPersona(browser, personaById(id), {
        round: "test",
        roundDir: mkdtempSync(join(tmpdir(), "walkout-probe-")),
        shop,
        build: "fixture",
        probePath: PROBE,
        maxSteps: PLAN.length,
        decideFn: scripted,
      });
      const kinds = rec.findings.map((f) => `${f.kind}@${f.step}: ${f.summary}`);
      console.log(rec.outcome, "\n" + kinds.join("\n"));
      assert.equal(rec.outcome.kind, "bought", JSON.stringify(rec.outcome));
      const dead = rec.findings.filter((f) => f.kind === "dead_tap");
      assert.deepEqual(dead.map((f) => f.step), [2, 3, 6], "dead taps: the two Nothing presses and Boom, which throws");
      assert.ok(rec.findings.some((f) => f.kind === "rage_click" && f.target?.includes("nothing")));
      const slow = rec.findings.find((f) => f.kind === "slow_interaction" && f.step === 4);
      assert.ok(slow, "the Slow button is a slow interaction");
      assert.ok(slow!.code && slow!.code.url.endsWith("app.js") && slow!.code.line === 10, JSON.stringify(slow!.code));
      const errors = rec.findings.filter((f) => f.kind === "js_error");
      assert.equal(errors.length, 1, "one error, counted once");
      assert.ok(errors[0].step === 6 && errors[0].code?.line === 21, "the Boom error with its line");
    } finally {
      await browser.close();
      await server.close();
    }
  });
}
