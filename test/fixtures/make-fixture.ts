// Writes two fake rounds ("fixture-before" and "fixture-after") with 12 personas,
// screenshots and findings, in the same layout a real round writes.
// Usage: tsx test/fixtures/make-fixture.ts [runsRoot]

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Action,
  Finding,
  Outcome,
  Persona,
  PersonaDevice,
  RoundSummary,
  RunRecord,
  RunSummary,
  Step,
} from "../../src/types.ts";
import { encodePng, type Rect, type RGB } from "./png.ts";

export const FIXTURE_BEFORE = "fixture-before";
export const FIXTURE_AFTER = "fixture-after";
export const DEFAULT_FIXTURE_ROOT = "/tmp/walkout-fixture-runs";

const SHOP = "Fixture Shop (fake data)";
const ORIGIN = "http://localhost:4173";
const GOAL = "Buy one pair of Ridge Runner trail shoes in size 42 and reach the order confirmation page.";

type PageKind = "home" | "search" | "product" | "cart" | "checkout" | "confirm";

interface StepSpec {
  page: PageKind;
  action: Action;
  targetLabel?: string;
  actionError?: string;
  // Draws a banner over the lower part of the page (the chat banner in Ruth's run).
  banner?: boolean;
}

interface FindingSpec {
  kind: Finding["kind"];
  step: number;
  summary: string;
  durationMs?: number;
  target?: string;
  code?: Finding["code"];
}

interface RunScript {
  outcome: Outcome;
  steps: StepSpec[];
  findings: FindingSpec[];
  sentence: string | null;
}

interface FixturePersona {
  persona: Persona;
  before: RunScript;
  after: RunScript;
}

const PAGE_INFO: Record<PageKind, { path: string; title: string }> = {
  home: { path: "/", title: "Fixture Shop" },
  search: { path: "/search?q=trail+running+shoes", title: "Search results" },
  product: { path: "/p/ridge-runner", title: "Ridge Runner Trail Shoe" },
  cart: { path: "/cart", title: "Your cart" },
  checkout: { path: "/checkout", title: "Checkout" },
  confirm: { path: "/order/10482", title: "Order confirmed" },
};

const APP_JS = `${ORIGIN}/assets/app-3f9c2.js`;
const I18N_JS = `${ORIGIN}/assets/i18n-77b1e.js`;

const mobile = (extra: Partial<PersonaDevice> = {}): PersonaDevice => ({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "en-GB",
  timezoneId: "Europe/London",
  cpuThrottle: 1,
  ...extra,
});

const desktop = (extra: Partial<PersonaDevice> = {}): PersonaDevice => ({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: "en-GB",
  timezoneId: "Europe/London",
  cpuThrottle: 1,
  ...extra,
});

const s = {
  search: (text = "trail running shoes"): StepSpec => ({
    page: "home",
    action: { action: "type", target: "Search products", text, submit: true, why: "The search box is the quickest way to find the shoes." },
  }),
  featured: (): StepSpec => ({
    page: "home",
    action: { action: "click", target: "Ridge Runner Trail Shoe", why: "The shoe I want is right there in the featured row." },
    targetLabel: "Ridge Runner Trail Shoe",
  }),
  result: (): StepSpec => ({
    page: "search",
    action: { action: "click", target: "Ridge Runner Trail Shoe", why: "This is the first trail shoe in the results and it is in my price range." },
    targetLabel: "Ridge Runner Trail Shoe",
  }),
  size: (): StepSpec => ({
    page: "product",
    action: { action: "click", target: "Size 42", why: "I need size 42 before I can add the shoes." },
    targetLabel: "Size 42",
  }),
  add: (why = "Size 42 is selected, so I add the shoes to the cart."): StepSpec => ({
    page: "product",
    action: { action: "click", target: "Add to cart", why },
    targetLabel: "Add to cart",
  }),
  checkout: (): StepSpec => ({
    page: "cart",
    action: { action: "click", target: "Checkout", why: "The shoes are in the cart. Time to pay." },
    targetLabel: "Checkout",
  }),
  address: (): StepSpec => ({
    page: "checkout",
    action: { action: "type", target: "Street address", text: "12 Harbour Road", why: "The form asks for my delivery address." },
    targetLabel: "Street address",
  }),
  place: (): StepSpec => ({
    page: "checkout",
    action: { action: "click", target: "Place order", why: "Address and card are filled in, so I place the order." },
    targetLabel: "Place order",
  }),
  done: (): StepSpec => ({
    page: "confirm",
    action: { action: "done", why: "The page says my order is confirmed." },
  }),
};

function bought(variant: "search" | "featured"): RunScript {
  const start = variant === "search" ? [s.search(), s.result()] : [s.featured()];
  const steps = [...start, s.size(), s.add(), s.checkout(), s.address(), s.place(), s.done()];
  return {
    outcome: { kind: "bought", reason: "Reached the order confirmation page.", atStep: steps.length },
    steps,
    findings: [],
    sentence: null,
  };
}

const PERSONAS: FixturePersona[] = [
  {
    persona: {
      card: {
        id: "p01",
        name: "Dana Okafor",
        life: "Night-shift nurse shopping on a cheap Android phone during her break.",
        constraints: ["Budget Android phone, CPU about 6x slower than a laptop", "Uses the phone with one thumb", "Has about ten minutes"],
        patience: "Low: two taps that do nothing and she moves on.",
      },
      device: mobile({ cpuThrottle: 6 }),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "gave_up", reason: "Tapped Add to cart twice and nothing happened.", atStep: 6 },
      steps: [
        s.search(),
        s.result(),
        s.size(),
        s.add(),
        { page: "product", action: { action: "click", target: "Add to cart", why: "Nothing happened, so I tap it again." }, targetLabel: "Add to cart" },
        { page: "product", action: { action: "give_up", reason: "I tapped Add to cart twice and nothing happened.", why: "My break is nearly over." } },
      ],
      findings: [
        { kind: "dead_tap", step: 4, summary: "Tap on Add to cart changed nothing on screen for 2.8 s.", target: "button.add-to-cart" },
        { kind: "rage_click", step: 5, summary: "Two taps on Add to cart within 3 s.", target: "button.add-to-cart" },
        {
          kind: "slow_interaction",
          step: 4,
          summary: "Tap on Add to cart took 2,840 ms to paint, blocked by a long task.",
          durationMs: 2840,
          target: "button.add-to-cart",
          code: { url: APP_JS, line: 1042, column: 17, functionName: "recalcCartTotals", source: "src/cart/totals.ts", sourceLine: 88, sourceColumn: 5 },
        },
      ],
      sentence:
        "Dana gave up on the product page at step 6: she tapped Add to cart twice and nothing happened, because recalcCartTotals in app.js line 1042 blocked her phone for 2.8 seconds.",
    },
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p02",
        name: "Marcus Bell",
        life: "Commuter on a rural train line, buying shoes before his signal drops.",
        constraints: ["Slow 3G: 400 ms latency, 50 KB/s down", "Mid-range phone"],
        patience: "Medium: will wait for one slow page, not three.",
      },
      device: mobile({ network: { latencyMs: 400, downloadBps: 50_000, uploadBps: 20_000, label: "Slow 3G" } }),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "error", reason: "The product page did not settle within 30 seconds.", atStep: 3 },
      steps: [
        s.search(),
        s.result(),
        {
          page: "product",
          action: { action: "wait", why: "The product page is still loading and the size buttons are grey." },
          actionError: "Timeout 30000 ms exceeded while waiting for the page to settle.",
        },
      ],
      findings: [
        { kind: "slow_request", step: 3, summary: "GET /images/ridge-runner-hero.jpg took 24.1 s (2.4 MB).", durationMs: 24100 },
        { kind: "slow_request", step: 3, summary: "GET /api/products/ridge-runner/sizes took 9.6 s.", durationMs: 9600 },
      ],
      sentence:
        "Marcus's run stopped on the product page at step 3: on slow 3G the page never settled, because it downloads a 2.4 MB hero image before the size buttons work.",
    },
    after: {
      ...bought("featured"),
      findings: [{ kind: "slow_request", step: 4, summary: "GET /api/shipping-quote took 3.1 s.", durationMs: 3100 }],
    },
  },
  {
    persona: {
      card: {
        id: "p03",
        name: "Ruth Ellison",
        life: "Retired librarian, 74, who reads every page at 200 percent text size.",
        constraints: ["Browser zoom 200 percent", "Mouse, no touch", "Reads slowly and carefully"],
        patience: "High, but she will not guess at hidden buttons.",
      },
      device: desktop({ deviceScaleFactor: 1 }),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "gave_up", reason: "The Add to cart button is covered by the chat banner.", atStep: 5 },
      steps: [
        s.search(),
        s.result(),
        { page: "product", action: { action: "scroll", direction: "down", why: "At this size the size buttons are below the fold." }, banner: true },
        { ...s.add("I can see part of the Add to cart button under the banner."), banner: true },
        {
          page: "product",
          action: { action: "give_up", reason: "The Add to cart button is covered by a chat banner and I cannot reach it." },
          banner: true,
        },
      ],
      findings: [
        { kind: "dead_tap", step: 4, summary: "Click landed on div.chat-banner instead of Add to cart.", target: "div.chat-banner" },
      ],
      sentence:
        "Ruth gave up on the product page at step 5: at 200 percent text size the sticky chat banner covers the Add to cart button, so her clicks landed on the banner.",
    },
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p04",
        name: "Tomás Reyes",
        life: "Accountant with a wrist injury who uses only the keyboard.",
        constraints: ["Keyboard only: Tab, Shift+Tab, Enter, Space, arrows", "No mouse or trackpad"],
        patience: "Medium: a few retries, then he calls the shop.",
      },
      device: desktop(),
      observation: "keyboard",
    },
    before: {
      outcome: { kind: "gave_up", reason: "The size options cannot be reached with the keyboard.", atStep: 6 },
      steps: [
        s.search(),
        { page: "search", action: { action: "press", key: "Tab", why: "Moving focus to the first result." } },
        { page: "search", action: { action: "press", key: "Enter", why: "Focus is on Ridge Runner Trail Shoe, so I open it." } },
        { page: "product", action: { action: "press", key: "Tab", why: "Looking for the size options." } },
        { page: "product", action: { action: "press", key: "Tab", why: "Focus jumped from the product title to the footer and skipped the sizes." } },
        { page: "product", action: { action: "give_up", reason: "I cannot reach the size options with Tab, so I cannot pick size 42." } },
      ],
      findings: [],
      sentence:
        "Tomás gave up on the product page at step 6: the size options are clickable divs that Tab skips, so with only a keyboard he could not pick size 42.",
    },
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p05",
        name: "Amara Nwosu",
        life: "Law student, blind since birth, who shops with a screen reader.",
        constraints: ["Screen reader, no visual access", "Navigates by headings, buttons and form labels"],
        patience: "High, until controls have no names.",
      },
      device: desktop({ reducedMotion: "reduce" }),
      observation: "a11y-tree",
    },
    before: {
      outcome: { kind: "gave_up", reason: "Buttons on the product page have no names.", atStep: 5 },
      steps: [
        s.search(),
        s.result(),
        s.size(),
        { page: "product", action: { action: "click", target: "button (no name)", why: "There are three buttons called just \"button\". I try the first one." } },
        { page: "product", action: { action: "give_up", reason: "I cannot tell which unnamed button adds the shoes to the cart." } },
      ],
      findings: [{ kind: "dead_tap", step: 4, summary: "Activated an unnamed button that toggles the wishlist, not the cart.", target: "button.icon-heart" }],
      sentence:
        "Amara gave up on the product page at step 5: her screen reader announced the cart button only as \"button\", with no name, so she could not tell which one adds the shoes.",
    },
    after: {
      outcome: { kind: "step_limit", reason: "Reached the step limit on the checkout page.", atStep: 8 },
      steps: [
        s.search(),
        s.result(),
        s.size(),
        s.add(),
        s.checkout(),
        s.address(),
        { page: "checkout", action: { action: "type", target: "edit text", text: "4111 1111 1111 1111", why: "The next field is only read as \"edit text\". It might be the card number." } },
        { page: "checkout", action: { action: "press", key: "Shift+Tab", why: "The page says the postcode is invalid, so I typed the card number in the wrong field." } },
      ],
      findings: [],
      sentence:
        "Amara ran out of steps at checkout: the payment fields have no labels, so her screen reader read each one as \"edit text\" and she could not tell the card number from the postcode.",
    },
  },
  {
    persona: {
      card: {
        id: "p06",
        name: "Lucía Fernández",
        life: "Grandmother in Valencia who keeps her browser in Spanish.",
        constraints: ["Browser language es-ES, prices in euro", "Reads English slowly", "Tablet"],
        patience: "Medium, but she will not pay a total she cannot read.",
      },
      device: mobile({ viewport: { width: 390, height: 844 }, locale: "es-ES", timezoneId: "Europe/Madrid" }),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "gave_up", reason: "The cart total shows NaN.", atStep: 5 },
      steps: [
        s.search("zapatillas de trail"),
        s.result(),
        s.size(),
        s.add("Talla 42 seleccionada. Add to cart."),
        { page: "cart", action: { action: "give_up", reason: "The total says \"NaN €\" and I do not trust paying that." } },
      ],
      findings: [
        {
          kind: "js_error",
          step: 4,
          summary: "TypeError: Cannot read properties of undefined (reading 'currencyDisplay')",
          code: { url: I18N_JS, line: 77, column: 23, functionName: "formatPrice", source: "src/i18n/price.ts", sourceLine: 31, sourceColumn: 12 },
        },
      ],
      sentence:
        "Lucía gave up in the cart at step 5: with a Spanish browser the total showed \"NaN €\", because formatPrice in i18n.js line 77 throws for the es-ES locale.",
    },
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p07",
        name: "Kenji Mori",
        life: "Developer who gives any page about three seconds before closing the tab.",
        constraints: ["Fast laptop and fibre", "Skims, never reads help text"],
        patience: "Very low.",
      },
      device: desktop(),
      observation: "screenshot",
    },
    before: bought("featured"),
    after: bought("featured"),
  },
  {
    persona: {
      card: {
        id: "p08",
        name: "Priya Raman",
        life: "Graphic designer with red-green colour blindness.",
        constraints: ["Deuteranopia: red and green look alike", "Laptop"],
        patience: "Medium.",
      },
      device: desktop({ visionDeficiency: "deuteranopia" }),
      observation: "screenshot",
    },
    before: bought("search"),
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p09",
        name: "Walter Brooks",
        life: "Widower, 80, buying his first thing online: a gift for his granddaughter.",
        constraints: ["New to online shops", "Desktop with a large monitor", "Unsure which buttons are safe to press"],
        patience: "High, but easily lost.",
      },
      device: desktop(),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "step_limit", reason: "Reached the step limit in the cart.", atStep: 8 },
      steps: [
        s.search(),
        s.result(),
        s.size(),
        s.add(),
        { page: "cart", action: { action: "click", target: "Continue shopping", why: "This is the only button that looks like it goes forward." }, targetLabel: "Continue shopping" },
        { page: "product", action: { action: "click", target: "Cart (1)", why: "Back on the shoe. I go back to the cart to look again." }, targetLabel: "Cart (1)" },
        { page: "cart", action: { action: "scroll", direction: "down", why: "Looking for a way to pay." } },
        { page: "cart", action: { action: "click", target: "Delivery information", why: "Maybe paying is explained here." }, targetLabel: "Delivery information" },
      ],
      findings: [{ kind: "dead_tap", step: 7, summary: "Click on the grey Checkout label area did nothing.", target: "div.cart-summary" }],
      sentence:
        "Walter ran out of steps in the cart: the Checkout button is light grey text on white and looks disabled, so he kept looking for another way to pay.",
    },
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p10",
        name: "Sam Kowalski",
        life: "Parent shopping one-handed on a phone with a toddler on one hip.",
        constraints: ["One thumb, often interrupted", "Phone on 4G"],
        patience: "Low.",
      },
      device: mobile(),
      observation: "screenshot",
    },
    before: {
      outcome: { kind: "gave_up", reason: "The cart was empty after adding the shoes.", atStep: 5 },
      steps: [
        s.featured(),
        s.size(),
        s.add(),
        { page: "cart", action: { action: "back", why: "The cart is empty. Maybe the add did not work." } },
        { page: "product", action: { action: "give_up", reason: "I added the shoes but the cart stays empty, and I have no time for this." } },
      ],
      findings: [
        { kind: "failed_request", step: 3, summary: "POST /api/cart returned 503 and the page showed no message.", target: "button.add-to-cart" },
        { kind: "js_error", step: 3, summary: "Unhandled promise rejection: Error: cart sync failed", code: { url: APP_JS, line: 2210, column: 9, functionName: "syncCart", source: "src/cart/sync.ts", sourceLine: 54, sourceColumn: 3 } },
      ],
      sentence:
        "Sam gave up on the product page at step 5: the cart stayed empty after adding the shoes, because POST /api/cart failed with status 503 and the page showed no message.",
    },
    after: bought("featured"),
  },
  {
    persona: {
      card: {
        id: "p11",
        name: "Femi Adeyemi",
        life: "Teacher with a vestibular disorder who turns off animations everywhere.",
        constraints: ["Reduced motion on", "Gets dizzy from carousels and parallax"],
        patience: "Medium.",
      },
      device: mobile({ reducedMotion: "reduce" }),
      observation: "screenshot",
    },
    before: bought("search"),
    after: bought("search"),
  },
  {
    persona: {
      card: {
        id: "p12",
        name: "Ingrid Halvorsen",
        life: "Low-vision data analyst who uses Windows high contrast mode.",
        constraints: ["Forced colours on", "Large cursor"],
        patience: "Medium.",
      },
      device: desktop({ forcedColors: "active" }),
      observation: "screenshot",
    },
    before: bought("featured"),
    after: bought("featured"),
  },
];

// Simple wireframe of each page so the replay visibly changes between steps.
function pageRects(kind: PageKind, w: number, h: number, wide: boolean, banner: boolean): { rects: Rect[]; target: Rect } {
  const grey: RGB = [226, 230, 236];
  const dark: RGB = [31, 58, 61];
  const accent: RGB = [232, 118, 38];
  const r = (x: number, y: number, rw: number, rh: number, color: RGB): Rect => ({ x: x * w, y: y * h, w: rw * w, h: rh * h, color });
  const rects: Rect[] = [r(0, 0, 1, 0.07, dark), r(0.05, 0.015, 0.25, 0.04, [70, 110, 114])];
  let target: Rect;
  const cols = wide ? 4 : 2;
  const cw = 0.9 / cols;
  switch (kind) {
    case "home": {
      rects.push(r(0.05, 0.1, 0.9, 0.06, grey));
      rects.push(r(0.05, 0.19, 0.9, 0.25, [196, 214, 220]));
      for (let i = 0; i < cols * 2; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        rects.push(r(0.05 + col * cw + 0.01, 0.48 + row * 0.24, cw - 0.02, 0.2, grey));
      }
      target = rects[4]!;
      break;
    }
    case "search": {
      for (let i = 0; i < 5; i++) {
        rects.push(r(0.05, 0.1 + i * 0.16, 0.9, 0.13, grey));
        rects.push(r(0.07, 0.115 + i * 0.16, wide ? 0.12 : 0.25, 0.1, [196, 214, 220]));
      }
      target = rects[2]!;
      break;
    }
    case "product": {
      rects.push(wide ? r(0.05, 0.1, 0.45, 0.6, [196, 214, 220]) : r(0.05, 0.1, 0.9, 0.35, [196, 214, 220]));
      const x0 = wide ? 0.55 : 0.05;
      const y0 = wide ? 0.12 : 0.48;
      rects.push(r(x0, y0, wide ? 0.3 : 0.7, 0.04, [60, 66, 74]));
      for (let i = 0; i < 6; i++) rects.push(r(x0 + i * (wide ? 0.06 : 0.15), y0 + 0.08, wide ? 0.05 : 0.12, 0.05, i === 2 ? [60, 66, 74] : grey));
      target = r(x0, y0 + 0.18, wide ? 0.38 : 0.9, 0.07, accent);
      rects.push(target);
      if (banner) rects.push(r(0, 0.62, 1, 0.38, [56, 92, 160]));
      break;
    }
    case "cart": {
      rects.push(r(0.05, 0.1, 0.9, 0.14, grey));
      rects.push(r(0.05, 0.27, 0.9, 0.2, [240, 242, 245]));
      target = r(0.05, 0.52, 0.9, 0.07, accent);
      rects.push(target);
      break;
    }
    case "checkout": {
      for (let i = 0; i < 5; i++) rects.push(r(0.05, 0.1 + i * 0.09, wide ? 0.5 : 0.9, 0.06, grey));
      target = r(0.05, 0.58, wide ? 0.5 : 0.9, 0.07, accent);
      rects.push(target);
      break;
    }
    case "confirm": {
      target = r(0.05, 0.12, 0.9, 0.2, [46, 160, 67]);
      rects.push(target);
      rects.push(r(0.05, 0.36, 0.9, 0.05, grey));
      rects.push(r(0.05, 0.43, 0.6, 0.05, grey));
      break;
    }
  }
  return { rects, target };
}

function markRects(rects: Rect[], w: number): Rect[] {
  const size = Math.max(14, Math.round(w / 40));
  return rects.slice(1).map((rc) => ({ x: rc.x + 2, y: rc.y + 2, w: size, h: size, color: [250, 204, 21] as RGB }));
}

async function writeRun(root: string, round: string, build: string, fp: FixturePersona, script: RunScript, startMs: number): Promise<RunSummary> {
  const { persona } = fp;
  const dir = join(root, round, persona.card.id);
  await mkdir(join(dir, "shots"), { recursive: true });
  const { width: w, height: h } = persona.device.viewport;
  const wide = w > 700;
  const withShots = persona.observation !== "a11y-tree";
  // Sam's before run only has marked screenshots, to exercise the fallback.
  const markedOnly = persona.card.id === "p10" && round === FIXTURE_BEFORE;
  const steps: Step[] = [];
  let t = startMs;
  for (let i = 0; i < script.steps.length; i++) {
    const spec = script.steps[i]!;
    const n = String(i + 1).padStart(2, "0");
    const info = PAGE_INFO[spec.page];
    let screenshot: string | null = null;
    let marked: string | null = null;
    const { rects, target } = pageRects(spec.page, w, h, wide, spec.banner === true);
    if (withShots) {
      if (!markedOnly) {
        screenshot = `shots/step-${n}.png`;
        await writeFile(join(dir, screenshot), encodePng(w, h, [250, 250, 252], rects));
      }
      marked = `shots/step-${n}-marked.png`;
      await writeFile(join(dir, marked), encodePng(w, h, [250, 250, 252], [...rects, ...markRects(rects, w)]));
    }
    const tObserve = t;
    const tObserved = t + 180;
    const tAct = t + 2400 + (i % 3) * 700;
    const tSettled = tAct + 900 + (i % 2) * 1300;
    t = tSettled + 300;
    const step: Step = {
      index: i + 1,
      tObserve,
      tObserved,
      tAct,
      tSettled,
      url: ORIGIN + info.path,
      title: info.title,
      screenshot,
      marked,
      action: spec.action,
    };
    if (spec.action.action === "click") step.point = { x: Math.round(target.x + target.w / 2), y: Math.round(target.y + target.h / 2) };
    if (spec.targetLabel) step.targetLabel = spec.targetLabel;
    if (spec.actionError) step.actionError = spec.actionError;
    steps.push(step);
  }
  const findings: Finding[] = script.findings.map((f) => {
    const at = steps[f.step - 1] ?? steps[steps.length - 1]!;
    const finding: Finding = { kind: f.kind, t: at.tAct + 150, step: f.step, summary: f.summary };
    if (f.durationMs !== undefined) finding.durationMs = f.durationMs;
    if (f.target) finding.target = f.target;
    if (f.code) finding.code = f.code;
    return finding;
  });
  const usd = Math.round((0.012 * steps.length + 0.004) * 10000) / 10000;
  const record: RunRecord = {
    persona,
    shop: SHOP,
    build,
    goal: GOAL,
    steps,
    outcome: script.outcome,
    findings,
    sentence: script.sentence,
    usd,
    startedAt: new Date(startMs).toISOString(),
    durationMs: t - startMs,
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(record, null, 2));
  return {
    round,
    persona: persona.card.id,
    personaName: persona.card.name,
    outcome: record.outcome,
    steps: steps.length,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    usd,
    findings,
    sentence: record.sentence,
  };
}

async function writeRound(root: string, round: string, label: string, build: string, startIso: string, which: "before" | "after"): Promise<RoundSummary> {
  const start = Date.parse(startIso);
  await rm(join(root, round), { recursive: true, force: true });
  const runs: RunSummary[] = [];
  let finish = start;
  for (let i = 0; i < PERSONAS.length; i++) {
    const fp = PERSONAS[i]!;
    const run = await writeRun(root, round, build, fp, fp[which], start + i * 4000);
    runs.push(run);
    finish = Math.max(finish, Date.parse(run.startedAt) + run.durationMs);
  }
  const summary: RoundSummary = {
    round,
    label,
    shop: SHOP,
    build,
    startedAt: new Date(start).toISOString(),
    finishedAt: new Date(finish).toISOString(),
    goal: GOAL,
    bought: runs.filter((r) => r.outcome.kind === "bought").length,
    total: runs.length,
    usd: Math.round(runs.reduce((sum, r) => sum + r.usd, 0) * 100) / 100,
    runs,
  };
  await writeFile(join(root, round, "round.json"), JSON.stringify(summary, null, 2));
  return summary;
}

export const FIXTURE_FIX_SUMMARY =
  "Multiply each cart line's price by its quantity, so the line price and the cart total match what the shopper ordered.";

const FIX_FILE = "src/components/CartItems.tsx";

export const FIXTURE_FIX_DIFF = `diff --git a/${FIX_FILE} b/${FIX_FILE}
index 3f2a9c1..8d41b07 100644
--- a/${FIX_FILE}
+++ b/${FIX_FILE}
@@ -18,12 +18,12 @@ export function CartItems({ items, currency }: CartItemsProps) {
   return (
     <ul className="cart-items">
       {items.map((item) => (
         <li key={item.sku} className="cart-item">
           <span className="cart-item-name">{item.name}</span>
           <span className="cart-item-qty">{item.quantity}</span>
-          <span className="cart-item-price">{formatPrice(item.price, currency)}</span>
+          <span className="cart-item-price">{formatPrice(item.price * item.quantity, currency)}</span>
         </li>
       ))}
     </ul>
   );
 }
@@ -34,6 +34,6 @@ export function cartTotal(items: CartItem[]): number {
   let total = 0;
   for (const item of items) {
-    total += item.price;
+    total += item.price * item.quantity;
   }
   return total;
 }
`;

// Mirrors what the demo writes: the before round gets the diff and the fix
// result, the after round gets the same result plus the outcome fields.
async function writeFix(root: string, before: RoundSummary, after: RoundSummary): Promise<void> {
  const result = {
    proposal: {
      summary: FIXTURE_FIX_SUMMARY,
      files: [FIX_FILE],
      edits: [
        {
          file: FIX_FILE,
          find: "{formatPrice(item.price, currency)}",
          replace: "{formatPrice(item.price * item.quantity, currency)}",
        },
        { file: FIX_FILE, find: "total += item.price;", replace: "total += item.price * item.quantity;" },
      ],
    },
    branch: `walkout/fix-${before.round}`,
    commit: "8d41b07c2e9f4a1b6d3e5c7f90a1b2c3d4e5f607",
    failedEdits: [] as { file: string; why: string }[],
    testsPassed: true,
    testOutput: "PASS src/components/CartItems.test.tsx\n  cart line price (3 tests)\n\nTests: 14 passed, 14 total\n",
  };
  await writeFile(join(root, before.round, "fix.diff"), FIXTURE_FIX_DIFF);
  await writeFile(join(root, before.round, "fix.json"), JSON.stringify(result, null, 2));
  const kept = after.bought > before.bought && result.testsPassed !== false;
  await writeFile(
    join(root, after.round, "fix.json"),
    JSON.stringify({ ...result, before: before.round, beforeBought: before.bought, afterBought: after.bought, kept }, null, 2),
  );
}

export async function makeFixture(root: string = DEFAULT_FIXTURE_ROOT): Promise<{ before: RoundSummary; after: RoundSummary }> {
  await mkdir(root, { recursive: true });
  const before = await writeRound(root, FIXTURE_BEFORE, "before (fixture data)", "fixture-main-a1b2c3", "2026-10-26T14:00:00.000Z", "before");
  const after = await writeRound(root, FIXTURE_AFTER, "after (fixture data)", "fixture-fix-d4e5f6", "2026-10-26T15:00:00.000Z", "after");
  await writeFix(root, before, after);
  return { before, after };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? DEFAULT_FIXTURE_ROOT);
  const { before, after } = await makeFixture(root);
  console.log(`wrote ${before.round} (${before.bought} of ${before.total} bought) and ${after.round} (${after.bought} of ${after.total} bought) to ${root}`);
}
