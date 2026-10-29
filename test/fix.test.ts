import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdits, evidence, withImports } from "../src/fix.ts";
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
