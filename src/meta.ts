// Meta Model API client (OpenAI-compatible chat completions at api.meta.ai/v1)
// with a spend ledger. Every call is priced from its token usage at the list
// price and appended to spend/meta.jsonl; a call that would take the total
// past the budget is refused before it is sent.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelUsage } from "./types.ts";

const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

// USD per million tokens, input and output (dev.meta.ai pricing, 2026-10-25).
// Cached input is charged at the full input price here, so the ledger errs high.
export const PRICES: Record<string, { input: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2 },
  "muse-spark-1.2-contributor": { input: 0.1, output: 0.2 },
  "muse-wonder-1.0": { input: 4, output: 20 },
};

export const LEDGER = process.env.WALKOUT_LEDGER ?? join(import.meta.dirname, "..", "spend", "meta.jsonl");
export const BUDGET_USD = Number(process.env.WALKOUT_BUDGET_USD ?? "20");

export class BudgetError extends Error {}

// Spend per round (the first part of each call's purpose), from the ledger.
export function spentByRound(): Map<string, { calls: number; usd: number }> {
  const out = new Map<string, { calls: number; usd: number }>();
  if (!existsSync(LEDGER)) return out;
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    const k = String(d.purpose ?? "").split("/")[0] || "(none)";
    const r = out.get(k) ?? { calls: 0, usd: 0 };
    r.calls++;
    r.usd += Number(d.usd) || 0;
    out.set(k, r);
  }
  return out;
}

export function spentUsd(): number {
  if (!existsSync(LEDGER)) return 0;
  let total = 0;
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    total += Number(JSON.parse(line).usd) || 0;
  }
  return total;
}

export function recordSpend(entry: { purpose: string; model: string; usd: number; [k: string]: unknown }) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
}

export function assertBudget(nextUsd: number, what: string) {
  const spent = spentUsd();
  if (spent + nextUsd > BUDGET_USD) {
    throw new BudgetError(
      `Meta API spend past ${BUDGET_USD} USD: spent ${spent.toFixed(2)} USD, ${what} about ${nextUsd.toFixed(2)} USD`,
    );
  }
}

function apiKey(): string {
  if (process.env.META_API_KEY) return process.env.META_API_KEY.trim();
  const file = process.env.META_API_KEY_FILE ?? join(homedir(), ".config", "meta", "api-key");
  if (!existsSync(file)) throw new Error(`no Meta API key: set META_API_KEY or put the key in ${file}`);
  return readFileSync(file, "utf8").trim();
}

export type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export interface Message {
  role: "system" | "user" | "assistant";
  content: Content;
}
export interface Tool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  maxTokens: number;
  tools?: Tool[];
  toolChoice?: "auto" | "required" | { type: "function"; function: { name: string } };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  temperature?: number;
  purpose: string;
  // Rough cost this call is allowed to add, for the budget check.
  estimateUsd?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: { name: string; arguments: string }[];
  finishReason: string;
  usage: ModelUsage;
}

export function priceOf(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  assertBudget(req.estimateUsd ?? priceOf(req.model, 8000, req.maxTokens), req.purpose);
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
  };
  if (req.tools) body.tools = req.tools;
  if (req.toolChoice) body.tool_choice = req.toolChoice;
  if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const t0 = Date.now();
  let res: Response | undefined;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      lastErr = String(e);
      res = undefined;
    }
    if (res && res.status !== 429 && res.status < 500) break;
    if (res) lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res) throw new Error(`Meta API ${req.model}: ${lastErr}`);
  const raw = await res.text();
  if (!res.ok) throw new Error(`Meta API ${req.model} HTTP ${res.status}: ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  const latencyMs = Date.now() - t0;
  const u = data.usage ?? {};
  const inputTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const cachedTokens = Number(u.prompt_tokens_details?.cached_tokens ?? 0);
  const usd = priceOf(req.model, inputTokens, outputTokens);
  recordSpend({ purpose: req.purpose, model: req.model, inputTokens, cachedTokens, outputTokens, usd, latencyMs });

  const choice = data.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c: { text?: string }) => c.text ?? "").join("") : "";
  const toolCalls = (msg.tool_calls ?? []).map((c: { function: { name: string; arguments: string } }) => ({
    name: c.function?.name,
    arguments: c.function?.arguments ?? "{}",
  }));
  return {
    text,
    toolCalls,
    finishReason: choice.finish_reason ?? "",
    usage: { model: req.model, inputTokens, cachedTokens, outputTokens, usd, latencyMs },
  };
}

export function imagePart(png: Buffer): { type: "image_url"; image_url: { url: string } } {
  return { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } };
}

// Pulls the first JSON object out of a model reply that may wrap it in prose
// or a code fence.
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text;
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
