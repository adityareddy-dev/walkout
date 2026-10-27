// The shopper's mind: one model call per step. The model gets the persona
// card, the goal, a short memory of what it already tried, and what the
// persona can perceive right now (a marked screenshot, a plain screenshot for
// the keyboard user, or the accessibility tree for the screen reader user),
// and returns exactly one action.

import { chat, imagePart, parseJsonObject, priceOf, type Message, type Tool } from "./meta.ts";
import type { Action, ModelUsage, Persona } from "./types.ts";

export const SHOPPER_MODEL = process.env.WALKOUT_SHOPPER_MODEL ?? "muse-spark-1.3";

export interface Perception {
  url: string;
  title: string;
  png?: Buffer; // what the persona sees, with marks for pointer personas
  marks?: { id: string; label: string }[];
  tree?: string; // accessibility tree, screen reader persona only
}

export interface Memory {
  step: number;
  action: Action;
  result: string;
}

const ACTIONS: Record<Persona["observation"], string[]> = {
  screenshot: ["click", "select", "type", "scroll", "wait", "back", "give_up", "done"],
  keyboard: ["press", "type", "wait", "back", "give_up", "done"],
  "a11y-tree": ["click", "select", "type", "press", "wait", "back", "give_up", "done"],
};

function actTool(persona: Persona): Tool {
  return {
    type: "function",
    function: {
      name: "act",
      description: "Do exactly one thing in the browser, the next thing this shopper would do.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ACTIONS[persona.observation] },
          target: {
            type: "string",
            description:
              persona.observation === "a11y-tree"
                ? "For click, select and type: the ref of the element in the accessibility tree, like e12."
                : "For click, select and type: the number on the mark, like 7.",
          },
          value: { type: "string", description: "For select: the choice to pick in the dropdown, as written in its list of choices." },
          text: { type: "string", description: "For type: the text to type." },
          submit: { type: "boolean", description: "For type: press Enter after typing." },
          key: { type: "string", description: "For press: Tab, Shift+Tab, Enter, Space, ArrowDown, ArrowUp, Escape, PageDown." },
          times: { type: "integer", description: "For press: how many times in a row, 1 to 10." },
          direction: { type: "string", enum: ["up", "down"], description: "For scroll." },
          reason: { type: "string", description: "For give_up: why you are leaving the shop, in one sentence." },
          why: { type: "string", description: "One short first-person line: what you see and why you do this." },
          note: { type: "string", description: "Optional: anything on this screen you want to remember later, like prices." },
        },
        required: ["action", "why"],
      },
    },
  };
}

function systemPrompt(persona: Persona, goal: string): string {
  const c = persona.card;
  const how: Record<Persona["observation"], string> = {
    screenshot:
      "Each turn you see a screenshot of your screen. Things you can click or type into carry a small numbered mark; use that number as the target. The marks are only there for you to name a target; the real person does not see them.",
    keyboard:
      "Each turn you see a screenshot of your screen. You use only the keyboard: press keys (Tab moves focus forward, Shift+Tab back, Enter or Space activates the focused control) and type into the field that has focus (target can be left empty). You can only know where focus is from what the screenshot shows.",
    "a11y-tree":
      "You are blind and use a screen reader. Each turn you get the accessibility tree of the page as your screen reader exposes it, with refs like [ref=e12]. You cannot see the page. You can activate an element by its ref, type into a field by its ref, or press keys.",
  };
  return [
    `You are ${c.name}. ${c.life}`,
    `Your situation: ${c.constraints.join("; ")}.`,
    `Your patience: ${c.patience}`,
    `Your goal on this shop: ${goal}`,
    how[persona.observation],
    "You can add a short note to any action to remember what you saw, like prices. Your notes come back to you with your steps.",
    "Behave as this real person would, with their patience. Use only what is on the screen now and what you remember doing. If a control does not respond, you may try again, but a real person soon assumes the site is broken and leaves. When you would leave, use give_up with the reason in one plain sentence. Use done only when the shop shows that your order is placed.",
    "Call the act tool exactly once. If you cannot call tools, reply with only a JSON object with the same fields.",
  ].join("\n\n");
}

function memoryText(memory: Memory[]): string {
  if (!memory.length) return "You just opened the shop.";
  const last = memory.slice(-12);
  return (
    "What you did so far:\n" +
    last
      .map((m) => {
        const a = m.action as Record<string, unknown>;
        const what = [a.action, a.target && `target ${a.target}`, a.key && `key ${a.key}${a.times ? ` x${a.times}` : ""}`, a.value && `choice "${a.value}"`, a.text && `"${a.text}"`, a.direction]
          .filter(Boolean)
          .join(" ");
        const note = a.note ? ` (your note: ${a.note})` : "";
        return `${m.step}. ${what}. You thought: ${a.why ?? ""}. Then: ${m.result}${note}`;
      })
      .join("\n")
  );
}

export async function decide(
  persona: Persona,
  goal: string,
  perception: Perception,
  memory: Memory[],
  step: number,
  maxSteps: number,
  purpose: string,
): Promise<{ action: Action; usage: ModelUsage; raw: string }> {
  const parts: Exclude<Message["content"], string> = [];
  parts.push({ type: "text", text: `${memoryText(memory)}\n\nStep ${step} of at most ${maxSteps}. Page: ${perception.title} (${perception.url})` });
  if (perception.tree) parts.push({ type: "text", text: "Accessibility tree:\n" + perception.tree });
  if (perception.png) parts.push(imagePart(perception.png));
  if (perception.marks?.length) {
    parts.push({
      type: "text",
      text: "Marks on the screenshot:\n" + perception.marks.map((m) => `${m.id}: ${m.label}`).join("\n"),
    });
  }
  parts.push({ type: "text", text: "What do you do next?" });

  const messages: Message[] = [
    { role: "system", content: systemPrompt(persona, goal) },
    { role: "user", content: parts },
  ];
  const res = await chat({
    model: SHOPPER_MODEL,
    messages,
    maxTokens: 1500,
    tools: [actTool(persona)],
    toolChoice: "auto",
    reasoningEffort: "low",
    purpose,
    estimateUsd: priceOf(SHOPPER_MODEL, 6000, 1500),
  });
  const rawArgs = res.toolCalls[0]?.arguments ?? res.text;
  const obj = parseJsonObject(rawArgs) ?? {};
  return { action: normalise(obj, persona), usage: res.usage, raw: rawArgs.slice(0, 2000) };
}

function normalise(o: Record<string, unknown>, persona: Persona): Action {
  const why = String(o.why ?? o.reason ?? "").slice(0, 300);
  const note = o.note ? String(o.note).slice(0, 200) : undefined;
  const a = normaliseKind(o, persona, why);
  return note ? ({ ...a, note } as Action) : a;
}

function normaliseKind(o: Record<string, unknown>, persona: Persona, why: string): Action {
  const allowed = ACTIONS[persona.observation];
  const kind = String(o.action ?? "");
  if (!allowed.includes(kind)) {
    return { action: "wait", why: `(no valid action in the reply: ${JSON.stringify(o).slice(0, 120)})` };
  }
  const target = o.target === undefined || o.target === null || o.target === "" ? null : String(o.target).replace(/^\[?ref=/, "").replace(/\]$/, "");
  switch (kind) {
    case "click":
      return target ? { action: "click", target, why } : { action: "wait", why: "(click without a target) " + why };
    case "select":
      return target && o.value != null ? { action: "select", target, value: String(o.value), why } : { action: "wait", why: "(select without a target or choice) " + why };
    case "type":
      return { action: "type", target, text: String(o.text ?? ""), submit: Boolean(o.submit), why };
    case "press": {
      const times = Math.max(1, Math.min(10, Number(o.times ?? 1) || 1));
      return { action: "press", key: String(o.key ?? "Tab"), why, ...(times > 1 ? { times } : {}) };
    }
    case "scroll":
      return { action: "scroll", direction: o.direction === "up" ? "up" : "down", why };
    case "back":
      return { action: "back", why };
    case "give_up":
      return { action: "give_up", reason: String(o.reason ?? why).slice(0, 300), why };
    case "done":
      return { action: "done", why };
    default:
      return { action: "wait", why };
  }
}
