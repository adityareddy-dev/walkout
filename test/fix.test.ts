import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadShop } from "../src/shop.ts";
import type { ChatRequest } from "../src/llm.ts";
process.env.WALKOUT_LEDGER = join(mkdtempSync(join(tmpdir(), "walkout-review-ledger-")), "calls.jsonl");
process.env.WALKOUT_API_KEY = "test-key";
process.env.WALKOUT_API_BASE = "http://127.0.0.1:9/v1";
process.env.WALKOUT_MODEL = "test-model";
process.env.WALKOUT_REVIEW_MODEL = "test-review-model";
process.env.WALKOUT_PRICES = JSON.stringify({ "test-model": { input: 1, output: 2 }, "test-review-model": { input: 4, output: 20 } });
const { applyEdits, evidence, withImports, reviewFix, reviewProposal } = await import("../src/fix.ts");
import { PERSONAS } from "../src/personas.ts";
import type { RunRecord } from "../src/types.ts";

test("applyEdits replaces unique text and refuses missing or repeated text", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkout-fix-"));
  writeFileSync(join(dir, "a.ts"), "const total = price;\nconst x = 1;\nconst x = 1;\n");
  const { applied, failed } = applyEdits(dir, [
    { file: "a.ts", find: "const total = price;", replace: "const total = price * quantity;" },
    { file: "a.ts", find: "const x = 1;", replace: "const x = 2;" },
    { file: "a.ts", find: "nope", replace: "" },
    { file: "missing.ts", find: "a", replace: "b" },
  ]);
  assert.equal(applied.length, 1);
  assert.deepEqual(failed.map((f) => f.why), ["text to replace is not unique", "text to replace not found", "no such file"]);
  assert.match(readFileSync(join(dir, "a.ts"), "utf8"), /price \* quantity/);
});

test("evidence counts a finding once per shopper and lists the walkout sentences", () => {
  const run = (i: number, bought: boolean): RunRecord => ({
    persona: PERSONAS[i],
    shop: "s",
    build: "b",
    goal: "g",
    steps: [],
    outcome: bought ? { kind: "bought", reason: "order placed", atStep: 5 } : { kind: "gave_up", reason: "total looked wrong", atStep: 7 },
    findings: bought
      ? []
      : [
          { kind: "dead_tap", t: 1, step: 3, target: "button.add", summary: "x" },
          { kind: "dead_tap", t: 2, step: 4, target: "button.add", summary: "x" },
        ],
    sentence: bought ? null : `shopper ${i} left at the cart`,
    usd: 0,
    startedAt: "",
    durationMs: 0,
  });
  const text = evidence([run(0, false), run(1, false), run(2, true)]);
  assert.match(text, /^2 of 3 shoppers left/);
  assert.match(text, /2x dead_tap: button\.add/);
  assert.match(text, /shopper 1 left at the cart/);
  assert.doesNotMatch(text, /shopper 2/);
});

test("withImports adds the shop files a picked file imports, in import order", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkout-imports-"));
  mkdirSync(join(dir, "components/Cart"), { recursive: true });
  mkdirSync(join(dir, "components/CartItems"), { recursive: true });
  writeFileSync(
    join(dir, "components/Cart/CartDetail.tsx"),
    "import { useRouter } from 'next/router';\nimport CartItems from '../CartItems';\nimport * as S from './Cart.styled';\n",
  );
  writeFileSync(join(dir, "components/CartItems/index.ts"), "export { default } from './CartItems';\n");
  const all = ["components/Cart/CartDetail.tsx", "components/Cart/Cart.styled.ts", "components/CartItems/index.ts", "components/CartItems/CartItems.tsx"];
  assert.deepEqual(withImports(dir, ["components/Cart/CartDetail.tsx"], all), [
    "components/Cart/CartDetail.tsx",
    "components/CartItems/index.ts",
    "components/CartItems/CartItems.tsx",
    "components/Cart/Cart.styled.ts",
  ]);
});

test("withImports finds a component folder's own file when its index is not a shop file", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkout-imports-"));
  mkdirSync(join(dir, "Cart"), { recursive: true });
  writeFileSync(join(dir, "Cart/CartDetail.tsx"), "import CartItems from '../CartItems';\n");
  assert.deepEqual(withImports(dir, ["Cart/CartDetail.tsx"], ["Cart/CartDetail.tsx", "CartItems/CartItems.tsx"]), ["Cart/CartDetail.tsx", "CartItems/CartItems.tsx"]);
});

function reviewFixture() {
  const shop = loadShop("otel-demo");
  shop.sourceDir = mkdtempSync(join(tmpdir(), "walkout-review-"));
  const before = Array.from({ length: 25 }, (_, i) => `// before ${i}`);
  const after = Array.from({ length: 25 }, (_, i) => `// after ${i}`);
  writeFileSync(join(shop.sourceDir, "cart.ts"), [...before, "const total = price;", ...after].join("\n"));
  const edit = { file: "cart.ts", find: "const total = price;", replace: "const total = price * quantity;" };
  return { shop, edit, proposal: { summary: "Count each item.", files: ["cart.ts"], edits: [edit] } };
}

function mockReplies(t: import("node:test").TestContext, replies: unknown[]) {
  const requests: (Record<string, unknown> & { messages: ChatRequest["messages"] })[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    assert.ok(replies.length, "unexpected model call");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200 });
  });
  return requests;
}

test("reviewFix approves with exact edits and twenty lines of surrounding context", async (t) => {
  const { shop, proposal } = reviewFixture();
  const requests = mockReplies(t, [{ verdict: "approve", reasons: ["The total now counts quantity."] }]);
  const review = await reviewFix(shop, [], proposal.files, proposal, "round/fix/review");
  assert.equal(review.verdict, "approve");
  assert.equal(requests[0].model, "test-review-model");
  assert.equal(requests[0].reasoning_effort, "medium");
  assert.equal(requests[0].max_tokens, 6000);
  const content = String(requests[0].messages[1].content);
  assert.match(content, /Count each item/);
  const edits = JSON.parse(content.slice(content.indexOf('[\n')));
  assert.equal(edits[0].find, proposal.edits[0].find);
  assert.equal(edits[0].replace, proposal.edits[0].replace);
  assert.equal(edits[0].matches, 1);
  assert.equal(edits[0].context[0].split("\n").length, 41);
  assert.match(edits[0].context[0], /^\/\/ before 5/);
  assert.match(edits[0].context[0], /\/\/ after 19$/);
});

test("reviewProposal uses corrected edits on revise", async (t) => {
  const { shop, proposal, edit } = reviewFixture();
  const corrected = { ...edit, replace: "const total = price * item.quantity;" };
  const requests = mockReplies(t, [{ verdict: "revise", reasons: ["Use the item quantity."], edits: [corrected] }]);
  const checked = await reviewProposal(shop, [], proposal.files, proposal, "round", () => {});
  assert.equal(checked.accepted, true);
  assert.deepEqual(checked.proposal.edits, [corrected]);
  assert.equal(requests.length, 1);
  applyEdits(shop.sourceDir, checked.proposal.edits);
  assert.match(readFileSync(join(shop.sourceDir, "cart.ts"), "utf8"), /price \* item.quantity/);
});

test("reviewProposal retries with review reasons then approves", async (t) => {
  const { shop, proposal, edit } = reviewFixture();
  const requests = mockReplies(t, [
    { verdict: "revise", reasons: ["Count the item quantity."] },
    { summary: "Count quantity.", edits: [edit] },
    { verdict: "approve", reasons: ["The quantity is included."] },
  ]);
  const verdicts: string[] = [];
  const checked = await reviewProposal(shop, [], proposal.files, proposal, "round", (r) => verdicts.push(r.verdict));
  assert.equal(checked.accepted, true);
  assert.deepEqual(verdicts, ["revise", "approve"]);
  assert.match(String(requests[1].messages.at(-1)?.content), /Count the item quantity/);
  assert.equal(requests.length, 3);
});

test("reviewProposal drops a second revise before applying edits", async (t) => {
  const { shop, proposal, edit } = reviewFixture();
  mockReplies(t, [
    { verdict: "revise", reasons: ["Try again."] },
    { summary: "Another try.", edits: [edit] },
    { verdict: "revise", reasons: ["Still incorrect."], edits: [edit] },
  ]);
  const checked = await reviewProposal(shop, [], proposal.files, proposal, "round", () => {});
  assert.equal(checked.accepted, false);
  assert.match(readFileSync(join(shop.sourceDir, "cart.ts"), "utf8"), /const total = price;/);
});
