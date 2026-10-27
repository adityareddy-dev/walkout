// walkout <command>
//   demo        shop up, shoppers on the defect build, fix, shoppers again, scoreboard
//   shop up|down
//   run         one round: --build defect|clean|fix --label <name>
//   fix         propose and apply a fix from a finished round: --round <id>
//   scoreboard  --before <id> [--after <id>] [--serve]
//   spend       Meta API spend so far
// Common: --shop <id> (default otel-demo), --personas p01,p05, --max-steps 25, --concurrency 3

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { branchWithEdits, pickFiles, proposeFix, type FixProposal } from "./fix.ts";
import { BUDGET_USD, BudgetError, LEDGER, spentByRound, spentUsd } from "./meta.ts";
import { PERSONAS, personaById } from "./personas.ts";
import { loadRound, printScoreboard, runRound, RUNS } from "./round.ts";
import { buildScoreboard } from "./scoreboard/build.ts";
import { serveDir } from "./scoreboard/serve.ts";
import { loadShop, ROOT, sh, waitForShop, type Shop } from "./shop.ts";
import type { RoundSummary } from "./types.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    shop: { type: "string", default: process.env.WALKOUT_SHOP ?? "otel-demo" },
    build: { type: "string", default: "defect" },
    label: { type: "string" },
    round: { type: "string" },
    before: { type: "string" },
    after: { type: "string" },
    personas: { type: "string" },
    "max-steps": { type: "string", default: "25" },
    concurrency: { type: "string", default: "3" },
    serve: { type: "boolean", default: false },
    port: { type: "string", default: "4173" },
    "no-shop": { type: "boolean", default: false },
  },
});

const personas = values.personas ? values.personas.split(",").map((id) => personaById(id.trim())) : PERSONAS;
const maxSteps = Number(values["max-steps"]);
const concurrency = Number(values.concurrency);

function buildOf(shop: Shop, which: string): { label: string; url: string } {
  if (which === "defect") return { label: shop.defect.label, url: shop.defect.url };
  if (which === "clean") return { label: shop.clean.label, url: shop.clean.url };
  if (which === "fix") return { label: `${shop.defect.label} + fix`, url: shop.fixUrl };
  throw new Error(`unknown build ${which}`);
}

async function shopUp(shop: Shop) {
  sh(shop.startCmd, ROOT);
  await waitForShop(shop.defect.url);
  await waitForShop(shop.clean.url);
}

interface FixResult {
  proposal: FixProposal;
  branch: string;
  commit: string;
  failedEdits: { file: string; why: string }[];
  testsPassed: boolean | null;
  testOutput: string;
}

async function fixFrom(shop: Shop, roundId: string): Promise<FixResult | null> {
  const { runs } = loadRound(roundId);
  if (runs.every((r) => r.outcome.kind === "bought")) return null;
  const files = await pickFiles(shop, runs, `${roundId}/fix/pick`);
  console.log(`fix: reading ${files.join(", ")}`);
  const proposal = await proposeFix(shop, runs, files, `${roundId}/fix/patch`);
  console.log(`fix: ${proposal.summary}`);
  const branch = `walkout/fix-${roundId}`;
  const { commit, diff, failed } = branchWithEdits(shop, branch, proposal);
  writeFileSync(join(RUNS, roundId, "fix.diff"), diff);
  const result: FixResult = {
    proposal,
    branch,
    commit,
    failedEdits: failed.map((f) => ({ file: f.edit.file, why: f.why })),
    testsPassed: null,
    testOutput: "",
  };
  if (!commit) {
    writeFileSync(join(RUNS, roundId, "fix.json"), JSON.stringify(result, null, 2));
    throw new Error(`fix: no edit applied (${failed.map((f) => `${f.edit.file}: ${f.why}`).join("; ")})`);
  }
  // The gate: the shop's own tests when it has them, otherwise whatever check
  // the shop names in buildGate, which runs inside fixBuildCmd.
  try {
    result.testOutput = sh(shop.fixBuildCmd, ROOT).slice(-4000);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    result.testOutput = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.slice(-4000);
    result.testsPassed = false;
    console.log(`gate: the fixed build failed${shop.buildGate ? ` (${shop.buildGate})` : ""}, the patch is dropped.`);
    writeFileSync(join(RUNS, roundId, "fix.json"), JSON.stringify(result, null, 2));
    return result;
  }
  if (!shop.testCmd && shop.buildGate) {
    result.testsPassed = true;
    console.log(`gate: this shop has no test command, so the gate is ${shop.buildGate}. It passed.`);
  }
  await waitForShop(shop.fixUrl);
  if (shop.testCmd) {
    try {
      result.testOutput = sh(shop.testCmd, shop.sourceDir).slice(-4000);
      result.testsPassed = true;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      result.testOutput = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.slice(-4000);
      result.testsPassed = false;
    }
  }
  writeFileSync(join(RUNS, roundId, "fix.json"), JSON.stringify(result, null, 2));
  return result;
}

async function board(before: string, after?: string) {
  const path = await buildScoreboard({ runsRoot: RUNS, before, after, outDir: join(RUNS, "board") });
  console.log(`scoreboard: ${path}`);
  if (values.serve) {
    const s = await serveDir(RUNS, Number(values.port));
    console.log(`scoreboard: ${s.url}board/ (Ctrl+C to stop)`);
    await new Promise(() => {});
  }
}

async function demo(shop: Shop) {
  console.log(`Walkout on ${shop.name}: ${shop.goal}`);
  console.log(`Defect build ${shop.defect.label} (${shop.defect.issue}). Meta API spent so far ${spentUsd().toFixed(2)} of ${BUDGET_USD} USD.`);
  if (!values["no-shop"]) await shopUp(shop);

  let before: RoundSummary;
  if (values.before) before = loadRound(values.before).summary;
  else {
    const d = buildOf(shop, "defect");
    before = await runRound({ shop, build: d.label, label: "before", url: d.url, personas, maxSteps, concurrency });
  }
  printScoreboard(before);
  if (before.bought === before.total) {
    console.log("Nobody walked out, nothing to fix.");
    return board(before.round);
  }

  const fix = await fixFrom(shop, before.round);
  if (fix?.testsPassed === false && !shop.testCmd) {
    sh(`git checkout -q ${shop.defect.commit}`, shop.sourceDir);
    console.log("Fix dropped: it does not build, so there is no after round.");
    return board(before.round);
  }
  const f = buildOf(shop, "fix");
  const after = await runRound({ shop, build: f.label, label: "after", url: f.url, personas, maxSteps, concurrency });
  if (shop.unfixCmd) sh(shop.unfixCmd, ROOT);
  const kept = after.bought > before.bought && fix?.testsPassed !== false;
  if (fix) {
    writeFileSync(join(RUNS, after.round, "fix.json"), JSON.stringify({ ...fix, before: before.round, beforeBought: before.bought, afterBought: after.bought, kept }, null, 2));
    if (!kept) sh(`git checkout -q ${shop.defect.commit}`, shop.sourceDir);
  }
  printScoreboard(before, after);
  console.log(`\nFix ${kept ? "kept" : "dropped"}: ${before.bought} of ${before.total} bought before, ${after.bought} of ${after.total} after${fix?.testsPassed === false ? ", the shop's tests failed" : ""}.`);
  console.log(`Meta API spent so far ${spentUsd().toFixed(2)} USD (${LEDGER}).`);
  await board(before.round, after.round);
}

async function main() {
  const cmd = positionals[0] ?? "demo";
  if (cmd === "spend") {
    for (const [k, r] of spentByRound()) console.log(`${k.padEnd(28)} ${String(r.calls).padStart(4)} calls ${r.usd.toFixed(4)} USD`);
    console.log(`${spentUsd().toFixed(4)} USD of ${BUDGET_USD} USD (${LEDGER})`);
    return;
  }
  if (cmd === "scoreboard") {
    if (!values.before) throw new Error("--before <round id> is required");
    return board(values.before, values.after);
  }
  const shop = loadShop(values.shop!);
  if (cmd === "shop") {
    if (positionals[1] === "down") sh(shop.stopCmd, ROOT);
    else await shopUp(shop);
    return;
  }
  if (cmd === "run") {
    const b = buildOf(shop, values.build!);
    const r = await runRound({ shop, build: b.label, label: values.label ?? values.build!, url: b.url, personas, maxSteps, concurrency });
    printScoreboard(r);
    console.log(`round ${r.round}, ${r.usd.toFixed(2)} USD`);
    return;
  }
  if (cmd === "fix") {
    if (!values.round) throw new Error("--round <round id> is required");
    const r = await fixFrom(shop, values.round);
    console.log(r ? `fix on ${r.branch} at ${r.commit}, tests ${r.testsPassed}` : "nobody walked out");
    return;
  }
  if (cmd === "demo") return demo(shop);
  throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => {
  if (e instanceof BudgetError) {
    console.error(`Stopped: ${e.message}`);
    process.exit(3);
  }
  console.error(e);
  process.exit(1);
});
