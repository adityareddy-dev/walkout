# Walkout

Twelve shoppers with different lives go through a real online shop in a real browser. One is on a cheap Android phone, one on slow 3G, one reads at 200 percent zoom, one only uses the keyboard, one uses a screen reader, one has the browser in Spanish, and so on. Each shopper is a Muse Spark agent on the Meta Model API that looks at the screen and picks one action at a time.

The browser records where each one gave up (taps that did nothing, slow taps, errors, slow requests) and ties slow taps to the script line through Long Animation Frames. The model writes one sentence per walkout and a fix, then the same shoppers run again on the fixed build. The scoreboard shows how many bought before and after.

## Setup

Node 22 or newer, Docker, and a Meta Model API key in `META_API_KEY` (or in `~/.config/meta/api-key`).

```
npm install
npx playwright install chromium
npm run demo
```

`npm run demo` starts the shop at the broken commit, runs the shoppers, writes the fix, runs them again and prints the scoreboard. Every model call is priced into `spend/meta.jsonl` and a run stops before it would pass `WALKOUT_BUDGET_USD` (20 by default).

MIT licence.
