// A round: every persona once against one build of the shop, then a walkout
// sentence for each shopper who left.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { SHOPPER_MODEL } from "./agent.ts";
import { explainWalkout } from "./explain.ts";
import { assertBudget, LEDGER, priceOf } from "./meta.ts";
import { PERSONAS } from "./personas.ts";
import { runPersona } from "./runner.ts";
import { ROOT, type Shop } from "./shop.ts";
import type { Persona, RoundSummary, RunRecord } from "./types.ts";

export const RUNS = process.env.WALKOUT_RUNS ?? join(ROOT, "runs");
export const PROBE = join(ROOT, "dist", "probe.js");

// Average priced cost of one shopper step so far, from the ledger, or a
// cautious guess before there is any history.
export function costPerStep(): number {
  if (!existsSync(LEDGER)) return priceOf(SHOPPER_MODEL, 5000, 800);
  const rows = readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => /\/step-\d+/.test(r.purpose ?? "") && r.model === SHOPPER_MODEL);
  if (rows.length < 10) return priceOf(SHOPPER_MODEL, 5000, 800);
  return rows.reduce((s, r) => s + r.usd, 0) / rows.length;
}

export function estimateRoundUsd(personas: number, maxSteps: number): number {
  // Runs end early when the shopper buys or leaves; budget for 80 percent of
  // the step limit plus a sentence per run.
  return personas * (maxSteps * 0.8 * costPerStep() + priceOf(SHOPPER_MODEL, 8000, 1200));
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length && !failed) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (e) {
          failed = e;
        }
      }
    }),
  );
  if (failed) throw failed;
  return out;
}

export interface RoundOptions {
  shop: Shop;
  build: string; // label of the shop build under test
  label: string; // before, after, or anything
  url: string; // where shoppers start on this build
  personas?: Persona[];
  maxSteps?: number;
  concurrency?: number;
  id?: string;
}

export async function runRound(o: RoundOptions): Promise<RoundSummary> {
  const personas = o.personas ?? PERSONAS;
  const maxSteps = o.maxSteps ?? 25;
  const id = o.id ?? `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}-${o.label}`;
  const dir = join(RUNS, id);
  mkdirSync(dir, { recursive: true });
  const estimate = estimateRoundUsd(personas.length, maxSteps);
  assertBudget(estimate, `next round (${personas.length} shoppers)`);
  console.log(`round ${id}: ${personas.length} shoppers on ${o.build}, estimate ${estimate.toFixed(2)} USD`);

  const shop = o.shop;
  const started = new Date();
  const browser = await chromium.launch();
  let runs: RunRecord[];
  try {
    runs = await pool(personas, o.concurrency ?? 3, async (p) => {
      const rec = await runPersona(browser, p, { round: id, roundDir: dir, shop, build: o.build, url: o.url, probePath: PROBE, maxSteps });
      console.log(`  ${p.card.id}: ${rec.outcome.kind} at step ${rec.outcome.atStep} (${rec.usd.toFixed(3)} USD) ${rec.outcome.kind === "bought" ? "" : rec.outcome.reason}`);
      return rec;
    });
  } finally {
    await browser.close();
  }

  await pool(runs, 4, async (rec) => {
    const runDir = join(dir, rec.persona.card.id);
    rec.sentence = await explainWalkout(rec, runDir, `${id}/${rec.persona.card.id}/sentence`).catch((e) => {
      if (e?.name === "BudgetError") throw e;
      return `(no sentence: ${String(e).slice(0, 120)})`;
    });
    writeFileSync(join(runDir, "run.json"), JSON.stringify(rec, null, 2));
  });

  const summary = summarise(id, o.label, shop.id, o.build, shop.goal, started, runs, dir);
  writeFileSync(join(dir, "round.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function summarise(id: string, label: string, shop: string, build: string, goal: string, started: Date, runs: RunRecord[], dir: string): RoundSummary {
  // Round cost from the ledger, so the sentences and retries count too.
  const rows = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const usd = rows.filter((r) => String(r.purpose ?? "").startsWith(`${id}/`)).reduce((s, r) => s + r.usd, 0);
  void dir;
  return {
    round: id,
    label,
    shop,
    build,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    goal,
    bought: runs.filter((r) => r.outcome.kind === "bought").length,
    total: runs.length,
    usd,
    runs: runs.map((r) => ({
      round: id,
      persona: r.persona.card.id,
      personaName: r.persona.card.name,
      outcome: r.outcome,
      steps: r.steps.length,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      usd: rows.filter((x) => String(x.purpose ?? "").startsWith(`${id}/${r.persona.card.id}/`)).reduce((s, x) => s + x.usd, 0),
      findings: r.findings,
      sentence: r.sentence,
    })),
  };
}

export function loadRound(id: string): { summary: RoundSummary; runs: RunRecord[] } {
  const dir = join(RUNS, id);
  const summary = JSON.parse(readFileSync(join(dir, "round.json"), "utf8")) as RoundSummary;
  const runs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "run.json")))
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, "run.json"), "utf8")) as RunRecord);
  return { summary, runs };
}

export function printScoreboard(before: RoundSummary, after?: RoundSummary) {
  const row = (r: RoundSummary) => `${r.label.padEnd(7)} ${String(r.bought).padStart(2)} of ${r.total} bought   ${r.usd.toFixed(2)} USD   ${r.build}`;
  console.log("\nWalkout scoreboard");
  console.log(row(before));
  if (after) console.log(row(after));
  const ids = before.runs.map((r) => r.persona);
  for (const id of ids) {
    const b = before.runs.find((r) => r.persona === id)!;
    const a = after?.runs.find((r) => r.persona === id);
    const mark = (x?: RoundSummary["runs"][number]) => (x ? (x.outcome.kind === "bought" ? "bought" : "left  ") : "      ");
    console.log(`  ${b.personaName.padEnd(9)} ${mark(b)}  ${after ? mark(a) : ""}  ${b.outcome.kind === "bought" ? "" : (b.sentence ?? "").slice(0, 110)}`);
  }
}
