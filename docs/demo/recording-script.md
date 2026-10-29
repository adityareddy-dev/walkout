# Walkout, three-minute recording script

This version uses the saved model run from October 27, 2026, rather than claiming a fresh live model run. Results are in `evidence/2026-10-270453-before`, `evidence/2026-10-270458-after` and `evidence/2026-10-270503-clean`. It needs no new model spend. The shop screenshots come from the separate real-browser checks, not from a model replay.

Before recording, open the saved scoreboard with the README command. Open the desktop cart screenshots from the green fresh-machine run's `shop-browser-checks` artifact in separate tabs: `defect/desktop-cart.png`, `fix/desktop-cart.png` and `clean/desktop-order.png`. Keep the scoreboard on Before, with Rosa's tile ready. The clone has text steps, not the original replay screenshots. No live tile grid or terminal rebuild is needed in this version.

## 0:00 to 0:25

Show `defect/desktop-cart.png`, with quantity 3, unit price $101.96, shipping $26.97 and total $128.93 visible.

“This is the OpenTelemetry Demo shop. Three telescopes, a hundred and one dollars each, and the cart charges for only one. That's a real bug in release 2.1.3. Walkout sends twelve shoppers through the shop in real browsers to find where they give up and why.”

## 0:25 to 0:55

Switch to the saved scoreboard. Show Before, then open Rosa and scroll to her last steps.

“These are the results of our saved run. Each shopper has a different setup. A cheap phone, slow internet, large text, keyboard only, Spanish. Muse Spark looks at the screen and chooses one action at a time. Rosa needs three telescopes for her kids. She sees the wrong total and leaves. Here are her actual decisions and the sentence explaining why.”

## 0:55 to 1:25

Switch Rosa to After. Point at the unanswered Add To Cart findings and their step numbers. Keep the recorded text steps visible.

“A screenshot tells us the total looks wrong. Browser telemetry tells us what happened behind a tap. Even after the total is fixed, Rosa taps Add To Cart and gets no visible answer for seconds. She tries again. The cart briefly looks empty, then has six telescopes. Her record connects the tap, the slow request and the decision to leave.”

## 1:25 to 1:55

Close Rosa. Scroll to The fix and open Show the patch.

“Muse Wonder reads the walkout evidence and the cart source, then proposes this patch. The old calculation adds each unit price once. The patch multiplies it by quantity. The shop is rebuilt, and the frontend's type check and lint have to pass before we send the shoppers through again.”

## 1:55 to 2:25

Show `fix/desktop-cart.png`, then `clean/desktop-order.png`.

“The patched cart shows the right total, three hundred and thirty-two dollars and eighty-five cents. Our fresh-machine browser checks verify that on desktop and phone layouts, complete checkout on the patched and clean builds, then restore the original release and check its total again.”

## 2:25 to 3:00

Return to the scoreboard. Show Before 2 of 12, After 8 of 12, then the four shoppers still leaving.

“In the saved model run, two of twelve bought before the patch. Eight bought after it. The clean upstream release got nine. A round cost about seventy cents. Four still leave after our patch, including Rosa on the slow phone and Dev using only a keyboard. Their records show what still needs work. Walkout gives you the failed moment, the cause, a proposed patch and the result when the same shoppers try again.”
