# Build log

Times are America/Chicago. Cost is the Meta Model API spend so far for the whole build, priced from each call's token usage at the list price (`spend/meta.jsonl`). The day-one tests run separately and are added here when they report.

## 2026-10-26 22:05 CDT, repo, personas and the probe (M2 and M4 started)

Repo started tonight, after the kickoff (2026-10-26 11:00 CDT). Nothing in it comes from earlier projects.

Twelve personas as Playwright contexts with a card each (`src/personas.ts`). CPU throttle, network and the colour-blind filter go through CDP, the large-text shopper reads at 200 percent browser zoom, the Spanish shopper has the browser in es-MX, and the screen reader shopper gets the accessibility tree with refs instead of a screenshot.

The probe is an init script that runs before the shop's own code. It records OpenTelemetry spans (document load and fetch), web-vitals with attribution, event timing, Long Animation Frames, errors, and whether each tap changed anything within 300 ms.

Found on the way: with `@opentelemetry/instrumentation-user-interaction` on, Chrome's Long Animation Frame entries lose the shop's event handler from their script list, cause that instrumentation wraps every listener in a function from the init script. With it off, the same slow tap reports `blockFor400` in `app.js` line 10. So the probe records taps with its own listeners and leaves that instrumentation out.

The newest OpenTelemetry JS packages (core 3.0, instrumentations 0.300) don't install next to `sdk-trace-web` 2.12, so the probe pins the 2.x line: api 1.9.1, sdk-trace-web 2.12.0, instrumentation 0.223.0.

`test/probe.test.ts` drives a small test page (`test/fixtures/taps`, a test page, not the shop) with a scripted shopper and checks dead taps, repeated taps, the slow tap's script line and an error's line, for a mouse, a touch and a screen reader persona. No model calls.

Cost so far: 0.00 USD.

## 2026-10-26 22:14 CDT, the shopper's loop, live (M3)

Each step the model gets the persona card, the goal, the last eight things it did with what happened after each, and what that person can perceive: a screenshot with numbered marks for the pointer shoppers, a plain screenshot for the keyboard shopper, the accessibility tree with refs for the screen reader shopper. It answers with one `act` tool call (click, type, press, scroll, wait, back, give up, done). Mark labels use only text a sighted person can see, never aria-label. An order counts only when the shop shows it, not when the model says so.

First live calls, on the test page: Muse Spark 1.3 took the screenshot and answered with tool calls on the first try for all three kinds of shopper. A desktop step is about 2,700 input and 150 to 370 output tokens, about 0.004 USD and 1.5 to 2.4 s. A screen reader step is about 1,200 input tokens. So a 25-step run costs at most about 0.10 USD and a round of twelve about 1 USD.

Also in: the walkout sentence (M5, `src/explain.ts`), the fix step (M6, `src/fix.ts`: Spark picks the files, Wonder writes exact find and replace edits, they go on a branch of the shop's source), the round runner with a spend check before each round, and the CLI.

Cost so far: 0.03 USD.
