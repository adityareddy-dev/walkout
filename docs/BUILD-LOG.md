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

## 2026-10-26 22:50 CDT, the day-one result and the shop (M0 read, M1)

The day-one tests (ticket EIG-2934, `docs/hackathons/meta-2026/day-one-2026-10-26.md` in the company repo) passed and the CEO accepted them at 22:52 CDT. The loop that passed is set B: screenshot plus the numbered element list, one prompt line about noting what you saw (with an optional `note` field in the tool), and a wait before each screenshot. Spark 1.3 caught the wrong total in 5 of 5 defect runs and passed 5 of 5 clean runs, at about 1.3 cents a run. That is the loop here now.

The shop is the OpenTelemetry Demo (`shops/otel-demo.json`, `shops/otel-demo/stack.sh`):

- Defect: release 2.1.3. The cart Total ignores quantity, cause `src/frontend/components/CartItems/CartItems.tsx` adds up unit prices without multiplying by quantity. Reported as open-telemetry/opentelemetry-demo#1526, fixed upstream by #2660 (3e7498db). Nothing planted, no feature flag.
- By hand: open http://localhost:8080/product/OLJCESPC7Z, pick quantity 3, tap Add To Cart. The cart shows Quantity 3, Price $101.96, Shipping $26.97, Total $128.93. The right total is $332.85.
- Clean: release 3.1.0 on http://localhost:8082, same flow, Total $332.85.
- Both frontends sit on the 3.1.0 backends, compose project `walkout2934` (`compose.walkout-pair.yaml`). The 2.1.3 frontend has to be on :8080, its image loader only draws the header cart icon on the origin it was built for.
- Fix builds: the 2.1.3 frontend image builds from source on this VPS in 3 min 2 s cold (npm ci and next build, 4 cores). `stack.sh fix` builds the patched source and serves it on :8080 in place of the release image, `stack.sh unfix` puts the release back. The 2.1.3 frontend has no unit tests. Its check is next build's type check and lint inside the image build, so a patch that doesn't compile is never served.

Changes to the loop from set B:

- The wait before each screenshot ends when the shop's own `/api/` calls go quiet (none in flight, none started for 1.5 s), cap 30 s. The day-one wait always ran to its 30 s cap, cause the shop's telemetry and polling never let the whole network go quiet. Now a wait is 1.3 to 2.6 s on the cheap phone.
- A `select` action. A native dropdown never shows in a headless screenshot, so tapping the quantity box showed nothing and the first smoke run tapped it until it ran out of steps.
- The shopper's own past thoughts come back with its steps (the day-one loop had them too). Without them the second smoke run read "$128.93 which is right" and then scrolled between the total and the form for twelve steps.
- Marks in screen pixels. The 2.1.3 checkout form is wider than a 412 px phone, so Chrome zooms the page out to about 0.75, and every mark below the fold was drawn on the field above its own (the Place Order mark sat on the card number field). Marks and taps now use `visualViewport`. The day-one doc had warned about this zoom for raw points.

## 2026-10-26 23:05 CDT, first live demo: before round and the fix (M2 to M6 live)

`npm run demo -- --no-shop` on the defect shop, twelve shoppers, three at a time, round `2026-10-270359-before`.

- Before: 1 of 12 bought, 0.66 USD, about 3.5 min for the round.
- Ten walked out at the cart over the total, each in their own words, for example the slow 3G shopper: "I added three Explorascopes at $101.96 each but the total shows $128.93 instead of $332.85, so I will not pay." The Spanish shopper said it in Spanish.
- The keyboard-only shopper never reached the quantity box and Add To Cart: 23 steps of Tab, then gave up. Worth checking by hand before it goes in the story.
- The reduced-motion shopper paid $128.93 for three without noticing. One of twelve missed the defect.
- The fix (M6): Spark picked four cart files, Wonder wrote the patch in one call (0.033 USD). It multiplies units and nanos by quantity in `CartItems.tsx`, the same shape as upstream #2660. It went on branch `walkout/fix-2026-10-270359-before` of the 2.1.3 source. The frontend image rebuilt in about 75 s with the npm layer cached, and the patched shop was serving on :8080 2 min 10 s after the patch came back.
