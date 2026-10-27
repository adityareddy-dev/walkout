import type { Persona } from "./types.ts";

// Network profiles, throughput in bytes per second. The numbers are the
// Chrome DevTools presets, written out so a run can be repeated by hand.
const SLOW_3G = { label: "slow 3G", latencyMs: 400, downloadBps: (400 * 1000) / 8, uploadBps: (400 * 1000) / 8 };
const FAST_4G = { label: "4G", latencyMs: 60, downloadBps: (9 * 1000 * 1000) / 8, uploadBps: (1.5 * 1000 * 1000) / 8 };
const SATELLITE = { label: "satellite, 700 ms round trip", latencyMs: 700, downloadBps: (10 * 1000 * 1000) / 8, uploadBps: (2 * 1000 * 1000) / 8 };

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; moto g play) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
const TABLET_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const desktop = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: "en-US",
  timezoneId: "America/Chicago",
  cpuThrottle: 1,
};

const phone = {
  viewport: { width: 412, height: 839 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true,
  userAgent: ANDROID_UA,
  locale: "en-US",
  timezoneId: "America/Chicago",
};

export const PERSONAS: Persona[] = [
  {
    card: {
      id: "p01-cheap-android",
      name: "Rosa",
      life: "Night-shift nurse who shops on a three-year-old budget Android phone during her break.",
      constraints: ["Phone CPU about four times slower than a laptop", "4G signal", "Taps with her thumb"],
      patience: "Gives a slow page a few seconds. If a button does nothing twice, she assumes the site is broken.",
    },
    device: { ...phone, cpuThrottle: 4, network: FAST_4G },
    observation: "screenshot",
  },
  {
    card: {
      id: "p02-slow-3g",
      name: "Tomasz",
      life: "Farmer checking a shop from the edge of the field where the signal drops to 3G.",
      constraints: ["Slow 3G: 400 ms round trip, 400 kbit/s", "Mid-range phone"],
      patience: "Used to waiting, will wait for a page to load, but not for one that never changes.",
    },
    device: { ...phone, cpuThrottle: 2, network: SLOW_3G },
    observation: "screenshot",
  },
  {
    card: {
      id: "p03-large-text",
      name: "Margaret",
      life: "Retired teacher, 74, who reads every page with the browser zoomed to 200 percent.",
      constraints: ["Browser zoom 200 percent on a laptop", "Reads slowly and carefully", "Uses a mouse"],
      patience: "Patient with reading, but gives up when text or buttons are cut off or overlap.",
    },
    device: { ...desktop, viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
    observation: "screenshot",
  },
  {
    card: {
      id: "p04-keyboard-only",
      name: "Dev",
      life: "Software tester with a wrist injury who uses only the keyboard: Tab, Shift+Tab, Enter, Space and arrows.",
      constraints: ["No mouse, no touch", "Needs to see where focus is", "Can type into the focused field"],
      patience: "Will tab through a long page, but gives up if focus disappears or a control cannot be reached.",
    },
    device: { ...desktop },
    observation: "keyboard",
  },
  {
    card: {
      id: "p05-screen-reader",
      name: "Amara",
      life: "Law student who is blind and shops with a screen reader. She hears the page's accessibility tree, never sees it.",
      constraints: ["No screenshots, only the accessibility tree", "Can only use controls that have a role and a name"],
      patience: "Expert user. Gives up when a control has no name or an important step is not announced.",
    },
    device: { ...desktop },
    observation: "a11y-tree",
  },
  {
    card: {
      id: "p06-spanish",
      name: "Lucía",
      life: "Shop owner in Monterrey whose browser is set to Spanish. She reads English slowly and prefers Spanish.",
      constraints: ["Browser language es-MX", "Prices make most sense to her when the currency is clear"],
      patience: "Will work through English words she knows, gives up when a step is unclear.",
    },
    device: { ...phone, cpuThrottle: 2, network: FAST_4G, locale: "es-MX", timezoneId: "America/Monterrey" },
    observation: "screenshot",
  },
  {
    card: {
      id: "p07-tablet",
      name: "Hiro",
      life: "Father shopping on the family tablet on the sofa, one hand holding a sleeping toddler.",
      constraints: ["Android tablet in portrait", "Touch only, one hand"],
      patience: "Distracted, gives a step one or two tries.",
    },
    device: {
      viewport: { width: 800, height: 1280 },
      deviceScaleFactor: 1.5,
      isMobile: true,
      hasTouch: true,
      userAgent: TABLET_UA,
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      cpuThrottle: 2,
      network: FAST_4G,
    },
    observation: "screenshot",
  },
  {
    card: {
      id: "p08-desktop-mouse",
      name: "Sam",
      life: "Office manager ordering supplies on a fast work laptop with a mouse.",
      constraints: ["Fast laptop, fast office network"],
      patience: "Busy, expects things to just work, leaves after a couple of failed clicks.",
    },
    device: { ...desktop },
    observation: "screenshot",
  },
  {
    card: {
      id: "p09-high-latency",
      name: "Kai",
      life: "Researcher at a remote station on satellite internet: decent bandwidth, but every request takes most of a second.",
      constraints: ["700 ms round trip on every request", "Laptop with a trackpad"],
      patience: "Used to lag, waits for a response, but not when a click gives no sign it was received.",
    },
    device: { ...desktop, viewport: { width: 1366, height: 768 }, network: SATELLITE },
    observation: "screenshot",
  },
  {
    card: {
      id: "p10-reduced-motion",
      name: "Noor",
      life: "Graphic designer with vestibular migraines who has reduced motion turned on everywhere.",
      constraints: ["prefers-reduced-motion: reduce", "Laptop with a mouse"],
      patience: "Normal patience, but leaves a page that animates a lot.",
    },
    device: { ...desktop, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" },
    observation: "screenshot",
  },
  {
    card: {
      id: "p11-colour-blind",
      name: "Ben",
      life: "Electrician with red-green colour blindness (deuteranopia) shopping on his laptop.",
      constraints: ["Sees the page as a deuteranope does", "Cannot tell red from green states"],
      patience: "Normal patience; gets stuck when colour is the only cue.",
    },
    device: { ...desktop, viewport: { width: 1280, height: 800 }, visionDeficiency: "deuteranopia" },
    observation: "screenshot",
  },
  {
    card: {
      id: "p12-low-end-desktop",
      name: "Grace",
      life: "Student on an old hand-me-down desktop that takes ages to do anything.",
      constraints: ["CPU about six times slower than a new laptop", "Small 1366 by 768 screen"],
      patience: "Waits for slow pages, gives up when clicks seem to be ignored.",
    },
    device: { ...desktop, viewport: { width: 1366, height: 768 }, cpuThrottle: 6 },
    observation: "screenshot",
  },
];

export function personaById(id: string): Persona {
  const p = PERSONAS.find((x) => x.card.id === id || x.card.id.startsWith(id + "-") || x.card.name.toLowerCase() === id.toLowerCase());
  if (!p) throw new Error(`unknown persona ${id}; known: ${PERSONAS.map((x) => x.card.id).join(", ")}`);
  return p;
}
