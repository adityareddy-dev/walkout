# Walkout

Twelve shoppers with different lives go through a real shop in a real browser: a cheap phone on slow 3G, 200 percent zoom, keyboard only, a screen reader, Spanish. Each one is a Meta Muse Spark agent that looks at the screen and taps one thing at a time.

The shop is the OpenTelemetry Demo at release 2.1.3, which shipped a cart total that ignores quantity ([issue 1526](https://github.com/open-telemetry/opentelemetry-demo/issues/1526)). Release 3.1.0 is the clean build.

The browser records where each shopper gave up. The model writes one sentence per walkout and a patch, the shop gets rebuilt and the same twelve go again. The frontend has no `npm test` script, so the patch gate is its type check and lint in the image build.

## Setup

You need Node 22 or newer, Git, Docker with Compose v2 and a running Docker daemon. New shopper rounds also need a Meta API key in `META_API_KEY` and use paid API calls. The saved results and browser checks below make no model calls.

```
npm ci
npx playwright install chromium
npm run typecheck
npm test
```

On Linux, Playwright may also need system libraries, installed with `npx playwright install --with-deps chromium`.

## Check the real shop without model calls

Run these on the server:

```sh
docker info
docker compose version
npm run shop
npm run test:shop -- defect
npm run test:shop -- clean
```

The first `npm run shop` clones the shop at 2.1.3 into `shops/otel-demo/src`, gets the 3.1.0 compose files and starts both shops (2.1.3 on :8080, 3.1.0 on :8082). Startup waits until both frontends answer. Keep those ports free. The browser checks open the real shop on desktop and phone layouts, add three telescopes, check the total and complete checkout on the clean build using the demo's sample card.

To check the saved patch and return to the original release, from the repo root:

```sh
git -C shops/otel-demo/src apply "$PWD/evidence/2026-10-270453-before/fix.diff"
shops/otel-demo/stack.sh fix
npm run test:shop -- fix
shops/otel-demo/stack.sh unfix
npm run test:shop -- defect
git -C shops/otel-demo/src apply -R "$PWD/evidence/2026-10-270453-before/fix.diff"
```

Apply the saved patch to an unchanged 2.1.3 source checkout. It is the actual patch from the recorded round. `fix` rebuilds it with the frontend's type check and lint, then waits for the frontend to answer. `unfix` restores the original release image and also waits. Screenshots and Playwright traces go to `runs/smoke/`. The `fresh machine` GitHub workflow runs all of these checks from a clean clone and saves the browser artifacts.

`shops/otel-demo/stack.sh down` stops both shops.

## Run new shoppers

With the API key configured on the server and API spend approved:

```sh
npm run demo -- --serve
```

This builds the probe, starts the shops, runs the before round, proposes and builds the patch, runs the after round, restores the release image and serves the scoreboard at http://127.0.0.1:4173/board/. `Ctrl+C` stops the scoreboard server. Stop the shops separately with `shops/otel-demo/stack.sh down`.

The model results vary between rounds. The measured before/after counts in the recording script refer to the saved October 27 run.

## Open the saved recording results

No Docker, API key or new API spend is needed for this command:

```sh
WALKOUT_RUNS=evidence npm run scoreboard -- --before 2026-10-270453-before --after 2026-10-270458-after --serve
```

Open http://127.0.0.1:4173/board/. It shows the actual 2-of-12 and 8-of-12 results, shopper decisions, telemetry and patch. The clone contains step records but no replay screenshots, so each shopper opens as text steps. Original screenshot replays need the corresponding `runs/` directories from the machine that ran the shoppers. Do not replace them with later shop screenshots.

The [three-minute recording script](docs/demo/recording-script.md) follows the saved results and the real-shop browser checks. The original [storyboard](docs/demo/storyboard.md) describes the screenshot version.

Every model call is logged in `spend/meta.jsonl` and `npx tsx src/cli.ts spend` adds it up per round.

MIT licence.

### Optional OTLP backend

The probe still keeps spans in memory. To also send them to an OTLP/HTTP
Collector, set `WALKOUT_OTLP_TRACES_ENDPOINT` to its full `/v1/traces` URL.
The Collector needs to allow the shop's browser origin through CORS.
The browser never receives a backend API key. Same-origin fetches carry W3C
`traceparent`, and a fetch made during a tap is a child of that tap. The probe
uses explicit contexts so it does not replace the shop's global SDK or wrap
its event handlers. Asynchronous work after the event dispatch starts a
separate trace.

For the demo's optional Bronto destination, put an ingestion key in a file
outside this checkout, owned by your user with mode `0600`, then run:

```sh
WALKOUT_BRONTO_KEY_FILE=/absolute/path/to/ingest-key npm run shop
npm run build:probe
WALKOUT_OTLP_TRACES_ENDPOINT=http://127.0.0.1:14318/v1/traces \
  node --import tsx scripts/rosa-trace.ts http://localhost:8080 runs/rosa-phone phone
```

That last command uses Rosa's existing phone, CPU and network settings, with
scripted browser actions and no model calls. An `unthrottled` final argument
keeps the phone layout and removes CPU/network throttling for comparison.
A `journey` argument starts at the home page before opening the product.
Screenshots, trace IDs, request timing and local spans are saved in the output
folder. These checks are separate from the saved model results.

Bronto receives traces and demo application logs. `walkout` is the log dataset.
Traces are found through their trace ID and the `walkout` service namespace.
The optional Collector overlay keeps the demo's local exporters and sensitive
attribute processors. It does not export server filesystem, Docker or host
metrics to Bronto. To return to the default Collector, stop the shop and start
it again with `WALKOUT_BRONTO_KEY_FILE` unset.
