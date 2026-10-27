import type { OutcomeKind } from "../types.ts";
import type { BoardData, BoardFix, BoardRound, BoardRun } from "./build.ts";

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  bought: "Bought",
  gave_up: "Gave up",
  step_limit: "Step limit",
  error: "Error",
};

const OUTCOME_ICON: Record<OutcomeKind, string> = {
  bought: "i-good",
  gave_up: "i-bad",
  step_limit: "i-limit",
  error: "i-error",
};

const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
<symbol id="i-good" viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 7.8" ${STROKE} stroke-width="3.2"/></symbol>
<symbol id="i-bad" viewBox="0 0 24 24"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" ${STROKE} stroke-width="3.2"/></symbol>
<symbol id="i-limit" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" ${STROKE} stroke-width="2.6"/><path d="M12 8.5v4l2.6 1.8" ${STROKE} stroke-width="2.6"/></symbol>
<symbol id="i-error" viewBox="0 0 24 24"><path d="M12 6.5v7" ${STROKE} stroke-width="3.2"/><circle cx="12" cy="17.6" r="1.8" fill="currentColor"/></symbol>
<symbol id="i-none" viewBox="0 0 24 24"><path d="M7.5 12h9" ${STROKE} stroke-width="3.2"/></symbol>
<symbol id="i-close" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ${STROKE} stroke-width="2.6"/></symbol>
<symbol id="i-prev" viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" ${STROKE} stroke-width="2.8"/></symbol>
<symbol id="i-next" viewBox="0 0 24 24"><path d="M9.5 5.5L16 12l-6.5 6.5" ${STROKE} stroke-width="2.8"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M7.5 5.5h3.2v13H7.5zM13.3 5.5h3.2v13h-3.2z" fill="currentColor"/></symbol>
</svg>`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function icon(id: string): string {
  return `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function tone(run: BoardRun | undefined): "good" | "bad" | "none" {
  if (!run) return "none";
  return run.outcome.kind === "bought" ? "good" : "bad";
}

function stateCell(round: "before" | "after", run: BoardRun | undefined): string {
  const t = tone(run);
  const label = run ? (OUTCOME_LABEL[run.outcome.kind] ?? run.outcome.kind) : "No run";
  const ic = run ? (OUTCOME_ICON[run.outcome.kind] ?? "i-bad") : "i-none";
  const name = round === "before" ? "Before" : "After";
  return `<span class="state ${t}" data-round="${round}"><span class="state-k">${name}</span><span class="state-v"><span class="icon-dot">${icon(ic)}</span>${esc(label)}</span></span>`;
}

function usd(n: number): string {
  return `${n.toFixed(2)} USD`;
}

function roundMeta(name: string, r: BoardRound): string {
  const extra = r.label && r.label.toLowerCase() !== name.toLowerCase() ? ` · ${esc(r.label)}` : "";
  const shop = r.shop ? esc(r.shop) : "Unknown shop";
  const build = r.build ? ` · build <code>${esc(r.build)}</code>` : "";
  return `<dt>${name}</dt><dd>${shop}${build}${extra}</dd>`;
}

function statCard(view: "before" | "after", r: BoardRound, order: string[], toggle: boolean, pressed: boolean, delta: string): string {
  const bar = order.map((id) => `<i class="${tone(r.runs[id])}"></i>`).join("");
  const tag = toggle ? "button" : "div";
  const attrs = toggle ? ` type="button" data-view="${view}" aria-pressed="${pressed}"` : "";
  return `<${tag} class="stat"${attrs}>
  <span class="stat-label">Bought ${view}</span>
  <span class="stat-value">${r.bought} of ${r.total}</span>
  <span class="stat-side">
    <span class="stat-bar" aria-hidden="true">${bar}</span>
    <span class="stat-meta">Cost <b>${usd(r.usd)}</b>${delta}</span>
  </span>
</${tag}>`;
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || /^(diff |index |new file|deleted file|similarity|rename )/.test(line)) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

function renderDiff(diff: string): string {
  const lines = diff.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((l) => `<span class="ln ${diffLineClass(l)}">${esc(l) || " "}</span>`).join("");
}

function fixPanel(fix: BoardFix, before: BoardRound, after: BoardRound | null): string {
  const chip =
    fix.kept === true
      ? `<span class="badge good"><span class="icon-dot good">${icon("i-good")}</span>Kept</span>`
      : fix.kept === false
        ? `<span class="badge none"><span class="icon-dot">${icon("i-none")}</span>Dropped</span>`
        : "";
  const facts: string[] = [];
  if (fix.beforeBought !== undefined && fix.afterBought !== undefined) {
    const total = after?.total ?? before.total;
    facts.push(`<li>Bought <b>${fix.beforeBought} of ${before.total}</b> before, <b>${fix.afterBought} of ${total}</b> after</li>`);
  }
  const tests = fix.testsPassed === true ? ["good", "i-good", "passed"] : fix.testsPassed === false ? ["bad", "i-bad", "failed"] : ["none", "i-none", "not run"];
  facts.push(`<li><span class="icon-dot ${tests[0]}">${icon(tests[1]!)}</span>Shop tests ${tests[2]}</li>`);
  if (fix.branch) {
    const commit = fix.commit ? ` at <code title="${esc(fix.commit)}">${esc(fix.commit.slice(0, 7))}</code>` : "";
    facts.push(`<li>Branch <code>${esc(fix.branch)}</code>${commit}</li>`);
  }
  const files = fix.files.length
    ? `<div class="fix-files"><span class="fix-k">Changed ${fix.files.length === 1 ? "file" : "files"}</span>${fix.files.map((f) => `<code>${esc(f)}</code>`).join("")}</div>`
    : "";
  const diff = fix.diff.trim()
    ? `<details class="fix-diff"><summary>Show the patch</summary><pre class="diff"><code>${renderDiff(fix.diff)}</code></pre></details>`
    : "";
  return `<section class="fix" aria-labelledby="fix-h">
  <div class="fix-head"><h2 id="fix-h">The fix</h2>${chip}</div>
  ${fix.summary ? `<p class="fix-summary">${esc(fix.summary)}</p>` : ""}
  <ul class="fix-facts">${facts.join("")}</ul>
  ${files}
  ${diff}
</section>`;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderPage(data: BoardData, css: string, js: string): string {
  const { before, after } = data;
  const order = data.personas.map((p) => p.id);
  const hasAfter = after !== null;

  const goals = [before.goal, after && after.goal !== before.goal ? after.goal : ""].filter(Boolean);
  const goalHtml = goals.length ? `<p class="goal"><b>Goal</b> ${goals.map(esc).join(" / ")}</p>` : "";

  let delta = "";
  if (after) {
    const d = after.bought - before.bought;
    delta = ` · ${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)} vs before`;
  }

  const tiles = data.personas
    .map((p) => {
      const b = before.runs[p.id];
      const a = after?.runs[p.id];
      const cells = stateCell("before", b) + (hasAfter ? stateCell("after", a) : "");
      const attrs = `data-persona="${esc(p.id)}" data-before="${tone(b)}"${hasAfter ? ` data-after="${tone(a)}"` : ""}`;
      return `<li><button type="button" class="tile" ${attrs} aria-haspopup="dialog">
  <span class="tile-name">${esc(p.name)}</span>
  <span class="tile-life">${esc(p.life)}</span>
  <span class="tile-states">${cells}</span>
</button></li>`;
    })
    .join("\n");

  const note = hasAfter
    ? `<p class="grid-note">Tile colour shows the <span id="grid-view">before</span> round. Select a number above to switch. Select a shopper for the replay.</p>`
    : `<p class="grid-note">Select a shopper for the replay.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} scoreboard</title>
<style>
${css.replace(/<\/style/gi, "<\\/style")}
</style>
</head>
<body data-view="before">
${SPRITE}
<main class="board">
<header class="top">
  <div>
    <h1>${esc(data.title)}</h1>
    ${goalHtml}
  </div>
  <dl class="rounds">${roundMeta("Before", before)}${after ? roundMeta("After", after) : ""}</dl>
</header>
<section class="stats" aria-label="Results">
${statCard("before", before, order, hasAfter, true, "")}
${after ? statCard("after", after, order, true, false, delta) : ""}
</section>
<section aria-label="Shoppers">
${note}
<ul class="grid"${hasAfter ? "" : ' style="--state-cols: 1"'}>
${tiles}
</ul>
</section>
${data.fix ? fixPanel(data.fix, before, after) : ""}
</main>
<dialog id="detail" class="detail" aria-labelledby="d-name"></dialog>
<script type="application/json" id="board-data">${jsonForScript(data)}</script>
<script>
${js.replace(/<\/script/gi, "<\\/script")}
</script>
</body>
</html>
`;
}
