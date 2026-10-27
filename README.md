# Walkout

Twelve shoppers with different lives go through a real online shop in a real browser: a cheap Android phone, slow 3G, 200 percent zoom, keyboard only, a screen reader, Spanish, and more. Each is a Muse Spark agent on the Meta Model API that looks at the screen and picks one action at a time.

The shop is the OpenTelemetry Demo at release 2.1.3, which shipped a cart total that ignores quantity (open-telemetry/opentelemetry-demo#1526). Release 3.1.0 is the clean build.

The browser records where each shopper gave up (taps that did nothing, slow taps traced to the script line, errors, slow requests). The model writes one sentence per walkout and a patch, the shop is rebuilt, and the same shoppers run again. The scoreboard shows how many bought before and after.

## Setup

Node 22 or newer, Docker, and a Meta Model API key in `META_API_KEY` (or in `~/.config/meta/api-key`).

```
npm install
npx playwright install chromium
npm run demo
```

Every model call is priced into `spend/meta.jsonl`, and a run stops before it would pass `WALKOUT_BUDGET_USD` (20 by default).

MIT licence.
