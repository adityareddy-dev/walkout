// Runs inside every shop page before the shop's own scripts (Playwright init
// script). Collects what a shopper's browser saw: OpenTelemetry spans for page
// loads, interactions and fetches, web-vitals with attribution, event timing,
// long animation frames, errors, and whether each tap changed anything.
// Everything is buffered and handed to the runner through window.__walkoutEmit.

import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { onCLS, onINP, onLCP, type INPMetricWithAttribution } from "web-vitals/attribution";

type Emit = (batch: unknown[]) => void;
declare global {
  interface Window {
    __walkoutEmit?: Emit;
    __walkoutDrain?: () => unknown[];
    __walkoutProbe?: boolean;
  }
}

const RESPONSE_WINDOW_MS = 300;
const BACKGROUND_WINDOW_MS = 1000;

(function main() {
  if (window.top !== window || window.__walkoutProbe) return;
  window.__walkoutProbe = true;

  const origin = performance.timeOrigin;
  const now = () => origin + performance.now();
  const buffer: unknown[] = [];
  const push = (kind: string, data: Record<string, unknown>) => buffer.push({ kind, ...data });

  function flush() {
    if (!buffer.length || typeof window.__walkoutEmit !== "function") return;
    const batch = buffer.splice(0, buffer.length);
    try {
      window.__walkoutEmit(batch);
    } catch {
      buffer.unshift(...batch);
    }
  }
  window.__walkoutDrain = () => buffer.splice(0, buffer.length);
  setInterval(flush, 250);
  addEventListener("pagehide", () => {
    closeOpenTaps("pagehide");
    flush();
  });

  function describe(node: EventTarget | Node | null | undefined): string {
    const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    if (!el) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2) : [];
    for (const c of cls) if (c) s += "." + c;
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt");
    if (label) s += `[aria-label="${label.slice(0, 40)}"]`;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (text) s += ` "${text}"`;
    return s;
  }

  // Tap response: a tap counts as answered if, within 300 ms, it added or
  // changed DOM nodes that were not already changing on their own (carousels,
  // spinners), moved focus, or changed the URL. Network is joined later by the
  // runner, which sees every request with its start time.
  const recentlyMutated = new Map<Node, number>();
  interface OpenTap {
    t: number;
    type: string;
    x?: number;
    y?: number;
    key?: string;
    target: string;
    interactive: boolean;
    background: Set<Node>;
    fresh: number;
    scrolled: boolean;
    focusBefore: Element | null;
    url: string;
  }
  const open: OpenTap[] = [];

  const observer = new MutationObserver((records) => {
    const t = now();
    let count = 0;
    for (const r of records) {
      const node = r.target;
      count++;
      for (const tap of open) {
        if (!tap.background.has(node) && !(node.parentNode && tap.background.has(node.parentNode))) tap.fresh++;
      }
      recentlyMutated.set(node, t);
    }
    push("mutations", { t, count });
    if (recentlyMutated.size > 2000) {
      for (const [n, tn] of recentlyMutated) if (t - tn > BACKGROUND_WINDOW_MS) recentlyMutated.delete(n);
    }
  });
  // A link to an anchor on the same page answers by scrolling, which changes
  // nothing in the DOM. That is an answer, not a dead tap.
  document.addEventListener("scroll", () => { for (const tap of open) tap.scrolled = true; }, { capture: true, passive: true });
  const startObserver = () =>
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) startObserver();
  else document.addEventListener("readystatechange", startObserver, { once: true });

  function looksInteractive(el: Element | null): boolean {
    for (let e = el; e; e = e.parentElement) {
      const tag = e.tagName.toLowerCase();
      if (["a", "button", "select", "summary", "label"].includes(tag)) return true;
      const role = e.getAttribute("role");
      if (role && ["button", "link", "menuitem", "tab", "option", "checkbox", "radio", "switch"].includes(role)) return true;
      if (e.hasAttribute("onclick") || e.hasAttribute("tabindex")) return true;
      if (getComputedStyle(e).cursor === "pointer") return true;
    }
    return false;
  }

  function isFormField(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || tag === "option" || (el as HTMLElement).isContentEditable;
  }

  function openTap(type: string, ev: Event, extra: { x?: number; y?: number; key?: string }) {
    const el = ev.target instanceof Element ? ev.target : null;
    if (isFormField(el)) return;
    const t = now();
    const background = new Set<Node>();
    for (const [n, tn] of recentlyMutated) if (t - tn <= BACKGROUND_WINDOW_MS) background.add(n);
    const tap: OpenTap = {
      t,
      type,
      ...extra,
      target: describe(el),
      interactive: looksInteractive(el),
      background,
      fresh: 0,
      scrolled: false,
      focusBefore: document.activeElement,
      url: location.href,
    };
    open.push(tap);
    setTimeout(() => closeTap(tap, "timer"), RESPONSE_WINDOW_MS);
  }

  function closeTap(tap: OpenTap, how: string) {
    const i = open.indexOf(tap);
    if (i < 0) return;
    open.splice(i, 1);
    push("input", {
      t: tap.t,
      type: tap.type,
      x: tap.x,
      y: tap.y,
      key: tap.key,
      target: tap.target,
      interactive: tap.interactive,
      freshMutations: tap.fresh,
      focusMoved: document.activeElement !== tap.focusBefore,
      urlChanged: location.href !== tap.url,
      scrolled: tap.scrolled,
      unloaded: how === "pagehide",
    });
  }
  function closeOpenTaps(how: string) {
    for (const tap of [...open]) closeTap(tap, how);
  }

  // detail is 0 for clicks the browser makes from Enter or Space, which the
  // keydown listener below already counts.
  addEventListener(
    "click",
    (ev) => {
      const m = ev as MouseEvent;
      if (m.detail === 0) return;
      openTap("click", ev, { x: m.clientX, y: m.clientY });
    },
    true,
  );
  addEventListener(
    "keydown",
    (ev) => {
      const k = (ev as KeyboardEvent).key;
      if (k === "Enter" || k === " ") {
        const el = document.activeElement;
        if (el && el !== document.body && !isFormField(el)) openTap("key", { target: el } as unknown as Event, { key: k });
      }
    },
    true,
  );

  // Event timing and long animation frames, the raw material for INP and the
  // script that blocked it.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (!e.interactionId) continue;
        push("eventTiming", {
          t: origin + e.startTime,
          name: e.name,
          interactionId: e.interactionId,
          duration: e.duration,
          inputDelay: e.processingStart - e.startTime,
          processing: e.processingEnd - e.processingStart,
          presentation: e.startTime + e.duration - e.processingEnd,
          target: describe(e.target),
        });
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {}

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceLongAnimationFrameTiming[]) {
        push("loaf", {
          t: origin + e.startTime,
          duration: e.duration,
          blockingDuration: e.blockingDuration,
          scripts: e.scripts.map((s) => ({
            sourceURL: s.sourceURL,
            sourceFunctionName: s.sourceFunctionName,
            sourceCharPosition: s.sourceCharPosition,
            invoker: s.invoker,
            invokerType: s.invokerType,
            duration: s.duration,
          })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}

  const vital = (name: string, value: number, rating: string, attribution: Record<string, unknown>) =>
    push("vital", { t: now(), name, value, rating, attribution });
  onINP(
    (m: INPMetricWithAttribution) => {
      const a = m.attribution;
      const ls = a.longestScript;
      vital("INP", m.value, m.rating, {
        interactionTarget: a.interactionTarget,
        interactionType: a.interactionType,
        interactionTime: a.interactionTime !== undefined ? origin + a.interactionTime : undefined,
        inputDelay: a.inputDelay,
        processingDuration: a.processingDuration,
        presentationDelay: a.presentationDelay,
        loadState: a.loadState,
        longestScript: ls && {
          subpart: ls.subpart,
          intersectingDuration: ls.intersectingDuration,
          sourceURL: ls.entry.sourceURL,
          sourceFunctionName: ls.entry.sourceFunctionName,
          sourceCharPosition: ls.entry.sourceCharPosition,
          invoker: ls.entry.invoker,
        },
      });
    },
    { reportAllChanges: true },
  );
  onLCP((m) => vital("LCP", m.value, m.rating, { target: m.attribution.target, url: m.attribution.url }), {
    reportAllChanges: true,
  });
  onCLS((m) => vital("CLS", m.value, m.rating, { largestShiftTarget: m.attribution.largestShiftTarget }), {
    reportAllChanges: true,
  });

  addEventListener("error", (ev) => {
    const e = ev as ErrorEvent;
    if (e.message) push("error", { t: now(), message: e.message, stack: e.error?.stack, source: "window" });
  });
  addEventListener("unhandledrejection", (ev) => {
    const r = (ev as PromiseRejectionEvent).reason;
    push("error", { t: now(), message: "Unhandled rejection: " + String(r?.message ?? r), stack: r?.stack, source: "window" });
  });

  // OpenTelemetry: a private provider, not registered globally, so a shop that
  // ships its own browser SDK keeps working as before. No user-interaction
  // instrumentation: it wraps every event listener in a function from this
  // init script, and Chrome then leaves the shop's handler out of the long
  // animation frame's script list, which is the code line Walkout needs. Taps
  // are recorded by the listeners above instead.
  class BufferExporter implements SpanExporter {
    export(spans: ReadableSpan[], done: (r: ExportResult) => void) {
      for (const s of spans) {
        const ctx = s.spanContext();
        push("span", {
          name: s.name,
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: s.parentSpanContext?.spanId,
          start: s.startTime[0] * 1000 + s.startTime[1] / 1e6,
          end: s.endTime[0] * 1000 + s.endTime[1] / 1e6,
          attributes: { ...s.attributes },
          events: s.events.map((e) => ({ name: e.name, t: e.time[0] * 1000 + e.time[1] / 1e6 })),
        });
      }
      done({ code: ExportResultCode.SUCCESS });
    }
    shutdown() {
      return Promise.resolve();
    }
  }
  try {
    const provider = new WebTracerProvider({ spanProcessors: [new SimpleSpanProcessor(new BufferExporter())] });
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({ propagateTraceHeaderCorsUrls: [], clearTimingResources: false }),
      ],
    });
  } catch (e) {
    push("error", { t: now(), message: "walkout probe: " + String(e), source: "window" });
  }
})();
