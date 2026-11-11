import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  Action,
  Finding,
  Observation,
  Outcome,
  PersonaCard,
  PersonaDevice,
  RoundSummary,
  RunRecord,
  RunSummary,
  Step,
} from "../types.ts";
import { renderPage } from "./page.ts";

export interface BuildOptions {
  runsRoot: string;
  before: string;
  after?: string;
  outDir: string;
  title?: string;
}

export interface BoardStep {
  index: number;
  url: string;
  title: string;
  // Both are src paths relative to the board's index.html, or null.
  image: string | null;
  marked: string | null;
  action: Action;
  targetLabel?: string;
  actionError?: string;
}

export interface BoardRun {
  outcome: Outcome;
  sentence: string | null;
  findings: Finding[];
  usd: number;
  observation: Observation | null;
  hasShots: boolean;
  steps: BoardStep[];
}

export interface BoardPersona {
  id: string;
  name: string;
  life: string;
  constraints: string[];
  patience: string;
  observation: Observation | null;
  device: string | null;
}

export interface BoardRound {
  id: string;
  label: string;
  shop: string;
  build: string;
  goal: string;
  startedAt: string;
  finishedAt: string;
  bought: number;
  total: number;
  usd: number;
  runs: Record<string, BoardRun>;
}

export interface BoardFix {
  summary: string;
  files: string[];
  diff: string;
  kept: boolean | null;
  testsPassed: boolean | null;
  beforeBought?: number;
  afterBought?: number;
  branch: string;
  commit: string;
}

export interface BoardData {
  title: string;
  before: BoardRound;
  after: BoardRound | null;
  personas: BoardPersona[];
  fix?: BoardFix;
}

// fix.json as the demo writes it. The before round's copy lacks the last four fields.
interface FixFile {
  proposal?: { summary?: string; files?: string[]; edits?: { file?: string }[] };
  branch?: string;
  commit?: string;
  testsPassed?: boolean | null;
  beforeBought?: number;
  afterBought?: number;
  kept?: boolean;
}

interface LoadedRun {
  id: string;
  summary: RunSummary | null;
  record: Partial<RunRecord> | null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`could not read ${file}: ${(err as Error).message}`);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function personaDirs(roundDir: string): Promise<string[]> {
  const entries = await readdir(roundDir, { withFileTypes: true });
  const ids: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && (await exists(join(roundDir, e.name, "run.json")))) ids.push(e.name);
  }
  return ids.sort();
}

function srcPath(outDir: string, file: string): string {
  return relative(outDir, file).split(sep).map(encodeURIComponent).join("/");
}

export function describeDevice(d: PersonaDevice | undefined): string | null {
  if (!d || !d.viewport) return null;
  const parts = [`${d.isMobile ? "Phone" : "Desktop"} ${d.viewport.width}x${d.viewport.height}`];
  if (d.cpuThrottle > 1) parts.push(`CPU ${d.cpuThrottle}x slower`);
  if (d.network) parts.push(d.network.label);
  if (d.locale && !d.locale.startsWith("en")) parts.push(`language ${d.locale}`);
  if (d.reducedMotion === "reduce") parts.push("reduced motion");
  if (d.forcedColors === "active") parts.push("forced colours");
  if (d.visionDeficiency) parts.push(`simulated ${d.visionDeficiency}`);
  return parts.join(", ");
}

async function loadRound(runsRoot: string, roundId: string, outDir: string) {
  const roundDir = join(runsRoot, roundId);
  if (!(await exists(roundDir))) throw new Error(`round "${roundId}" not found in ${runsRoot}`);
  const summary = await readJson<RoundSummary>(join(roundDir, "round.json"));
  const listed = (summary?.runs ?? []).map((r) => r.persona);
  const onDisk = await personaDirs(roundDir);
  const ids = [...listed, ...onDisk.filter((id) => !listed.includes(id))];
  if (!summary && ids.length === 0) throw new Error(`round "${roundId}" has no round.json and no runs`);

  const loaded: LoadedRun[] = [];
  for (const id of ids) {
    const record = await readJson<Partial<RunRecord>>(join(roundDir, id, "run.json"));
    loaded.push({ id, summary: summary?.runs.find((r) => r.persona === id) ?? null, record });
  }

  const cards = new Map<string, { card: PersonaCard; observation: Observation | null; device: string | null }>();
  const runs: Record<string, BoardRun> = {};
  for (const { id, summary: rs, record } of loaded) {
    const outcome = record?.outcome ?? rs?.outcome;
    if (!outcome) continue;
    const observation = record?.persona?.observation ?? null;
    const card: PersonaCard = record?.persona?.card ?? { id, name: rs?.personaName ?? id, life: "", constraints: [], patience: "" };
    cards.set(id, { card, observation, device: describeDevice(record?.persona?.device) });

    const runDir = join(roundDir, id);
    const steps: BoardStep[] = [];
    for (const s of (Array.isArray(record?.steps) ? record.steps : []) as Step[]) {
      const shot = s.screenshot && (await exists(join(runDir, s.screenshot))) ? srcPath(outDir, join(runDir, s.screenshot)) : null;
      const marked = s.marked && (await exists(join(runDir, s.marked))) ? srcPath(outDir, join(runDir, s.marked)) : null;
      const step: BoardStep = { index: s.index, url: s.url, title: s.title, image: shot, marked, action: s.action };
      if (s.targetLabel) step.targetLabel = s.targetLabel;
      if (s.actionError) step.actionError = s.actionError;
      steps.push(step);
    }
    const findings = record?.findings?.length ? record.findings : (rs?.findings ?? []);
    runs[id] = {
      outcome,
      sentence: record?.sentence ?? rs?.sentence ?? null,
      findings: [...findings].sort((a, b) => (a.step ?? Infinity) - (b.step ?? Infinity) || a.t - b.t),
      usd: record?.usd ?? rs?.usd ?? 0,
      observation,
      hasShots: steps.some((s) => s.image || s.marked),
      steps,
    };
  }

  const all = Object.values(runs);
  const first = loaded.find((l) => l.record)?.record;
  const round: BoardRound = {
    id: roundId,
    label: summary?.label ?? roundId,
    shop: summary?.shop ?? first?.shop ?? "",
    build: summary?.build ?? first?.build ?? "",
    goal: summary?.goal ?? first?.goal ?? "",
    startedAt: summary?.startedAt ?? "",
    finishedAt: summary?.finishedAt ?? "",
    bought: summary?.bought ?? all.filter((r) => r.outcome.kind === "bought").length,
    total: summary?.total ?? all.length,
    usd: summary?.usd ?? all.reduce((sum, r) => sum + r.usd, 0),
    runs,
  };
  return { round, order: Object.keys(runs), cards };
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function diffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line) ?? /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (m && !files.includes(m[1]!)) files.push(m[1]!);
  }
  return files;
}

async function loadFix(runsRoot: string, before: string, after: string | undefined): Promise<BoardFix | undefined> {
  // A broken fix.json only hides the panel, it should not break the board.
  const read = (round: string) => readJson<FixFile>(join(runsRoot, round, "fix.json")).catch(() => null);
  const fix = (after ? await read(after) : null) ?? (await read(before));
  if (!fix) return undefined;
  const diff = (await readText(join(runsRoot, before, "fix.diff"))) ?? "";
  const proposed = [...(fix.proposal?.files ?? []), ...(fix.proposal?.edits ?? []).map((e) => e.file ?? "")].filter(Boolean);
  const fromDiff = diffFiles(diff);
  const out: BoardFix = {
    summary: fix.proposal?.summary ?? "",
    files: fromDiff.length ? fromDiff : [...new Set(proposed)],
    diff,
    kept: typeof fix.kept === "boolean" ? fix.kept : null,
    testsPassed: typeof fix.testsPassed === "boolean" ? fix.testsPassed : null,
    branch: fix.branch ?? "",
    commit: fix.commit ?? "",
  };
  if (typeof fix.beforeBought === "number") out.beforeBought = fix.beforeBought;
  if (typeof fix.afterBought === "number") out.afterBought = fix.afterBought;
  return out;
}

export async function loadBoard(opts: BuildOptions): Promise<BoardData> {
  const runsRoot = resolve(opts.runsRoot);
  const outDir = resolve(opts.outDir);
  const before = await loadRound(runsRoot, opts.before, outDir);
  const after = opts.after ? await loadRound(runsRoot, opts.after, outDir) : null;
  const order = [...before.order, ...(after?.order ?? []).filter((id) => !before.order.includes(id))];
  const personas: BoardPersona[] = order.map((id) => {
    const b = before.cards.get(id);
    const a = after?.cards.get(id);
    const src = b ?? a!;
    return {
      id,
      name: src.card.name,
      life: src.card.life || a?.card.life || "",
      constraints: src.card.constraints ?? [],
      patience: src.card.patience ?? "",
      observation: b?.observation ?? a?.observation ?? null,
      device: b?.device ?? a?.device ?? null,
    };
  });
  const data: BoardData = { title: opts.title ?? "Walkout", before: before.round, after: after?.round ?? null, personas };
  const fix = await loadFix(runsRoot, opts.before, opts.after);
  if (fix) data.fix = fix;
  return data;
}

export async function buildScoreboard(opts: BuildOptions): Promise<string> {
  const data = await loadBoard(opts);
  const [css, js] = await Promise.all([
    readFile(new URL("./board.css", import.meta.url), "utf8"),
    readFile(new URL("./board.js", import.meta.url), "utf8"),
  ]);
  const outDir = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, "index.html");
  await writeFile(file, renderPage(data, css, js));
  return file;
}
