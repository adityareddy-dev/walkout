# Phone telemetry check, October 30, 2026

The probe now keeps spans locally and can also export them over OTLP/HTTP to a
Collector. Same-origin fetches carry W3C trace context. The demo's optional
Collector overlay sends traces and application logs to Bronto. Its log dataset
is `walkout`, and trace resources use the `walkout` service namespace.

A separate scripted browser check used Rosa's existing profile: 412 by 839,
4x CPU slowdown, 2,000 ms network latency, 50,000 bytes per second each way,
and a three-second glance. It ran the released 2.1.3 frontend with the same
3.1.0 services used by the demo pair. No failure flag was enabled, no model was
called and no conversion result was added to the saved scoreboard.

The longest Add To Cart POST took 11,313.7 ms in the browser. Bronto showed one
trace with 15 spans and four services: the tap, browser POST, frontend proxy,
frontend, and cart calls, including Valkey operations inside cart. The frontend
POST took 41 ms and cart AddItem 3.58 ms. The frontend span began 9.19 seconds
after the tap. The response succeeded.

Most of the wait therefore happened outside the server handlers. The local
request timeline also shows several image and API requests in flight during
the tap, with image transfers lasting 33 to 55 seconds. Network contention on
the throttled phone is consistent with that evidence. This check does not
separate every part of browser scheduling, connection queuing, transfer time
and CPU work. It does rule out an eleven-second cart-service handler for this
request.

A direct product-page check took 3,424.8 ms. With the same phone layout but
CPU and network throttling removed, another direct check took 26.4 ms.
Those are separate checks, not a latency benchmark. The original October 27
saved model run and its 10.4-second finding remain unchanged.

`npm run typecheck` and all 19 tests pass. The OTLP browser test checks that the
same tap and fetch IDs are retained locally and exported, that the server gets
the fetch's traceparent, that another origin gets no trace header, that later
background requests do not inherit a tap, and that telemetry export does not
trace itself. Existing source-line attribution checks still pass.

The recording script gives the new trace one ten-second scene. The submission
draft adds one sentence about the OTLP destination. These changes do not need
a new model run.
