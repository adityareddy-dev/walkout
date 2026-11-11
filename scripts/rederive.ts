// Re-derives a finished run's telemetry findings from its saved telemetry.json,
// after a change to the rules. No model calls.
//   npx tsx scripts/rederive.ts runs/<round>/<persona> [...]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveFindings } from "../src/telemetry.ts";

for (const dir of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  const raw = JSON.parse(readFileSync(join(dir, "telemetry.json"), "utf8"));
  run.findings = await deriveFindings(raw, run.steps);
  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));
  const k: Record<string, number> = {};
  for (const f of run.findings) k[f.kind] = (k[f.kind] ?? 0) + 1;
  console.log(dir, run.outcome.kind, JSON.stringify(k));
  for (const f of run.findings) if (f.kind === "unanswered_tap") console.log("  step", f.step, f.summary);
}
