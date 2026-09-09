# Ninety-second demo script

Have `pnpm dev` running, the demo at http://localhost:4100 in one tab and the dashboard at http://localhost:3000 in another. Set the demo to broken mode first (it is the default on start).

**0:00. The problem.** "A user reports that checkout hangs. Support has a screenshot and a vague description. Normally an engineer now spends an hour trying to reproduce it."

**0:10. The failing session.** In the demo tab sign in and place an order. Point at the button stuck on "Placing order…". "The app embedded a 30 kB script. It recorded the DOM, every click and field change, every request, and every error. The password, card number and the token in the URL were masked in the browser before anything was sent."

**0:30. Replay and evidence.** Switch to the dashboard. Open the session. Press play, then "Jump to first error". "The timeline shows the exact order: the user pressed Place order, `POST /api/orders` returned 200, then a `TypeError` was thrown. The Evidence panel says it in one line: the request succeeded and the page code read a property that is not in the response. It also lists what it could not establish."

**0:55. The regression test.** Open the Test tab, enter `order-confirmation` as the expected element, generate. "Repro turned the recording into a readable Playwright test. Selectors come from test ids, roles and labels, never from recorder internals. The card number is a fixture placeholder because the real value was never captured."

**1:10. Fail, then pass.** Runs tab: run against broken. "It fails for the right reason: the confirmation never appears and the page threw." Run against fixed. "Same test, fixed frontend, passes. The regression test is ready to commit."

**1:25. Close.** "Privacy-first by construction, deterministic generation, and the whole loop runs locally. Everything I just showed is covered by an end-to-end test in the repository."
