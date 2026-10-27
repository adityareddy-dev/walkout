// The walkout sentence: one plain sentence per shopper who left, naming the
// moment and the cause, with the code line when the browser gave one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chat, imagePart, priceOf, type Message } from "./meta.ts";
import { codeText } from "./telemetry.ts";
import type { Finding, RunRecord } from "./types.ts";

export const EXPLAIN_MODEL = process.env.WALKOUT_EXPLAIN_MODEL ?? "muse-spark-1.3";

function stepLine(run: RunRecord, i: number): string {
  const s = run.steps[i];
  const a = s.action as Record<string, unknown>;
  const what = [a.action, s.targetLabel && `on ${s.targetLabel}`, a.key && `key ${a.key}`, a.text && `"${a.text}"`, a.direction].filter(Boolean).join(" ");
  return `${s.index}. [${s.title}] ${what}. Thought: ${a.why ?? ""}${a.reason ? ` Reason: ${a.reason}` : ""}${s.result ? `. Then: ${s.result}` : ""}${s.actionError ? `. Browser: ${s.actionError}` : ""}`;
}

function findingLine(f: Finding): string {
  const code = codeText(f.code);
  return `step ${f.step ?? "-"} ${f.kind}: ${f.summary}${code && !f.summary.includes(code) ? ` (${code})` : ""}`;
}

export function telemetryExcerpt(run: RunRecord, max = 14): string {
  const last = run.steps.length;
  // Findings near the end of the run matter most, then anything with a code line.
  const scored = run.findings.map((f) => ({ f, score: (f.step ?? 0) - last + (f.code ? 3 : 0) + (f.kind === "dead_tap" || f.kind === "js_error" ? 1 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  const keep = scored.slice(0, max).map((x) => x.f).sort((a, b) => a.t - b.t);
  return keep.length ? keep.map(findingLine).join("\n") : "(no telemetry findings)";
}

export async function explainWalkout(run: RunRecord, runDir: string, purpose: string): Promise<string> {
  if (run.outcome.kind === "bought") return `${run.persona.card.name} bought in ${run.outcome.atStep} steps.`;
  const c = run.persona.card;
  const steps = run.steps.map((_, i) => stepLine(run, i)).join("\n");
  const parts: Exclude<Message["content"], string> = [
    {
      type: "text",
      text: [
        `Shopper: ${c.name}. ${c.life} Situation: ${c.constraints.join(", ")}.`,
        `Goal: ${run.goal}`,
        `Outcome: ${run.outcome.kind.replace("_", " ")} at step ${run.outcome.atStep}: ${run.outcome.reason}`,
        `Steps:\n${steps}`,
        `Browser telemetry, joined to steps:\n${telemetryExcerpt(run)}`,
      ].join("\n\n"),
    },
  ];
  const shots = run.steps
    .slice(-2)
    .map((s) => s.screenshot)
    .filter((p): p is string => Boolean(p) && existsSync(join(runDir, p!)));
  for (const p of shots) parts.push(imagePart(readFileSync(join(runDir, p))));
  if (shots.length) parts.push({ type: "text", text: `The image${shots.length > 1 ? "s are" : " is"} the last screen${shots.length > 1 ? "s" : ""} the shopper saw.` });

  const messages: Message[] = [
    {
      role: "system",
      content:
        "You explain to a shop owner why one customer left without buying. Write exactly one plain sentence of at most 40 words. Name the moment (the step and what the shopper was trying to do) and the cause, using the telemetry when it shows one. If a finding gives a code location, name the file and line. No jargon a shop owner would not know, no advice, no preamble, no quotes around the sentence.",
    },
    { role: "user", content: parts },
  ];
  const res = await chat({
    model: EXPLAIN_MODEL,
    messages,
    maxTokens: 1200,
    reasoningEffort: "low",
    purpose,
    estimateUsd: priceOf(EXPLAIN_MODEL, 8000, 1200),
  });
  return res.text.replace(/\s+/g, " ").trim().replace(/^"|"$/g, "");
}
