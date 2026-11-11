// Turns a run's raw browser signals into findings a person can act on, each
// pinned to the agent step it happened in and, where the browser said which
// script was running, to the source line.

import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { CodeLocation, Finding, RawTelemetry, Step } from "./types.ts";

export const DEAD_TAP_MS = 300;
export const UNANSWERED_TAP_MS = 1500;
export const SLOW_INTERACTION_MS = 200;
export const SLOW_REQUEST_MS = 3000;

const scriptCache = new Map<string, Promise<string | null>>();
const mapCache = new Map<string, Promise<TraceMap | null>>();

async function fetchText(url: string): Promise<string | null> {
  if (!scriptCache.has(url)) {
    scriptCache.set(
      url,
      fetch(url, { signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null),
    );
  }
  return scriptCache.get(url)!;
}

async function sourceMapFor(url: string): Promise<TraceMap | null> {
  if (!mapCache.has(url)) {
    mapCache.set(
      url,
      (async () => {
        const js = await fetchText(url);
        const m = js?.match(/\/\/[#@] sourceMappingURL=([^\s'"]+)\s*$/);
        let mapUrl = m ? new URL(m[1], url).href : url + ".map";
        if (mapUrl.startsWith("data:")) {
          const b64 = mapUrl.split(",")[1] ?? "";
          return new TraceMap(Buffer.from(b64, "base64").toString("utf8"));
        }
        const text = await fetchText(mapUrl);
        if (!text) return null;
        try {
          return new TraceMap(text);
        } catch {
          return null;
        }
      })(),
    );
  }
  return mapCache.get(url)!;
}

async function withOriginal(loc: CodeLocation): Promise<CodeLocation> {
  const map = await sourceMapFor(loc.url);
  if (!map) return loc;
  const o = originalPositionFor(map, { line: loc.line, column: Math.max(0, loc.column - 1) });
  if (!o.source) return loc;
  return { ...loc, source: o.source, sourceLine: o.line ?? undefined, sourceColumn: o.column ?? undefined, functionName: loc.functionName || o.name || "" };
}

export async function locateCharPosition(url: string, charPos: number, functionName: string): Promise<CodeLocation | undefined> {
  if (!url || charPos < 0) return undefined;
  const js = await fetchText(url);
  if (!js) return { url, line: 0, column: 0, functionName };
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < Math.min(charPos, js.length); i++) {
    if (js.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return withOriginal({ url, line, column: charPos - lastNl, functionName });
}

export async function locateStack(stack: string | undefined): Promise<CodeLocation | undefined> {
  if (!stack) return undefined;
  for (const l of stack.split("\n")) {
    const m = l.match(/at (?:(.+?) \()?(https?:\/\/[^\s)]+):(\d+):(\d+)\)?/);
    if (m) return withOriginal({ url: m[2], line: Number(m[3]), column: Number(m[4]), functionName: m[1] ?? "" });
  }
  return undefined;
}

export function codeText(c: CodeLocation | undefined): string {
  if (!c) return "";
  const fn = c.functionName ? `${c.functionName} ` : "";
  if (c.source) return `${fn}${c.source.replace(/^webpack:\/\/\/?(_N_E\/)?/, "")}:${c.sourceLine}`;
  return `${fn}${c.url.replace(/^https?:\/\/[^/]+/, "")}:${c.line}:${c.column}`;
}

export async function deriveFindings(raw: RawTelemetry, steps: Step[]): Promise<Finding[]> {
  // Frames that start while the runner itself is reading the page (marks,
  // accessibility tree) are the runner's, not the shop's.
  const windows = steps.map((s) => [s.tObserve - 20, s.tObserved + 5] as const);
  const ours = (t: number) => windows.some(([a, b]) => t >= a && t <= b);
  const stepAt = (t: number): number | null => {
    let idx: number | null = null;
    for (const s of steps) if (s.tAct <= t + 5) idx = s.index;
    return idx;
  };
  const findings: Finding[] = [];

  // Dead taps: no fresh DOM change, no focus move, no URL change, no scroll, no request
  // and no navigation within 300 ms.
  const dead: typeof raw.inputs = [];
  for (const inp of raw.inputs) {
    if (inp.unloaded || inp.urlChanged || inp.scrolled || inp.focusMoved || (inp.freshMutations ?? 0) > 0) continue;
    const end = inp.t + DEAD_TAP_MS;
    if (raw.requests.some((r) => r.t >= inp.t && r.t <= end)) continue;
    if (raw.navigations.some((n) => n.t >= inp.t && n.t <= end)) continue;
    dead.push(inp);
    const what = inp.type === "key" ? `Pressing ${inp.key === " " ? "Space" : inp.key} on` : "Tap on";
    findings.push({
      kind: "dead_tap",
      t: inp.t,
      step: stepAt(inp.t),
      target: inp.target,
      summary: `${what} ${inp.target || "the page"} did nothing within ${DEAD_TAP_MS} ms: no change on the page, no request.`,
    });
  }

  // Unanswered taps: the tap sent a request, so it is not dead by the rule
  // above, but nothing on the page changed and the answer came late or never.
  // On a slow phone this is what the shopper sees as a button that does nothing.
  const runEnd = Math.max(...steps.map((s) => s.tSettled || s.tAct), ...raw.inputs.map((i) => i.t));
  for (const inp of raw.inputs) {
    if (inp.unloaded || inp.urlChanged || inp.scrolled || inp.focusMoved || (inp.freshMutations ?? 0) > 0) continue;
    const sent = raw.requests.filter((r) => r.t >= inp.t && r.t <= inp.t + DEAD_TAP_MS && new URL(r.url).pathname.startsWith("/api/"));
    if (!sent.length) continue;
    const pending = sent.filter((r) => r.tEnd === undefined);
    const waitMs = pending.length ? runEnd - inp.t : Math.max(...sent.map((r) => r.tEnd! - inp.t));
    if (waitMs < UNANSWERED_TAP_MS) continue;
    const r = pending[0] ?? sent[0];
    const path = new URL(r.url).pathname;
    findings.push({
      kind: "unanswered_tap",
      t: inp.t,
      step: stepAt(inp.t),
      target: inp.target,
      durationMs: Math.round(waitMs),
      summary: pending.length
        ? `Tap on ${inp.target} sent ${r.method} ${path} and nothing on the page changed; no answer came in the ${(waitMs / 1000).toFixed(1)} s before the shopper moved on.`
        : `Tap on ${inp.target} sent ${r.method} ${path} and nothing on the page changed until the answer came ${(waitMs / 1000).toFixed(1)} s later.`,
    });
  }

  // Rage clicks: three or more clicks within a second in one spot, or the
  // same dead control tried again on later steps.
  const clicks = raw.inputs.filter((i) => i.type === "click").sort((a, b) => a.t - b.t);
  for (let i = 0; i < clicks.length; i++) {
    const burst = [clicks[i]];
    for (let j = i + 1; j < clicks.length && clicks[j].t - burst[burst.length - 1].t < 1000; j++) {
      if (Math.hypot((clicks[j].x ?? 0) - (clicks[i].x ?? 0), (clicks[j].y ?? 0) - (clicks[i].y ?? 0)) < 40) burst.push(clicks[j]);
    }
    if (burst.length >= 3) {
      findings.push({ kind: "rage_click", t: burst[0].t, step: stepAt(burst[0].t), target: clicks[i].target, summary: `${burst.length} clicks in a second on ${clicks[i].target}.` });
      i += burst.length - 1;
    }
  }
  const byTarget = new Map<string, typeof dead>();
  for (const d of dead) byTarget.set(d.target, [...(byTarget.get(d.target) ?? []), d]);
  for (const [target, list] of byTarget) {
    if (list.length < 2) continue;
    const stepsHit = [...new Set(list.map((d) => stepAt(d.t)).filter((s) => s !== null))];
    findings.push({
      kind: "rage_click",
      t: list[list.length - 1].t,
      step: stepAt(list[list.length - 1].t),
      target,
      summary: `Tried ${target} ${list.length} times (steps ${stepsHit.join(", ")}), nothing happened any time.`,
    });
  }

  // Slow interactions: the longest event per interaction over 200 ms, with
  // the script that held the main thread during it.
  // Events of one interaction share a frame, so their durations tie; the
  // click or key event names the target best.
  const interactions = new Map<number, RawTelemetry["eventTimings"][number]>();
  const named = (e: { name: string }) => ["click", "keydown", "keyup"].includes(e.name);
  for (const e of raw.eventTimings) {
    const cur = interactions.get(e.interactionId);
    if (!cur || e.duration > cur.duration + 8 || (e.duration >= cur.duration - 8 && named(e) && !named(cur))) interactions.set(e.interactionId, e);
  }
  const loafs = raw.loafs.filter((l) => !ours(l.t));
  for (const e of interactions.values()) {
    if (e.duration <= SLOW_INTERACTION_MS) continue;
    const overlapping = loafs.filter((l) => l.t <= e.t + e.duration && l.t + l.duration >= e.t);
    const scripts = overlapping.flatMap((l) => l.scripts).filter((s) => s.sourceURL);
    scripts.sort((a, b) => b.duration - a.duration);
    const top = scripts[0];
    const code = top ? await locateCharPosition(top.sourceURL, top.sourceCharPosition, top.sourceFunctionName) : undefined;
    findings.push({
      kind: "slow_interaction",
      t: e.t,
      step: stepAt(e.t),
      target: e.target,
      durationMs: Math.round(e.duration),
      code,
      summary:
        `${e.name} on ${e.target || "the page"} took ${Math.round(e.duration)} ms to paint ` +
        `(input delay ${Math.round(e.inputDelay)}, handlers ${Math.round(e.processing)}, paint ${Math.round(e.presentation)})` +
        (top ? `; longest script ${Math.round(top.duration)} ms in ${codeText(code) || top.sourceURL} (${top.invoker}).` : "."),
    });
  }

  // JavaScript errors, once per message.
  const seenErr = new Set<string>();
  for (const err of raw.errors) {
    const key = err.message.replace(/^Uncaught\s+/, "").replace(/^\w*Error:\s*/, "").slice(0, 200);
    if (seenErr.has(key) || /walkout probe/.test(err.message)) continue;
    seenErr.add(key);
    const code = await locateStack(err.stack);
    findings.push({
      kind: "js_error",
      t: err.t,
      step: stepAt(err.t),
      code,
      summary: `${err.source === "console" ? "Console error" : "JavaScript error"}: ${err.message.slice(0, 200)}${code ? ` at ${codeText(code)}` : ""}`,
    });
  }

  // Requests: failures, and the slowest API or page requests.
  for (const r of raw.requests) {
    if ((r.status && r.status >= 400) || (r.failed && !/ERR_ABORTED/.test(r.failed))) {
      findings.push({
        kind: "failed_request",
        t: r.t,
        step: stepAt(r.t),
        summary: `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "")} ${r.status ? `returned ${r.status}` : `failed: ${r.failed}`}.`,
      });
    }
  }
  const slow = raw.requests
    .filter((r) => r.tEnd && r.tEnd - r.t > SLOW_REQUEST_MS && ["fetch", "xhr", "document"].includes(r.type))
    .sort((a, b) => b.tEnd! - b.t - (a.tEnd! - a.t))
    .slice(0, 5);
  for (const r of slow) {
    findings.push({
      kind: "slow_request",
      t: r.t,
      step: stepAt(r.t),
      durationMs: r.tEnd! - r.t,
      summary: `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "")} took ${((r.tEnd! - r.t) / 1000).toFixed(1)} s.`,
    });
  }

  return findings.sort((a, b) => a.t - b.t);
}
