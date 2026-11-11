// The fix: the model reads the walkout sentences and the telemetry, picks the
// source files that matter, and returns exact edits. They go on a branch of
// the shop's source, the shop is rebuilt and tested, and the same shoppers
// run again. The patch stays only if more of them buy and the tests pass.

import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { chat, parseJsonObject, priceOf, type Message } from "./llm.ts";
import { sh, type Shop } from "./shop.ts";
import { codeText } from "./telemetry.ts";
import type { RunRecord } from "./types.ts";

export interface Edit {
  file: string;
  find: string;
  replace: string;
}

export interface FixProposal {
  summary: string;
  files: string[];
  edits: Edit[];
}

export function evidence(runs: RunRecord[]): string {
  const left = runs.filter((r) => r.outcome.kind !== "bought");
  const sentences = left.map((r) => `- ${r.persona.card.name} (${r.persona.card.constraints[0]}): ${r.sentence ?? r.outcome.reason}`).join("\n");
  // The same finding across shoppers, counted, with its code line.
  const counts = new Map<string, number>();
  for (const r of left) {
    const seen = new Set<string>();
    for (const f of r.findings) {
      const key = `${f.kind}: ${f.target ?? f.summary.slice(0, 120)}${f.code ? ` @ ${codeText(f.code)}` : ""}`;
      if (!seen.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      seen.add(key);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  return [
    `${left.length} of ${runs.length} shoppers left without buying.`,
    `Walkout sentences:\n${sentences}`,
    `Telemetry findings among those who left (number of shoppers who hit each):\n${top.map(([k, n]) => `${n}x ${k}`).join("\n")}`,
  ].join("\n\n");
}

export function sourceFiles(shop: Shop): string[] {
  const files = new Set<string>();
  for (const g of shop.sourceGlobs) for (const f of globSync(g, { cwd: shop.sourceDir })) files.add(f.replaceAll("\\", "/"));
  return [...files].sort();
}

export async function pickFiles(shop: Shop, runs: RunRecord[], purpose: string): Promise<string[]> {
  const all = sourceFiles(shop);
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You maintain this online shop's frontend. Shoppers walked out. From the evidence and the file list, choose the files you need to read to find and fix the cause that cost the most shoppers. Reply with only JSON: {\"files\": [up to 8 paths from the list], \"why\": \"one sentence\"}.",
    },
    { role: "user", content: `${evidence(runs)}\n\nShop: ${shop.name}, goal of the shoppers: ${shop.goal}\n\nFiles:\n${all.join("\n")}` },
  ];
  const res = await chat({ role: "pick", messages, maxTokens: 1500, reasoningEffort: "low", purpose, estimateUsd: priceOf("pick", 20_000, 1500) });
  const obj = parseJsonObject(res.text) ?? {};
  const picked = Array.isArray(obj.files) ? obj.files.map(String).filter((f) => all.includes(f)) : [];
  return withImports(shop.sourceDir, picked.slice(0, 8), all);
}

// The picked files plus the shop files they import, so the patch can land
// where the bug is and not around it (a cart page without the component that
// sums the cart).
export function withImports(sourceDir: string, picked: string[], all: string[], max = 12): string[] {
  const out = [...picked];
  const local = (f: string): string[] => {
    const text = readFileSync(join(sourceDir, f), "utf8");
    const found: string[] = [];
    for (const m of text.matchAll(/^(?:import|export)[^;]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const base = posix.normalize(posix.join(posix.dirname(f), m[1]));
      const hit = ["", ".tsx", ".ts", "/index.tsx", "/index.ts", `/${posix.basename(base)}.tsx`, `/${posix.basename(base)}.ts`].map((x) => base + x).find((c) => all.includes(c));
      if (hit) found.push(hit);
    }
    return found;
  };
  const add = (f: string) => {
    if (out.includes(f)) return;
    out.push(f);
    // An index file only re-exports, so the file behind it is the one to read.
    if (/(^|\/)index\.tsx?$/.test(f)) for (const g of local(f)) add(g);
  };
  for (const f of picked) for (const g of local(f)) add(g);
  return out.slice(0, max);
}

export async function proposeFix(shop: Shop, runs: RunRecord[], files: string[], purpose: string, notes?: string[]): Promise<FixProposal> {
  const bodies = files
    .map((f) => {
      const text = readFileSync(join(shop.sourceDir, f), "utf8");
      return `=== ${f}\n${text.split("\n").slice(0, 900).join("\n")}`;
    })
    .join("\n\n");
  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You maintain this online shop's frontend. Real shoppers walked out and the evidence says where. Fix the cause that cost the most shoppers with the smallest change that a careful reviewer would accept. Do not change unrelated behaviour, do not add features, do not touch tests.",
        "Reply with only JSON: {\"summary\": \"one plain sentence on what was wrong and what the change does\", \"edits\": [{\"file\": \"path\", \"find\": \"exact text copied from the file, unique in it, a few lines\", \"replace\": \"the new text\"}]}.",
      ].join("\n"),
    },
    { role: "user", content: `${evidence(runs)}\n\nShop: ${shop.name}, goal of the shoppers: ${shop.goal}\n\nSource:\n${bodies}` },
  ];
  if (notes?.length) messages.push({ role: "user", content: `Review feedback to address:\n${notes.join("\n")}` });
  const res = await chat({ role: "fix", messages, maxTokens: 8000, reasoningEffort: "medium", purpose, estimateUsd: priceOf("fix", 60_000, 8000) });
  const obj = parseJsonObject(res.text) ?? {};
  const edits = Array.isArray(obj.edits)
    ? obj.edits.map((e: Record<string, unknown>) => ({ file: String(e.file ?? ""), find: String(e.find ?? ""), replace: String(e.replace ?? "") }))
    : [];
  return { summary: String(obj.summary ?? "").trim(), files, edits };
}

export interface FixReview {
  verdict: "approve" | "revise";
  reasons: string[];
  edits?: Edit[];
}

export async function reviewFix(shop: Shop, runs: RunRecord[], files: string[], proposal: FixProposal, purpose: string): Promise<FixReview> {
  const edits = proposal.edits.map((edit) => {
    let source: string;
    try {
      source = readFileSync(join(shop.sourceDir, edit.file), "utf8");
    } catch {
      return { ...edit, matches: 0, context: "File does not exist." };
    }
    const positions: number[] = [];
    if (edit.find) {
      for (let at = source.indexOf(edit.find); at >= 0; at = source.indexOf(edit.find, at + 1)) positions.push(at);
    }
    const lines = source.split("\n");
    const context = positions.map((at) => {
      const start = source.slice(0, at).split("\n").length - 1;
      const end = start + edit.find.split("\n").length;
      return lines.slice(Math.max(0, start - 20), end + 20).join("\n");
    });
    return { ...edit, matches: positions.length, context };
  });
  const messages: Message[] = [
    { role: "system", content: [
      "Review this shop patch before its rebuild gate. Check: does it address the walkout sentences and top telemetry findings; is it the smallest change that does; does it break anything visible in the surrounding code; does every find string still match the file exactly once?",
      'Reply only as JSON: {"verdict":"approve" or "revise","reasons":[plain sentences, at most five],"edits":[optional corrected edits with file, find, replace]}. On revise, include a complete replacement edit list only when the correction is small. Find strings must match the original files exactly once.',
    ].join("\n") },
    { role: "user", content: `${evidence(runs)}\n\nShop: ${shop.name}, goal: ${shop.goal}\nPicked files: ${files.join(", ")}\nProposal: ${proposal.summary}\nEdits (exact find and replace text, with 20 surrounding lines):\n${JSON.stringify(edits, null, 2)}` },
  ];
  const res = await chat({ role: "review", messages, reasoningEffort: "medium", maxTokens: 6000, purpose, estimateUsd: priceOf("review", 60_000, 6000) });
  const obj = parseJsonObject(res.text);
  if (!obj || !["approve", "revise"].includes(String(obj.verdict)) || !Array.isArray(obj.reasons) || !obj.reasons.every((r) => typeof r === "string")) {
    throw new Error("fix review: invalid verdict or reasons");
  }
  const corrected = Array.isArray(obj.edits) && obj.edits.length && obj.edits.every((e) => e && typeof e.file === "string" && typeof e.find === "string" && e.find && typeof e.replace === "string")
    ? obj.edits as Edit[] : undefined;
  return { verdict: obj.verdict as FixReview["verdict"], reasons: obj.reasons.slice(0, 5) as string[], ...(obj.verdict === "revise" && corrected ? { edits: corrected } : {}) };
}

// Shared by the CLI and tests; no branch or build is touched until review finishes.
export async function reviewProposal(shop: Shop, runs: RunRecord[], files: string[], proposal: FixProposal, roundId: string, report: (review: FixReview) => void): Promise<{ proposal: FixProposal; review: FixReview; accepted: boolean }> {
  let review = await reviewFix(shop, runs, files, proposal, `${roundId}/fix/review`);
  report(review);
  let retried = false;
  if (review.verdict === "revise" && !review.edits) {
    retried = true;
    proposal = await proposeFix(shop, runs, files, `${roundId}/fix/patch`, review.reasons);
    review = await reviewFix(shop, runs, files, proposal, `${roundId}/fix/review`);
    report(review);
  }
  const accepted = review.verdict === "approve" || (!retried && !!review.edits);
  if (review.edits) proposal = { ...proposal, edits: review.edits };
  return { proposal, review, accepted };
}

export function applyEdits(sourceDir: string, edits: Edit[]): { applied: Edit[]; failed: { edit: Edit; why: string }[] } {
  const applied: Edit[] = [];
  const failed: { edit: Edit; why: string }[] = [];
  for (const e of edits) {
    const path = join(sourceDir, e.file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      failed.push({ edit: e, why: "no such file" });
      continue;
    }
    const at = text.indexOf(e.find);
    if (!e.find || at < 0) failed.push({ edit: e, why: "text to replace not found" });
    else if (text.indexOf(e.find, at + 1) >= 0) failed.push({ edit: e, why: "text to replace is not unique" });
    else {
      writeFileSync(path, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
      applied.push(e);
    }
  }
  return { applied, failed };
}

// Puts the edits on a fresh branch from the defect commit and commits them.
export function branchWithEdits(shop: Shop, branch: string, proposal: FixProposal): { commit: string; diff: string; failed: { edit: Edit; why: string }[] } {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  sh(`git checkout -q -B ${q(branch)} ${q(shop.defect.commit)}`, shop.sourceDir);
  const { applied, failed } = applyEdits(shop.sourceDir, proposal.edits);
  if (!applied.length) return { commit: "", diff: "", failed };
  sh(`git add -A`, shop.sourceDir, { quiet: true });
  sh(`git -c user.name=walkout -c user.email=walkout@localhost commit -q -m ${q("walkout fix: " + proposal.summary.slice(0, 200))}`, shop.sourceDir, { quiet: true });
  return {
    commit: sh("git rev-parse HEAD", shop.sourceDir, { quiet: true }).trim(),
    diff: sh(`git diff ${q(shop.defect.commit)} HEAD`, shop.sourceDir, { quiet: true }),
    failed,
  };
}
