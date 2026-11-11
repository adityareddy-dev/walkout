import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "walkout-llm-"));
process.env.WALKOUT_LEDGER = join(dir, "calls.jsonl");
const { chat, checkModelConfig, ConfigError } = await import("../src/llm.ts");

const SETTINGS = ["WALKOUT_API_BASE", "WALKOUT_API_KEY", "WALKOUT_API_KEY_FILE", "WALKOUT_MODEL", "WALKOUT_SHOPPER_MODEL", "WALKOUT_EXPLAIN_MODEL", "WALKOUT_PICK_MODEL", "WALKOUT_FIX_MODEL", "WALKOUT_REVIEW_MODEL", "WALKOUT_PRICES"];
const unset = () => { for (const name of SETTINGS) delete process.env[name]; };

test("each missing setting stops the check with the variable's name", () => {
  unset();
  const fails = (roles: Parameters<typeof checkModelConfig>[0], name: RegExp) =>
    assert.throws(() => checkModelConfig(roles), (e: Error) => e instanceof ConfigError && name.test(e.message));
  fails(["shopper"], /WALKOUT_API_BASE/);
  process.env.WALKOUT_API_BASE = "http://127.0.0.1:9/v1";
  process.env.WALKOUT_API_KEY_FILE = join(dir, "no-key-here");
  fails(["shopper"], /WALKOUT_API_KEY/);
  process.env.WALKOUT_API_KEY = "test-key";
  fails(["fix"], /WALKOUT_FIX_MODEL or WALKOUT_MODEL/);
  process.env.WALKOUT_MODEL = "test-model";
  fails(["fix"], /WALKOUT_PRICES/);
  process.env.WALKOUT_PRICES = JSON.stringify({ "test-model": { input: 1, output: 2 } });
  checkModelConfig(["shopper", "explain", "pick", "fix", "review"]);
  process.env.WALKOUT_REVIEW_MODEL = "unpriced-model";
  fails(["review"], /WALKOUT_REVIEW_MODEL/);
});

test("chat sends the role's model and logs the role, not the model id", async (t) => {
  unset();
  process.env.WALKOUT_API_BASE = "http://127.0.0.1:9/v1";
  process.env.WALKOUT_API_KEY = "test-key";
  process.env.WALKOUT_MODEL = "test-model";
  process.env.WALKOUT_SHOPPER_MODEL = "test-shopper-model";
  process.env.WALKOUT_PRICES = JSON.stringify({ "test-shopper-model": { input: 1, output: 2 } });
  const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 });
  });
  const res = await chat({ role: "shopper", messages: [{ role: "user", content: "hi" }], maxTokens: 10, purpose: "test/step-01" });
  assert.equal(calls[0].url, "http://127.0.0.1:9/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.equal(calls[0].body.model, "test-shopper-model");
  assert.equal(res.text, "ok");
  assert.equal(res.usage.model, "shopper-model");
  assert.equal(res.usage.usd, (1000 * 1 + 500 * 2) / 1e6);
  const logged = JSON.parse(readFileSync(process.env.WALKOUT_LEDGER!, "utf8").trim());
  assert.equal(logged.model, "shopper-model");
  assert.equal(logged.purpose, "test/step-01");
});
