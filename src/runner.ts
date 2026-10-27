// One shopper, one run: a fresh browser context dressed as the persona's
// device and network, the probe injected before the shop's own scripts, and
// the observe, decide, act loop until the order is placed, the shopper gives
// up, or the step limit.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { decide, type Memory, type Perception } from "./agent.ts";
import { BudgetError } from "./meta.ts";
import { isOrderPlaced, type Shop } from "./shop.ts";
import { deriveFindings } from "./telemetry.ts";
import type { Action, Outcome, Persona, RawTelemetry, RunRecord, Step } from "./types.ts";

export interface RunOptions {
  round: string;
  roundDir: string;
  shop: Shop;
  build: string;
  url: string; // where this build's shop starts
  probePath: string;
  maxSteps: number;
  decideFn?: typeof decide; // swapped out in tests
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Interactive things a sighted person could click or type into, visible in
// the viewport and not covered by something else. Labels use only text a
// sighted person can see, never aria-label. A string so the bundler does not
// touch it on its way into the page.
const SCAN_MARKS = String.raw`(() => {
  const W = innerWidth, H = innerHeight;
  const vv = window.visualViewport || { scale: 1, offsetLeft: 0, offsetTop: 0 };
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[role=option],[role=combobox],[role=textbox],[role=switch],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]';
  const picked = [];
  const seen = new Set();
  const txt = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= H || r.left >= W) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) return null;
    return { r, cx, cy };
  };
  const add = (el) => {
    if (seen.has(el)) return;
    for (let p = el.parentElement; p; p = p.parentElement) if (seen.has(p)) return;
    const v = visible(el);
    if (!v) return;
    seen.add(el);
    picked.push({ el, ...v });
  };
  for (const el of document.querySelectorAll(sel)) add(el);
  for (const el of document.querySelectorAll('body *')) {
    if (picked.length > 150) break;
    if (seen.has(el)) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    add(el);
  }
  const label = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    let kind = role || (tag === 'a' ? 'link' : tag === 'input' ? type + ' field' : tag === 'select' ? 'dropdown' : tag);
    if (tag === 'input' && ['submit', 'button'].includes(type)) kind = 'button';
    if (tag === 'input' && ['checkbox', 'radio'].includes(type)) kind = type + (el.checked ? ' (checked)' : '');
    let name = tag === 'select' ? txt(el.selectedOptions && el.selectedOptions[0] && el.selectedOptions[0].text) : txt(el.innerText);
    if (!name && 'value' in el && tag === 'input' && !['checkbox', 'radio'].includes(type)) name = txt(el.value);
    if (!name) name = txt(el.getAttribute('placeholder'));
    if (!name && el.querySelector && el.querySelector('img,svg')) name = '(image or icon, no text)';
    const opts = tag === 'select' ? ', choices: ' + Array.from(el.options).slice(0, 12).map((o) => txt(o.text)).join(', ') : '';
    return kind + (name ? ' "' + name.slice(0, 60) + '"' : ' (no visible text)') + opts;
  };
  return picked.map((p, i) => ({
    id: String(i + 1),
    label: label(p.el),
    x: Math.round(p.cx),
    y: Math.round(p.cy),
    // The screenshot shows the visual viewport. When a page is wider than the
    // phone, Chrome zooms it out, so layout pixels and screen pixels differ.
    sx: Math.round((p.cx - vv.offsetLeft) * vv.scale),
    sy: Math.round((p.cy - vv.offsetTop) * vv.scale),
    box: [Math.round((p.r.left - vv.offsetLeft) * vv.scale), Math.round((p.r.top - vv.offsetTop) * vv.scale), Math.round(p.r.width * vv.scale), Math.round(p.r.height * vv.scale)],
  }));
})()`;

interface Mark {
  id: string;
  label: string;
  x: number; // centre in layout pixels, for elementFromPoint
  y: number;
  sx: number; // centre in screen pixels, as on the screenshot
  sy: number;
  box: [number, number, number, number];
}

async function composeMarks(compositor: Page, png: Buffer, marks: Mark[], w: number, h: number): Promise<Buffer> {
  await compositor.setViewportSize({ width: w, height: h });
  const boxes = marks
    .map(({ id, box: [x, y, bw, bh] }) => {
      const lx = Math.max(0, Math.min(x, w - 22));
      const ly = Math.max(0, Math.min(y, h - 16));
      return (
        `<div style="position:absolute;left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;outline:2px solid #ffd400;outline-offset:-1px"></div>` +
        `<div style="position:absolute;left:${lx}px;top:${ly}px;background:#ffd400;color:#000;font:bold 12px/14px monospace;padding:1px 3px;border:1px solid #000">${id}</div>`
      );
    })
    .join("");
  await compositor.setContent(
    `<html><body style="margin:0"><div style="position:relative;width:${w}px;height:${h}px;background:url(data:image/png;base64,${png.toString("base64")}) 0 0/${w}px ${h}px no-repeat">${boxes}</div></body></html>`,
  );
  return compositor.screenshot();
}

function emptyTelemetry(): RawTelemetry {
  return { inputs: [], mutations: [], requests: [], navigations: [], eventTimings: [], loafs: [], vitals: [], errors: [], spans: [] };
}

async function dressContext(browser: Browser, persona: Persona, probePath: string, raw: RawTelemetry) {
  const d = persona.device;
  const ctx = await browser.newContext({
    viewport: d.viewport,
    screen: d.viewport,
    deviceScaleFactor: d.deviceScaleFactor,
    isMobile: d.isMobile,
    hasTouch: d.hasTouch,
    userAgent: d.userAgent,
    locale: d.locale,
    timezoneId: d.timezoneId,
    reducedMotion: d.reducedMotion ?? "no-preference",
    forcedColors: d.forcedColors ?? "none",
  });
  await ctx.exposeFunction("__walkoutEmit", (batch: { kind: string; [k: string]: unknown }[]) => {
    for (const { kind, ...e } of batch) {
      if (kind === "input") raw.inputs.push(e as RawTelemetry["inputs"][number]);
      else if (kind === "mutations") raw.mutations.push(e as RawTelemetry["mutations"][number]);
      else if (kind === "eventTiming") raw.eventTimings.push(e as RawTelemetry["eventTimings"][number]);
      else if (kind === "loaf") raw.loafs.push(e as RawTelemetry["loafs"][number]);
      else if (kind === "vital") raw.vitals.push(e as RawTelemetry["vitals"][number]);
      else if (kind === "error") raw.errors.push(e as RawTelemetry["errors"][number]);
      else if (kind === "span") raw.spans.push(e as RawTelemetry["spans"][number]);
    }
  });
  await ctx.addInitScript({ path: probePath });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (d.cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpuThrottle });
  if (d.network) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: d.network.latencyMs,
      downloadThroughput: d.network.downloadBps,
      uploadThroughput: d.network.uploadBps,
    });
  }
  if (d.visionDeficiency) await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: d.visionDeficiency });

  const open = new Map<object, RawTelemetry["requests"][number]>();
  page.on("request", (req) => {
    if (req.url().startsWith("data:") || req.url().startsWith("blob:")) return;
    const r = { t: Date.now(), url: req.url(), method: req.method(), type: req.resourceType() };
    open.set(req, r);
    raw.requests.push(r);
  });
  page.on("requestfinished", async (req) => {
    const r = open.get(req);
    if (!r) return;
    r.tEnd = Date.now();
    r.status = (await req.response().catch(() => null))?.status();
  });
  page.on("requestfailed", (req) => {
    const r = open.get(req);
    if (!r) return;
    r.tEnd = Date.now();
    r.failed = req.failure()?.errorText ?? "failed";
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) raw.navigations.push({ t: Date.now(), url: f.url() });
  });
  trackApi(page);
  page.on("pageerror", (e) => raw.errors.push({ t: Date.now(), message: e.message, stack: e.stack, source: "pageerror" }));
  page.on("console", (m) => {
    if (m.type() === "error") raw.errors.push({ t: Date.now(), message: m.text().slice(0, 500), source: "console" });
  });
  return { ctx, page };
}

// The wait before each screenshot ends when the shop's own /api/ calls have
// gone quiet: none in flight and none started for QUIET_MS, capped at 30 s.
// The shop's telemetry and polling never let the whole network go quiet, so
// only /api/ counts. On a slow phone the cart briefly reads "empty" until its
// /api/cart answer lands; a screenshot taken before that misleads the shopper.
const QUIET_MS = 1500;
const SETTLE_CAP_MS = 30_000;
const apiTraffic = new WeakMap<Page, { inflight: Set<unknown>; last: number }>();

function trackApi(page: Page) {
  const t = { inflight: new Set<unknown>(), last: Date.now() };
  apiTraffic.set(page, t);
  const isApi = (url: string) => new URL(url).pathname.startsWith("/api/");
  page.on("request", (r) => {
    if (!isApi(r.url())) return;
    t.inflight.add(r);
    t.last = Date.now();
  });
  const end = (r: { url(): string }) => {
    if (t.inflight.delete(r)) t.last = Date.now();
  };
  page.on("requestfinished", end);
  page.on("requestfailed", end);
}

async function settle(page: Page, glanceMs?: number) {
  if (glanceMs) return sleep(glanceMs);
  const t0 = Date.now();
  await sleep(1000);
  await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_CAP_MS }).catch(() => {});
  const t = apiTraffic.get(page);
  while (t && Date.now() - t0 < SETTLE_CAP_MS) {
    if (t.inflight.size === 0 && Date.now() - t.last >= QUIET_MS) break;
    await sleep(250);
  }
  await sleep(300);
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText : ''").then(String).catch(() => "");
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function runPersona(browser: Browser, persona: Persona, opts: RunOptions): Promise<RunRecord> {
  const decideFn = opts.decideFn ?? decide;
  const dir = join(opts.roundDir, persona.card.id);
  mkdirSync(join(dir, "shots"), { recursive: true });
  const raw = emptyTelemetry();
  const started = Date.now();
  const steps: Step[] = [];
  const memory: Memory[] = [];
  let outcome: Outcome | null = null;
  let ctx: BrowserContext | undefined;
  let compositorCtx: BrowserContext | undefined;
  const { width: vw, height: vh } = persona.device.viewport;

  try {
    const dressed = await dressContext(browser, persona, opts.probePath, raw);
    ctx = dressed.ctx;
    const page = dressed.page;
    compositorCtx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const compositor = await compositorCtx.newPage();

    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await settle(page, persona.device.glanceMs);

    let prevPng: Buffer | null = null;
    let prevUrl = page.url();
    for (let i = 1; i <= opts.maxSteps && !outcome; i++) {
      const tObserve = Date.now();
      const png = await page.screenshot({ scale: "css", timeout: 30_000 }).catch(() => null);
      const shot = png ? `shots/step-${pad(i)}.png` : null;
      if (png && shot) writeFileSync(join(dir, shot), png);
      const perception: Perception = { url: page.url(), title: await page.title().catch(() => "") };
      let marks: Mark[] = [];
      let marked: string | null = null;
      let treeFile: string | null = null;
      if (persona.observation === "a11y-tree") {
        const tree = await page.ariaSnapshot({ mode: "ai", timeout: 15_000 }).catch((e) => `(could not read the page: ${e})`);
        perception.tree = tree.length > 15_000 ? tree.slice(0, 15_000) + "\n(the rest of the page is cut off)" : tree;
        treeFile = `shots/step-${pad(i)}-tree.txt`;
        writeFileSync(join(dir, treeFile), perception.tree);
      } else if (persona.observation === "keyboard") {
        if (png) perception.png = png;
      } else if (png) {
        marks = ((await page.evaluate(SCAN_MARKS).catch(() => [])) as Mark[]) ?? [];
        const mpng = await composeMarks(compositor, png, marks, vw, vh);
        marked = `shots/step-${pad(i)}-marked.png`;
        writeFileSync(join(dir, marked), mpng);
        perception.png = mpng;
        perception.marks = marks.map(({ id, label }) => ({ id, label }));
      }
      const tObserved = Date.now();

      if (memory.length) {
        const last = memory[memory.length - 1];
        if (!last.result) {
          if (page.url() !== prevUrl) last.result = `the page changed to "${perception.title}"`;
          else if (prevPng && png && prevPng.equals(png)) last.result = "nothing on the screen changed";
          else last.result = "the screen changed";
        }
        steps[steps.length - 1].result = last.result;
      }
      prevPng = png;
      prevUrl = page.url();

      let decision;
      try {
        decision = await decideFn(persona, opts.shop.goal, perception, memory, i, opts.maxSteps, `${opts.round}/${persona.card.id}/step-${pad(i)}`);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        decision = await decideFn(persona, opts.shop.goal, perception, memory, i, opts.maxSteps, `${opts.round}/${persona.card.id}/step-${pad(i)}-retry`);
      }
      const action: Action = decision.action;
      const step: Step = {
        index: i,
        tObserve,
        tObserved,
        tAct: Date.now(),
        tSettled: 0,
        url: page.url(),
        title: perception.title,
        screenshot: shot,
        marked,
        tree: treeFile,
        action,
        usage: decision.usage,
      };
      steps.push(step);
      memory.push({ step: i, action, result: "" });

      if (action.action === "give_up") {
        outcome = { kind: "gave_up", reason: action.reason, atStep: i };
        step.tSettled = Date.now();
        break;
      }
      if (action.action === "done") {
        const placed = await isOrderPlaced(opts.shop, page.url(), await pageText(page));
        step.tSettled = Date.now();
        if (placed) outcome = { kind: "bought", reason: "order placed", atStep: i };
        else memory[memory.length - 1].result = "there is no order confirmation on the screen";
        continue;
      }

      try {
        await execute(page, persona, action, marks, step);
      } catch (e) {
        step.actionError = String(e).split("\n")[0].slice(0, 300);
        memory[memory.length - 1].result = "that did not work, nothing happened";
      }
      await settle(page, persona.device.glanceMs);
      step.tSettled = Date.now();
      if (await isOrderPlaced(opts.shop, page.url(), await pageText(page))) {
        outcome = { kind: "bought", reason: "order placed", atStep: i };
        const final = await page.screenshot({ scale: "css" }).catch(() => null);
        if (final) writeFileSync(join(dir, `shots/step-${pad(i)}-after.png`), final);
      }
    }
    if (!outcome) outcome = { kind: "step_limit", reason: `still shopping after ${opts.maxSteps} steps`, atStep: opts.maxSteps };
    await page.evaluate("window.__walkoutDrain ? window.__walkoutEmit(window.__walkoutDrain()) : null").catch(() => {});
    await sleep(300);
  } catch (e) {
    if (e instanceof BudgetError) {
      await ctx?.close().catch(() => {});
      await compositorCtx?.close().catch(() => {});
      throw e;
    }
    outcome = { kind: "error", reason: String(e).split("\n")[0].slice(0, 300), atStep: steps.length };
  } finally {
    await ctx?.close().catch(() => {});
    await compositorCtx?.close().catch(() => {});
  }

  const findings = await deriveFindings(raw, steps);
  const record: RunRecord = {
    persona,
    shop: opts.shop.id,
    build: opts.build,
    goal: opts.shop.goal,
    steps,
    outcome: outcome!,
    findings,
    sentence: null,
    usd: steps.reduce((s, x) => s + (x.usage?.usd ?? 0), 0),
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
  };
  writeFileSync(join(dir, "telemetry.json"), JSON.stringify(raw));
  writeFileSync(join(dir, "run.json"), JSON.stringify(record, null, 2));
  return record;
}

async function execute(page: Page, persona: Persona, action: Action, marks: Mark[], step: Step) {
  const touch = persona.device.hasTouch;
  const pointAt = async (x: number, y: number) => {
    step.point = { x, y };
    if (touch) await page.touchscreen.tap(x, y);
    else {
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.click(x, y);
    }
  };
  // Tap the element under the mark through Playwright, which turns it into a
  // touch or mouse event at the element's on-screen point whatever the zoom.
  const tapMark = async (m: Mark) => {
    step.point = { x: m.sx, y: m.sy };
    const el = (await page.evaluateHandle(([x, y]) => document.elementFromPoint(x, y), [m.x, m.y])).asElement();
    try {
      if (!el) throw new Error("nothing under the mark");
      if (touch) await el.tap({ timeout: 4000 });
      else await el.click({ timeout: 4000 });
    } catch {
      await pointAt(m.sx, m.sy);
    }
    step.point = { x: m.sx, y: m.sy };
  };
  const byRef = async (ref: string) => {
    const loc = page.getByRef(ref);
    step.targetLabel = ref;
    return loc;
  };

  switch (action.action) {
    case "click": {
      if (persona.observation === "a11y-tree") {
        const loc = await byRef(action.target);
        try {
          await loc.click({ timeout: 4000 });
        } catch {
          await loc.focus({ timeout: 2000 });
          await page.keyboard.press("Enter");
        }
        return;
      }
      const m = marks.find((x) => x.id === action.target);
      if (!m) throw new Error(`no mark ${action.target} on the screen`);
      step.targetLabel = m.label;
      await tapMark(m);
      return;
    }
    case "select": {
      // A native picker never shows up in a screenshot, so choosing from a
      // dropdown is its own action, done on the element under the mark.
      if (persona.observation === "a11y-tree") {
        await (await byRef(action.target)).selectOption({ label: action.value }, { timeout: 4000 });
        return;
      }
      const m = marks.find((x) => x.id === action.target);
      if (!m) throw new Error(`no mark ${action.target} on the screen`);
      step.targetLabel = m.label;
      step.point = { x: m.x, y: m.y };
      const el = (await page.evaluateHandle(([x, y]) => document.elementFromPoint(x, y)?.closest("select") ?? null, [m.x, m.y])).asElement();
      if (!el) throw new Error(`mark ${action.target} is not a dropdown`);
      await el.selectOption({ label: action.value }, { timeout: 4000 }).catch(() => el.selectOption(action.value, { timeout: 4000 }));
      return;
    }
    case "type": {
      if (action.target) {
        if (persona.observation === "a11y-tree") {
          const loc = await byRef(action.target);
          await loc.focus({ timeout: 4000 });
        } else if (persona.observation === "screenshot") {
          const m = marks.find((x) => x.id === action.target);
          if (!m) throw new Error(`no mark ${action.target} on the screen`);
          step.targetLabel = m.label;
          await tapMark(m);
          await sleep(200);
        }
      }
      await page.keyboard.type(action.text, { delay: 40 });
      if (action.submit) await page.keyboard.press("Enter");
      return;
    }
    case "press": {
      const key = action.key === "Space" ? "Space" : action.key.replace(/\s+/g, "");
      for (let n = 0; n < (action.times ?? 1); n++) {
        await page.keyboard.press(key);
        await sleep(120);
      }
      return;
    }
    case "scroll":
      if (persona.observation === "keyboard") await page.keyboard.press(action.direction === "down" ? "PageDown" : "PageUp");
      else await page.mouse.wheel(0, (action.direction === "down" ? 0.8 : -0.8) * persona.device.viewport.height);
      await sleep(400);
      return;
    case "wait":
      await sleep(4000);
      return;
    case "back":
      await page.goBack({ waitUntil: "commit", timeout: 20_000 });
      return;
  }
}
