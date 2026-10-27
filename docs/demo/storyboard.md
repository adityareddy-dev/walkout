# Walkout, three-minute storyboard (draft for the CEO's read)

Numbers in {braces} come from the recorded demo round they name. Everything on screen is a real run on the OpenTelemetry Demo, nothing staged. Voiceover in quotes.

## 0:00 to 0:20, the hook (from set B's script, with the real shop)

[The Astronomy Shop cart on a phone: Quantity 3, Price $101.96, Total $128.93.] "This shop shipped a cart that charges you for one telescope when you buy three. It's the OpenTelemetry Demo, release 2.1.3, a real bug, fixed upstream months later." [Grid of twelve live browser tiles tagged "bus, slow 3G", "large text", "Spanish", "screen reader", "keyboard only".] "So we sent twelve shoppers, each a Meta Muse Spark agent with a different life." [Tiles turn red one by one.] "{before.left} walked out." [Rosa's tile zooms.] "This is where."

## 0:20 to 0:50, one shopper, both eyes

[Rosa's replay: product page, quantity 3, Add To Cart, cart.] "Rosa's on a cheap phone on the bus. Spark sees her screen and picks one tap at a time." [Her note on screen: "101.96 each, qty 3".] "She remembers the price." [Cart, her words appear.] "{rosa.reason}" "The wrong total is only on the screen. No log has it. You need eyes for this one."

## 0:50 to 1:20, the walkouts only telemetry sees

[Another Rosa run. Add To Cart tapped, nothing changes, tapped again.] "On a slow phone Add To Cart does nothing for seconds, so she taps again." [Cart: six telescopes.] "Now she has six." [Telemetry panel under the tile: "Tap on Add To Cart sent POST /api/cart, nothing on the page changed for {rosa.waitS} s".] "The browser telemetry ties that to the tap and the request behind it. Screen for one cause, telemetry for the other."

## 1:20 to 1:50, why they left

[Scoreboard, the "Why they left" line, then a few tiles with their one-sentence walkout.] "Every walkout gets one plain sentence, the moment and the cause." [Dev's tile, keyboard only.] "Dev uses only the keyboard, and the shop's buttons never show focus, on the fixed release too. That's a second real bug it found on its own."

## 1:50 to 2:30, the fix, proven by a re-run

[Wonder's patch in CartItems.tsx: multiply by quantity.] "Muse Wonder reads the sentences and the cart code and writes the patch. Same shape as the upstream fix." [Terminal: the image rebuilds.] "We rebuild the shop." [Tiles turn green.] "Same twelve shoppers, again."

## 2:30 to 3:00, the number

[Scoreboard: before {before.bought} of 12, after {after.bought} of 12, cost per round.] "{before.bought} of 12 bought. Then {after.bought} of 12." [Rosa's tile, still red if she is.] "And the ones still leaving tell you what to fix next." [Cost line.] "A round costs about {round.usd} dollars."

## Notes

- The shop owner in set B's script is replaced by an open-source shop, said plainly at 0:00.
- No SAM mask. The replay highlights the tapped element from the run's own tap point, so no model is there for decoration.
- Keep "OpenTelemetry" to the shop's name and the telemetry panel. No SRE framing.
