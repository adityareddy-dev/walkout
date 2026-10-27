# Walkout

Twelve shoppers with different lives go through a real shop in a real browser: a cheap phone on slow 3G, 200 percent zoom, keyboard only, a screen reader, Spanish. Each one is a Meta Muse Spark agent that looks at the screen and taps one thing at a time.

The shop is the OpenTelemetry Demo at release 2.1.3, which shipped a cart total that ignores quantity ([issue 1526](https://github.com/open-telemetry/opentelemetry-demo/issues/1526)). Release 3.1.0 is the clean build.

The browser records where each shopper gave up. The model writes one sentence per walkout and a patch, the shop gets rebuilt and the same twelve go again. The shop has no tests, so a patch only counts if the frontend's type check passes in the image build.

## Setup

You need Node 22, Docker and a Meta API key in `META_API_KEY`.

```
npm install
npx playwright install chromium
npm run demo
```

The first `npm run demo` clones the shop at 2.1.3 into `shops/otel-demo/src`, gets the 3.1.0 compose files and starts both shops (2.1.3 on :8080, 3.1.0 on :8082). `shops/otel-demo/stack.sh down` stops them.

Every model call is logged in `spend/meta.jsonl` and `npx tsx src/cli.ts spend` adds it up per round.

MIT licence.
