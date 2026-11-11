(function () {
  "use strict";

  var data = JSON.parse(document.getElementById("board-data").textContent);
  var OUTCOME = { bought: "Bought", gave_up: "Gave up", step_limit: "Step limit", error: "Error" };
  var ICON = { bought: "i-good", gave_up: "i-bad", step_limit: "i-limit", error: "i-error" };
  var KIND = {
    dead_tap: "Dead tap",
    rage_click: "Rage click",
    slow_interaction: "Slow interaction",
    js_error: "JS error",
    slow_request: "Slow request",
    failed_request: "Failed request",
  };
  var HOW = { screenshot: "Sees the screen", keyboard: "Keyboard only", "a11y-tree": "Screen reader" };
  var STEP_MS = 1200;

  var personas = {};
  data.personas.forEach(function (p) { personas[p.id] = p; });

  // ---- grid view toggle (before / after) ----

  function setView(view) {
    if (view !== "before" && view !== "after") return;
    if (view === "after" && !data.after) return;
    document.body.setAttribute("data-view", view);
    document.querySelectorAll(".stat[data-view]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === view));
    });
    var caption = document.getElementById("grid-view");
    if (caption) caption.textContent = view === "after" ? "after" : "before";
  }

  document.querySelectorAll("button.stat[data-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      var view = b.getAttribute("data-view");
      setView(view);
      history.replaceState(null, "", "#" + view);
    });
  });

  var hash = location.hash.replace("#", "");
  if (hash === "before" || hash === "after") setView(hash);

  // ---- small DOM helpers ----

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  function icon(id) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function tone(run) {
    if (!run) return "none";
    return run.outcome.kind === "bought" ? "good" : "bad";
  }

  function badge(run) {
    var t = tone(run);
    var kind = run ? run.outcome.kind : null;
    return h("span", { class: "badge " + t },
      h("span", { class: "icon-dot " + t }, icon(kind ? ICON[kind] : "i-none")),
      kind ? OUTCOME[kind] || kind : "No run");
  }

  function q(s) { return "“" + s + "”"; }

  function describe(step) {
    var a = step.action || {};
    var label = step.targetLabel || a.target;
    switch (a.action) {
      case "click": return "Click " + q(label || "element");
      case "type": return "Type " + q(a.text || "") + (a.target ? " into " + q(a.target) : "") + (a.submit ? " and submit" : "");
      case "press": return "Press " + a.key + (a.times && a.times > 1 ? " " + a.times + " times" : "");
      case "scroll": return "Scroll " + a.direction;
      case "wait": return "Wait";
      case "back": return "Go back";
      case "give_up": return "Give up";
      case "done": return "Done";
      default: return String(a.action || "Step");
    }
  }

  function why(step) {
    var a = step.action || {};
    if (a.action === "give_up") return [a.reason, a.why].filter(Boolean).join(" ");
    return a.why || "";
  }

  function codeText(c) {
    return c.url + ":" + c.line;
  }

  // ---- detail dialog ----

  var dialog = document.getElementById("detail");
  var state = { persona: null, round: "before", step: 0, timer: null, opener: null, seen: {} };
  var ui = {};

  function runOf(personaId, round) {
    var r = round === "after" ? data.after : data.before;
    return r ? r.runs[personaId] || null : null;
  }

  function openPersona(id, opener) {
    state.persona = id;
    state.opener = opener || null;
    var view = document.body.getAttribute("data-view") || "before";
    state.round = runOf(id, view) ? view : runOf(id, "before") ? "before" : "after";
    render();
    if (!dialog.open) dialog.showModal();
    var close = dialog.querySelector(".d-close");
    if (close) close.focus();
  }

  function render() {
    stop();
    state.step = 0;
    state.seen = {};
    var p = personas[state.persona];
    var run = runOf(state.persona, state.round);
    dialog.textContent = "";
    ui = { hasShots: !!(run && run.hasShots && run.steps.length) };

    var head = h("header", { class: "d-head" },
      h("div", { class: "d-title" },
        h("h2", { id: "d-name", text: p.name }),
        h("p", { text: p.life })),
      data.after ? roundSwitch() : null,
      h("button", { type: "button", class: "btn d-close", "aria-label": "Close", onclick: function () { dialog.close(); } },
        icon("i-close"), "Close"));

    var body = h("div", { class: "d-body" }, info(p, run), replay(run));
    dialog.appendChild(h("div", { class: "d-wrap" }, head, body));
    if (ui.img) showStep(0);
  }

  function roundSwitch() {
    var seg = h("div", { class: "seg", role: "group", "aria-label": "Run" });
    ["before", "after"].forEach(function (round) {
      var run = runOf(state.persona, round);
      var t = tone(run);
      seg.appendChild(h("button", {
        type: "button",
        "aria-pressed": String(state.round === round),
        disabled: !run,
        "data-round": round,
        onclick: function () {
          if (state.round === round) return;
          state.round = round;
          render();
          var again = dialog.querySelector('.seg button[data-round="' + round + '"]');
          if (again) again.focus();
        },
      },
      round === "before" ? "Before" : "After",
      h("span", { class: "icon-dot " + t }, icon(run ? ICON[run.outcome.kind] : "i-none")),
      h("span", { class: "seg-v", text: run ? OUTCOME[run.outcome.kind] : "No run" })));
    });
    return seg;
  }

  function info(p, run) {
    var col = h("section", { class: "d-info", "aria-label": "Run details" });
    if (!run) {
      col.appendChild(h("p", { class: "empty", text: "This shopper has no run in this round." }));
      return col;
    }
    var o = run.outcome;
    col.appendChild(h("div", { class: "outcome" },
      badge(run),
      h("span", { class: "reason", text: "at step " + o.atStep + (o.reason ? ". " + o.reason : "") })));

    var sentence = run.sentence || (o.kind === "bought" ? "Bought at step " + o.atStep + ". " + (o.reason || "") : o.reason);
    if (sentence) col.appendChild(h("p", { class: "sentence " + tone(run), "data-sentence": run.sentence ? "walkout" : "outcome", text: sentence }));

    col.appendChild(h("h3", { text: "Findings (" + run.findings.length + ")" }));
    if (!run.findings.length) {
      col.appendChild(h("p", { class: "empty", text: "No telemetry findings in this run." }));
    } else {
      col.appendChild(h("ul", { class: "findings" }, run.findings.map(function (f) {
        var c = f.code;
        return h("li", null,
          h("div", { class: "f-top" },
            h("span", { class: "f-kind", text: KIND[f.kind] || f.kind }),
            h("span", { class: "f-summary", text: f.summary })),
          h("div", { class: "f-meta" },
            f.step !== null && f.step !== undefined
              ? (ui.hasShots
                ? h("button", { type: "button", class: "f-step", onclick: function () { stop(); showStep(indexOfStep(f.step)); }, text: "Step " + f.step })
                : h("span", { text: "Step " + f.step }))
              : null,
            c ? h("code", { title: c.functionName ? c.functionName + " at " + codeText(c) + ":" + c.column : codeText(c), text: codeText(c) }) : null,
            c && c.functionName ? h("span", { text: c.functionName }) : null,
            c && c.source ? h("code", { text: c.source + (c.sourceLine ? ":" + c.sourceLine : "") }) : null,
            typeof f.durationMs === "number" ? h("span", { text: f.durationMs.toLocaleString("en-US") + " ms" }) : null));
      })));
    }
    col.appendChild(h("h3", { text: "Shopper" }));
    col.appendChild(h("dl", { class: "facts" },
      h("dt", { text: "Constraints" }),
      h("dd", null, p.constraints.length
        ? h("ul", null, p.constraints.map(function (c) { return h("li", { text: c }); }))
        : "None listed"),
      h("dt", { text: "Patience" }), h("dd", { text: p.patience || "Not given" }),
      p.observation ? [h("dt", { text: "Shops by" }), h("dd", { text: HOW[p.observation] || p.observation })] : null,
      p.device ? [h("dt", { text: "Device" }), h("dd", { text: p.device })] : null));

    return col;
  }

  function indexOfStep(n) {
    var run = runOf(state.persona, state.round);
    for (var i = 0; i < run.steps.length; i++) if (run.steps[i].index === n) return i;
    return Math.max(0, Math.min(run.steps.length - 1, n - 1));
  }

  function replay(run) {
    var col = h("section", { class: "d-replay", "aria-label": "Replay" });
    if (!run || !run.steps.length) {
      col.appendChild(h("p", { class: "empty", text: "No steps recorded." }));
      return col;
    }
    if (!run.hasShots) {
      col.classList.add("is-text");
      col.appendChild(h("div", { class: "textsteps" },
        h("p", { class: "note", text: run.observation === "a11y-tree"
          ? "This shopper used a screen reader, so there are no screenshots. Each step as text:"
          : "No screenshots were saved for this run. Each step as text:" }),
        h("ol", null, run.steps.map(function (s) {
          return h("li", null,
            h("span", { class: "n", text: "Step " + s.index }),
            h("div", null,
              h("div", { class: "step-action", text: describe(s) }),
              why(s) ? h("div", { class: "step-why", text: why(s) }) : null,
              s.actionError ? h("div", { class: "step-error", text: s.actionError }) : null,
              h("div", { class: "step-url", text: (s.title ? s.title + " · " : "") + s.url })));
        }))));
      return col;
    }
    ui.img = h("img", { alt: "", decoding: "async" });
    ui.noshot = h("p", { class: "noshot", hidden: true, text: "No screenshot for this step" });
    col.appendChild(h("div", { class: "frame" }, ui.img, ui.noshot));

    ui.prev = h("button", { type: "button", class: "btn", onclick: function () { stop(); showStep(state.step - 1); } }, icon("i-prev"), "Prev");
    ui.play = h("button", { type: "button", class: "btn primary", onclick: toggle }, icon("i-play"), h("span", { text: "Play" }));
    ui.next = h("button", { type: "button", class: "btn", onclick: function () { stop(); showStep(state.step + 1); } }, "Next", icon("i-next"));
    ui.counter = h("span", { class: "counter", "aria-live": "polite" });
    ui.pips = h("div", { class: "pips", "aria-hidden": "true" }, run.steps.map(function (s, i) {
      return h("span", { title: "Step " + s.index, onclick: function () { stop(); showStep(i); } });
    }));
    col.appendChild(h("div", { class: "controls" }, ui.prev, ui.play, ui.next, ui.counter, ui.pips));

    ui.action = h("div", { class: "step-action" });
    ui.why = h("div", { class: "step-why" });
    ui.error = h("div", { class: "step-error", hidden: true });
    ui.url = h("div", { class: "step-url" });
    col.appendChild(h("div", { class: "step-text" }, ui.action, ui.why, ui.error, ui.url));
    return col;
  }

  function src(step) { return step.image || step.marked || null; }

  function showStep(i) {
    var run = runOf(state.persona, state.round);
    if (!run || !ui.img) return;
    var n = run.steps.length;
    i = Math.max(0, Math.min(n - 1, i));
    state.step = i;
    state.seen[i] = true;
    var s = run.steps[i];
    var url = src(s);
    if (url) {
      ui.img.hidden = false;
      ui.noshot.hidden = true;
      if (ui.img.getAttribute("src") !== url) ui.img.setAttribute("src", url);
      ui.img.alt = "Screenshot at step " + s.index + ": " + (s.title || s.url);
    } else {
      ui.img.hidden = true;
      ui.noshot.hidden = false;
    }
    if (i + 1 < n && src(run.steps[i + 1])) new Image().src = src(run.steps[i + 1]);
    ui.counter.textContent = "Step " + s.index + " of " + run.steps[n - 1].index;
    ui.action.textContent = describe(s);
    ui.why.textContent = why(s);
    ui.error.hidden = !s.actionError;
    ui.error.textContent = s.actionError || "";
    ui.url.textContent = (s.title ? s.title + " · " : "") + s.url;
    ui.prev.disabled = i === 0;
    ui.next.disabled = i === n - 1;
    Array.prototype.forEach.call(ui.pips.children, function (pip, j) {
      pip.className = j === i ? "on" : state.seen[j] ? "seen" : "";
    });
  }

  function toggle() {
    if (state.timer) { stop(); return; }
    var run = runOf(state.persona, state.round);
    if (state.step >= run.steps.length - 1) showStep(0);
    state.timer = setInterval(function () {
      if (state.step >= run.steps.length - 1) { stop(); return; }
      showStep(state.step + 1);
      if (state.step >= run.steps.length - 1) stop();
    }, STEP_MS);
    setPlayLabel(true);
  }

  function stop() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    setPlayLabel(false);
  }

  function setPlayLabel(playing) {
    if (!ui.play) return;
    ui.play.textContent = "";
    ui.play.appendChild(icon(playing ? "i-pause" : "i-play"));
    ui.play.appendChild(h("span", { text: playing ? "Pause" : "Play" }));
    ui.play.setAttribute("aria-pressed", String(playing));
  }

  dialog.addEventListener("keydown", function (e) {
    if (!ui.img || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") { stop(); showStep(state.step + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { stop(); showStep(state.step - 1); e.preventDefault(); }
  });

  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", function () {
    stop();
    if (state.opener) state.opener.focus();
  });

  document.querySelectorAll(".tile[data-persona]").forEach(function (tile) {
    tile.addEventListener("click", function () { openPersona(tile.getAttribute("data-persona"), tile); });
  });
})();
