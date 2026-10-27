// Shared shapes for a round of shopper runs. Everything a round writes to
// runs/<round>/ follows these types, and the scoreboard reads the same files.

export type Observation = "screenshot" | "keyboard" | "a11y-tree";

export interface PersonaCard {
  id: string;
  name: string;
  life: string;
  constraints: string[];
  patience: string;
}

export interface PersonaDevice {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
  locale: string;
  timezoneId: string;
  reducedMotion?: "reduce" | "no-preference";
  forcedColors?: "active" | "none";
  // CDP Emulation.setCPUThrottlingRate, 1 means no slowdown.
  cpuThrottle: number;
  // CDP Network.emulateNetworkConditions. Throughput in bytes per second.
  network?: { latencyMs: number; downloadBps: number; uploadBps: number; label: string };
  // CDP Emulation.setEmulatedVisionDeficiency.
  visionDeficiency?: "deuteranopia" | "protanopia" | "tritanopia" | "achromatopsia" | "blurredVision";
}

export interface Persona {
  card: PersonaCard;
  device: PersonaDevice;
  observation: Observation;
}

export type Action = (
  | { action: "click"; target: string; why: string }
  | { action: "select"; target: string; value: string; why: string }
  | { action: "type"; target: string | null; text: string; submit?: boolean; why: string }
  | { action: "press"; key: string; times?: number; why: string }
  | { action: "scroll"; direction: "up" | "down"; why: string }
  | { action: "wait"; why: string }
  | { action: "back"; why: string }
  | { action: "give_up"; reason: string; why?: string }
  | { action: "done"; why: string }
) & { note?: string };

export interface RunRecord {
  persona: Persona;
  shop: string;
  build: string;
  goal: string;
  steps: Step[];
  outcome: Outcome;
  findings: Finding[];
  sentence: string | null;
  usd: number;
  startedAt: string;
  durationMs: number;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number;
  latencyMs: number;
}

export interface Step {
  index: number;
  // Epoch milliseconds. tObserve to tObserved is when the screenshot or tree
  // was taken (the runner's own page work, left out of the telemetry), tAct
  // when the action was sent to the browser, tSettled when the page was
  // considered settled after it.
  tObserve: number;
  tObserved: number;
  tAct: number;
  tSettled: number;
  url: string;
  title: string;
  screenshot: string | null; // path relative to the run directory
  marked: string | null; // the screenshot the model saw, with numbered marks
  // The accessibility tree the screen reader persona heard, a path like screenshot.
  tree?: string | null;
  action: Action;
  // What the persona noticed after the action, as told to the model next step.
  result?: string;
  // Where the action landed, in viewport CSS pixels, when it was a pointer action.
  point?: { x: number; y: number };
  targetLabel?: string;
  actionError?: string;
  usage?: ModelUsage;
}

export type OutcomeKind = "bought" | "gave_up" | "step_limit" | "error";

export interface Outcome {
  kind: OutcomeKind;
  reason: string;
  atStep: number;
}

// Raw signals collected in the page and by the runner, epoch milliseconds.
export interface RawTelemetry {
  inputs: {
    t: number;
    type: string;
    x?: number;
    y?: number;
    key?: string;
    target: string;
    interactive?: boolean;
    freshMutations?: number;
    focusMoved?: boolean;
    urlChanged?: boolean;
    unloaded?: boolean;
  }[];
  mutations: { t: number; count: number }[];
  requests: { t: number; tEnd?: number; url: string; method: string; type: string; status?: number; failed?: string }[];
  navigations: { t: number; url: string }[];
  eventTimings: {
    t: number;
    name: string;
    interactionId: number;
    duration: number;
    inputDelay: number;
    processing: number;
    presentation: number;
    target: string;
  }[];
  loafs: {
    t: number;
    duration: number;
    blockingDuration: number;
    scripts: {
      sourceURL: string;
      sourceFunctionName: string;
      sourceCharPosition: number;
      invoker: string;
      invokerType: string;
      duration: number;
    }[];
  }[];
  vitals: { t: number; name: string; value: number; rating: string; attribution: Record<string, unknown> }[];
  errors: { t: number; message: string; stack?: string; source: "pageerror" | "console" | "window" }[];
  spans: {
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    start: number;
    end: number;
    attributes: Record<string, unknown>;
    events: { name: string; t: number }[];
  }[];
}

export interface CodeLocation {
  url: string;
  line: number;
  column: number;
  functionName: string;
  // Original source after the source map, when the shop ships one.
  source?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export type FindingKind = "dead_tap" | "rage_click" | "slow_interaction" | "js_error" | "slow_request" | "failed_request";

export interface Finding {
  kind: FindingKind;
  t: number;
  step: number | null; // index of the agent step it falls in
  summary: string;
  durationMs?: number;
  target?: string;
  code?: CodeLocation;
}

export interface RunSummary {
  round: string;
  persona: string;
  personaName: string;
  outcome: Outcome;
  steps: number;
  startedAt: string;
  durationMs: number;
  usd: number;
  findings: Finding[];
  sentence: string | null;
}

export interface RoundSummary {
  round: string;
  label: string; // "before" or "after" or a free label
  shop: string;
  build: string; // commit or branch of the shop under test
  startedAt: string;
  finishedAt: string;
  goal: string;
  bought: number;
  total: number;
  usd: number;
  runs: RunSummary[];
}
