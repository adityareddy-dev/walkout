# Phone telemetry check in the demo's Grafana, November 11, 2026

The probe keeps its spans in memory and can also export them over OTLP/HTTP
to a Collector. Same-origin fetches carry W3C trace context, and a fetch made
during a tap is a child of that tap. This check ran on the same stack as the
run of Nov 11 (README), started with `WALKOUT_OBS=1`, so the OpenTelemetry
Demo's own Collector, Jaeger and Grafana were part of it with their default
configuration.

## Setup

Right after the after round, `stack.sh unfix` put the released 2.1.3 frontend
image back on :8080 (`ghcr.io/open-telemetry/demo:2.1.3-frontend`, image
`sha256:eea527d9d8b04fd0ae7ebee6ca3bcc691d1b8771cd788b2373d29f636796883d`),
the same build the before round used, on the 3.1.0 services with the load
generator stopped and no failure flag. The three checks ran against it
between 00:31:46 and 00:33:39 UTC.

Each check is `scripts/rosa-trace.ts` in phone mode with Rosa's existing
profile: 412 by 839, a phone user agent, 4x CPU slowdown, DevTools Slow 3G
(2,000 ms latency, 50,000 bytes per second each way) and a three-second
glance. It opens the product page, picks quantity 3, waits six seconds and
taps Add To Cart. No model is called.

`WALKOUT_OTLP_TRACES_ENDPOINT` was `http://127.0.0.1:33083/v1/traces`, the
Collector's own OTLP/HTTP port. That is a separate origin from the shop, so
the export does not use the shop's connections.

Right after each check the whole trace was saved from the demo's Jaeger API
(`trace.json`), with the Grafana Explore link for that stack (`grafana.json`).
The numbers below come from those files and the run's own `summary.json` and
`telemetry.json`, all in `evidence/2026-11-11-rosa-phone-1`, `-2` and `-3`
(`metrics.json` has them per run). In the saved traces the server's host name
and the Docker-internal addresses read `redacted`. The metrics computed from
the redacted copies are the same as from the originals.

## Three runs

| Run | Trace ID | Browser POST /api/cart | Held in the browser before sending | Sent to first byte | Proxy to the last Valkey call | Spans | Same-host requests open at the tap |
|---|---|---|---|---|---|---|---|
| 1 | `aec6ad85e0e25070ed1754f053527ac3` | 2,138.8 ms | 0.3 ms | 2,121.7 ms | 30.8 ms | 15 | 5 |
| 2 | `b595e31f57d789a0a4b4a62d29aff43a` | 6,074.3 ms | 3,871.3 ms | 2,158.7 ms | 39.8 ms | 15 | 6 |
| 3 | `619225c3fa1069b5f28c7c0b2f293e64` | 4,187.3 ms | 2,015.1 ms | 2,158.9 ms | 59.7 ms | 15 | 7 |

"Held" is Playwright's `requestStart` for the POST, the time between the
browser creating the request and starting to send it. "Sent to first byte" is
`responseStart` minus `requestStart`. "Proxy to the last Valkey call" runs
from the start of the first `frontend-proxy` span to the end of the last span
with a `db.system` tag. The open requests at the tap are the shop's own: a
flag evaluation, product images and, in run 3, `/api/data`, all to :8080 over
HTTP/1.1 (the Playwright traces show HTTP/1.1 for every request to :8080).

Each trace has the tap as its only root and 15 spans from four services,
`walkout-browser`, `frontend-proxy`, `frontend` and `cart`: the tap, the
browser POST, the proxy, the frontend's `/api/cart` route, cart `AddItem` and
`GetCart`, and four Valkey calls. In Grafana it opens under Explore with the
Jaeger data source and the trace ID. I checked that each saved Explore link
shows its trace in a browser while the stack was up.

## What it shows

The server side of the tap took 31 to 60 ms. Sending to first byte took 2.12
to 2.16 s every time, close to the 2,000 ms latency the profile adds. The rest
of the wait passed before the request left the browser: 0.3 ms in run 1, 3.9
and 2.0 s in runs 2 and 3. In run 1 five other requests to the shop were open
at the tap, in runs 2 and 3 six and seven. Over HTTP/1.1 Chrome opens at most
six connections per host, so with six or more open a new request can wait for
a free one. The three runs are consistent with that, but do not prove it.

The shop's own browser instrumentation also posts its spans to
`/otlp-http/v1/traces` on :8080. That is the released shop and was left as it
is.

## What it does not separate

It does not split the time before sending into connection queuing, browser
scheduling and the 4x CPU slowdown, and it does not measure the throttled
transfer on its own. It is three runs of one scripted tap on emulated
throttling, not a real phone and not a latency benchmark.
