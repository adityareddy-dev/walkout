# Walkout, three-minute storyboard (draft)

Every number and quote here comes from one run, `npm run demo` plus a clean round at commit e54f08b, 2026-10-26 23:53 to 2026-10-27 00:08 CDT: rounds `2026-10-270453-before`, `2026-10-270458-after` and `2026-10-270503-clean`. Their records are in `evidence/`. Everything on screen is a real run on the OpenTelemetry Demo, nothing staged. Voiceover in quotes.

## 0:00 to 0:20, the hook (from set B's script, with the real shop)

[The Astronomy Shop cart on a phone: Quantity 3, Price $101.96, Total $128.93.] "This shop charges you for one telescope when you buy three. It's the OpenTelemetry Demo. The bug was reported in April 2024, shipped through release 2.1.3 and got fixed upstream in 3.x." [On screen: https://github.com/open-telemetry/opentelemetry-demo/issues/1526] [Grid of twelve live browser tiles tagged "bus, slow 3G", "200% zoom", "Spanish", "screen reader", "keyboard only".] "So we sent twelve shoppers, each a Meta Muse Spark agent with a different life." [Tiles turn red one by one.] "Ten walked out." [Rosa's tile zooms.] "This is where."

## 0:20 to 0:50, one shopper, both eyes (before round)

[Rosa's replay: product page, quantity 3, Add To Cart, cart.] "Rosa's on a cheap phone on the bus. Spark sees her screen and picks one tap at a time." [Her thought line at step 6: "I need three for my kids, so I'll set quantity to 3."] [Cart, her words appear.] "The cart shows 3 scopes at $101.96 each but the total is only $128.93, so the math doesn't add up." "The wrong total is only on the screen. No log has it. You need eyes for this one."

## 0:50 to 1:20, the walkouts only telemetry sees (after round)

[Rosa again, on the fixed shop. Add To Cart tapped at step 8, nothing changes, tapped again at step 9.] "On her phone Add To Cart does nothing for seconds, so she taps again." [Telemetry under the tile: "Tap on Add To Cart sent POST /api/cart and nothing on the page changed until the answer came 6.4 s later."] [Cart page: "Your shopping cart is empty!"] "Then the cart says it's empty, before it has loaded." [She goes back and tries again, steps 18 and 19, answers after 10.4 s and 7.6 s, then "I see 6 scopes but I need 3".] "Now she has six." [Her last words.] "My cart is empty even though I added three Explorascopes, so I can't buy them." "The total is fixed, and she still leaves. The telemetry shows why: the tap and the request behind it."

## 1:20 to 1:50, why they left

[Scoreboard, the "Why they left" line: "10 walked out, each says why in their own words on the tile. 2 of them had a tap go unanswered in their last steps before leaving".] "Every walkout gets one plain sentence, the moment and the cause." [Dev's tile, keyboard only.] "Dev only uses the keyboard. The shop's buttons never show focus, on 3.1.0 too, so he never gets to the cart. That's a second real bug it found by itself."

## 1:50 to 2:30, the fix, proven by a re-run

[Wonder's patch in CartItems.tsx: multiply by quantity.] "Muse Wonder reads the sentences and the cart code and writes the patch, the same shape as the upstream fix." [Terminal: the image rebuilds, then "gate: ... type check and lint in next build ... It passed."] "The shop has no tests, so the patch has to pass its type check in the rebuild." [Tiles turn green.] "Same twelve shoppers, again."

## 2:30 to 3:00, the number

[Scoreboard: before 2 of 12, after 8 of 12, about 0.70 USD a round.] "2 of 12 bought. Then 8 of 12." [The four red tiles after the fix: Rosa (Add To Cart on a slow phone), Margaret (200% zoom, ran out of steps scrolling the cart), Hiro (tablet, couldn't find the telescope after a slow Go Shopping tap), Dev (no focus ring).] "And the four still leaving tell you what to fix next." [Clean 3.1.0 round: 9 of 12, nobody called its total wrong.] "A round costs about seventy cents."

## Notes

- The shop owner in set B's script is replaced by an open-source shop, said plainly at 0:00.
- No SAM mask. The replay highlights the tapped element from the run's own tap point, so no model is there for decoration.
- Keep "OpenTelemetry" to the shop's name and the telemetry panel. No SRE framing.
