# Submission draft (for the CEO's read, not sent)

Every number is from one run at commit e54f08b, 2026-10-26 23:53 to 2026-10-27 00:08 CDT: rounds `2026-10-270453-before`, `2026-10-270458-after` and `2026-10-270503-clean` (records in `evidence/`).

## Name

Walkout

## One line

Twelve shoppers with different lives walk through a real shop, and you see exactly where and why each one gave up.

## What it does

Shop owners see a sales number, never the moment someone gave up. Walkout sends twelve persona shoppers through the real site in real browsers. One is on a cheap phone on the bus, one reads at 200 percent zoom, one only uses the keyboard, one uses a screen reader, one has the browser in Spanish, and so on. Each shopper is a Muse Spark agent that looks at the screen and taps one thing at a time, like that person would.

The browser records each run with telemetry (taps that did nothing, taps waiting on a slow request, slow taps traced to the script line, errors). Spark writes one plain sentence per walkout naming the moment and the cause, Muse Wonder writes the patch, the shop is rebuilt and the same twelve go again.

We ran it on the OpenTelemetry Demo at release 2.1.3. Its cart total ignores quantity, reported in April 2024 (https://github.com/open-telemetry/opentelemetry-demo/issues/1526), shipped through 2.1.3 and fixed upstream in 3.x. 2 of 12 bought. After the patch, 8 of 12, and on the clean 3.1.0 release 9 of 12, with nobody calling its total wrong.

Some causes only show on the screen, like that wrong total. Some only show in telemetry. Rosa, on a cheap phone, still left after the fix cause Add To Cart sent its request and nothing changed on the page for up to 10 seconds, so she tapped twice, saw an empty cart, then six telescopes. Walkout needs both, so it has both. It also found a bug we didn't look for: the shop's buttons never show keyboard focus, so the keyboard-only shopper never gets to the cart.

## How we built it

Playwright runs the browsers with CPU, network, font and locale set per persona. Each step Spark gets the screenshot with a numbered list of what can be tapped and answers with one tool call. Its own past thoughts come back to it each step, which is how it remembers the price from the product page. Before each screenshot we wait until the shop's own API calls go quiet, except for the impatient phone shopper, who looks after 3 seconds like a real one would.

The shop has no tests, so a patch only counts if the frontend's type check passes when the image rebuilds.

Telemetry is the OpenTelemetry web SDK plus our own listeners, injected in an isolated world so it works on shops that already ship their own SDK. Findings are joined to the agent's steps by time.

## Meta models used

- Muse Spark 1.3: every shopper step (screenshots in, tool calls out), the walkout sentences, picking the files for the fix.
- Muse Wonder 1.0: writing the patch.

## Prior work

The Walkout repo was started after the kickoff on 2026-10-26 and all its code is new. The shop is the open-source OpenTelemetry Demo, used as is at releases 2.1.3 and 3.1.0. The bug it finds was reported and fixed upstream by other people. Walkout doesn't plant anything.

## Cost

About 0.70 USD for a round of twelve shoppers (0.69 to 0.77 in the run above).
