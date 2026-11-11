# Walkout

Twelve shoppers with different lives go through a real shop in a real browser: a cheap phone on slow 3G, 200 percent zoom, keyboard only, a screen reader, Spanish. Each one is a language model agent that looks at the screen and taps one thing at a time.

The shop is the OpenTelemetry Demo at release 2.1.3, which shipped a cart total that ignores quantity ([issue 1526](https://github.com/open-telemetry/opentelemetry-demo/issues/1526)). Release 3.1.0 is the clean build.

The browser records where each shopper gave up. The model writes one sentence per walkout and a patch, the shop gets rebuilt and the same twelve go again. One call picks the source files, another writes the patch and a third reviews it before the rebuild gate, then the same shoppers watch the change live. The frontend has no `npm test` script, so the patch gate is its type check and lint in the image build.

## Setup

You need Node 22 or newer, Git, Docker with Compose v2 and a running Docker daemon. New shopper rounds also need a model API, set up as in [Model API configuration](#model-api-configuration), and use paid API calls. The saved results and browser checks below make no model calls.

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
git -C shops/otel-demo/src apply "$PWD/evidence/2026-11-110012-before/fix.diff"
shops/otel-demo/stack.sh fix
npm run test:shop -- fix
shops/otel-demo/stack.sh unfix
npm run test:shop -- defect
git -C shops/otel-demo/src apply -R "$PWD/evidence/2026-11-110012-before/fix.diff"
```

Apply the saved patch to an unchanged 2.1.3 source checkout. It is the actual patch from the recorded round. `fix` rebuilds it with the frontend's type check and lint, then waits for the frontend to answer. `unfix` restores the original release image and also waits. Screenshots and Playwright traces go to `runs/smoke/`. The `fresh machine` GitHub workflow runs all of these checks from a clean clone and saves the browser artifacts.

`shops/otel-demo/stack.sh down` stops both shops.

## Run new shoppers

With the model API configured on the server and API spend approved:

```sh
npm run demo -- --serve
```

This builds the probe, starts the shops, runs the before round, proposes and builds the patch, runs the after round, restores the release image and serves the scoreboard at http://127.0.0.1:4173/board/. `Ctrl+C` stops the scoreboard server. Stop the shops separately with `shops/otel-demo/stack.sh down`.

The model results vary between rounds, so a new run will not repeat the counts below.

## The run of Nov 11, 2026

I ran the whole loop once from this code on my server, with `WALKOUT_OBS=1` so the demo's Collector, Jaeger and Grafana ran with the shop: the before round, the fix, the patch review, the image rebuild gate, the deploy and the after round. These are the only run records in the repo:

- `evidence/2026-11-110012-before`: 12 shoppers on 2.1.3, 0 of 12 bought, 0.75 USD. Ten left over the cart, which showed 3 Explorascopes at $101.96 plus $26.97 shipping as a $128.93 total. Dev, keyboard only, never reached the quantity box and Add To Cart. Noor, reduced motion, never found the telescope, cause Go Shopping never left the home page.
- `evidence/2026-11-110012-before/fix.diff` and `review.json`: one call picked five cart files, the fix model wrote one edit to `CartItems.tsx` (units and nanos times quantity in the total) and the review call approved it with five reasons. The 2.1.3 frontend image rebuilt with its type check and lint in 141 s and passed.
- `evidence/2026-11-110024-after`: the same 12 on 2.1.3 plus the patch, 11 of 12 bought, 0.67 USD. Rosa, on the cheap phone, left: her Add To Cart went unanswered for 2.0 s, then "The Go to Shopping Cart button does nothing so I cannot check the totals."
- `spend/calls.jsonl`: every model call of the run, 332 calls, 1.65 USD. It includes a first fix attempt and one file pick of a stopped retry, described in the [build log](docs/BUILD-LOG.md).
- `evidence/2026-11-11-rosa-phone-1` to `-3`: Rosa's scripted Add To Cart three times on the same stack after the rounds, each with its saved trace from the demo's Jaeger ([telemetry check](docs/telemetry-check.md)).

## Open the saved results

No Docker, API key or new API spend is needed for this command:

```sh
WALKOUT_RUNS=evidence npm run scoreboard -- --before 2026-11-110012-before --after 2026-11-110024-after --serve
```

Open http://127.0.0.1:4173/board/. It shows the 0-of-12 and 11-of-12 results, shopper decisions, telemetry and patch. The clone contains step records but no replay screenshots, so each shopper opens as text steps. Screenshot replays need the `runs/` directories from the machine that ran the shoppers.

Every model call is logged in `spend/calls.jsonl` and `npx tsx src/cli.ts spend` adds it up per round. The log keeps each call's role (`shopper-model`, `explain-model`, `pick-model`, `fix-model`, `review-model`), its token counts and its priced cost, not the model id.

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

To follow a tap in the demo's own Grafana, start the shop with the demo's
observability add-on (Grafana, Jaeger, Prometheus, OpenSearch) and send the
probe's spans to the demo's Collector:

```sh
WALKOUT_OBS=1 npm run shop
npm run build:probe
port=$(docker port otel-collector 4318 | head -1 | sed 's/.*://')
WALKOUT_OTLP_TRACES_ENDPOINT=http://127.0.0.1:$port/v1/traces \
  node --import tsx scripts/rosa-trace.ts http://localhost:8080 runs/rosa-phone phone
```

`WALKOUT_OBS=1` adds the demo's `compose.observability.yaml` and
`shops/otel-demo/compose.walkout-obs.yaml` to every `stack.sh` command. The
overlay only lets OpenSearch run without locking its memory, cause rootless
Docker can't raise that limit. The Collector is the demo's own, with its own
sanitize and redaction processors. The demo publishes the Collector's
OTLP/HTTP port 4318 on a random host port, which `docker port otel-collector
4318` prints. The export goes there, a separate origin, so it doesn't use the
shopper's connections to the shop.

The last command uses Rosa's existing phone, CPU and network settings, with
scripted browser actions and no model calls. An `unthrottled` final argument
keeps the phone layout and removes CPU/network throttling for comparison.
A `journey` argument starts at the home page before opening the product.
Screenshots, trace IDs, request timing and local spans are saved in the output
folder, and the trace ID is printed. These checks are separate from the saved
model results.

Grafana is at http://localhost:8080/grafana/ and Jaeger at
http://localhost:8080/jaeger/ui/, both through the shop's proxy. In Grafana,
open Explore, pick the Jaeger data source and look up the trace ID. The tap is
the root span, with the browser POST, the frontend proxy, the frontend, cart
and its Valkey calls under it. I checked this on Nov 11, 2026 through the
Jaeger API and the saved Explore links
([telemetry check](docs/telemetry-check.md)). Stop it all with
`WALKOUT_OBS=1 shops/otel-demo/stack.sh down`.

### Model API configuration

The client is `src/llm.ts`. It sends `POST <WALKOUT_API_BASE>/chat/completions` with `Authorization: Bearer <key>` and a JSON body with `model`, `messages` (text parts and base64 PNG screenshots as `image_url` parts), `max_tokens`, and when a call uses them `tools` (function tools), `tool_choice`, `reasoning_effort` and `temperature`. It reads `choices[0].message.content`, `choices[0].message.tool_calls`, `finish_reason` and the token counts in `usage` (`prompt_tokens` and `completion_tokens`, or `input_tokens` and `output_tokens`). It retries on 429 and 5xx, up to four tries. The shopper model has to take screenshots and answer with function tool calls.

Nothing has a default. A command that calls the model stops before it starts and names the setting that is missing.

- `WALKOUT_API_BASE`: the base URL, the part before `/chat/completions`.
- `WALKOUT_API_KEY`: the API key. Without it the key is read from `WALKOUT_API_KEY_FILE`, by default `~/.config/walkout/api-key`.
- `WALKOUT_MODEL`: the model for every call that has no model of its own below.
- `WALKOUT_SHOPPER_MODEL`, `WALKOUT_EXPLAIN_MODEL`: the shopper steps and the walkout sentences.
- `WALKOUT_PRICES`: USD per million input and output tokens for each model used, as JSON: `{"<model id>":{"input":1.25,"output":4.25}}`. Every call is priced from it.
- `WALKOUT_BUDGET_USD`: the spend limit over all logged calls (default 20). A call that would pass it is not sent.

I keep these in a file outside the checkout and load it with `set -a; . ~/.config/walkout/env; set +a`.

### Fix configuration

- `WALKOUT_PICK_MODEL`: file selection model.
- `WALKOUT_FIX_MODEL`: patch model.
- `WALKOUT_REVIEW_MODEL`: review model.
- `WALKOUT_NO_REVIEW=1`: skip review and use the original fix pipeline.
