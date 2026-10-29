# Process overview

## From the brief to the idea

The brief asked for a multi-user, real-time website that is good, with no subject. For Crit 8 I started from my house and built a kitchen tracker: who is cooking, and whether the kitchen was left clean. At the crit my tutor said my other idea was better and more complete: Serumah, a Telegram bot my housemate made that splits grocery bills, tracks who owes who and rotates chores. So for Crit 9 I changed the whole app to Serumah, as a web app for one house. The kitchen version is kept in the history and on the Crit 8 cutoff tag.

Serumah is about the house's two kinds of shared work: money and chores. I chose to build the bills first, because in a house of five where people shop on different days, the debts are what gets confusing. Chores are the second feature, and they are not built yet because of time.

## How I worked with the agent

I brainstormed with the agent before any code. It asked me one question at a time, and I made the decisions:

- **What makes it good.** The agent suggested angles. I chose "no awkward conversations": the app turns money into plain facts so nobody has to ask or chase.
- **How a bill is split.** I first liked equal splits only, then itemised receipts where each person claims their own items, and finally decided the payer just types each person's amount, with an equal-split shortcut. The house trusts the payer, the same way it trusts the house code. Claiming items was cut as too much to build.
- **Pairwise debts.** You only owe someone you actually shared a bill with. No simplifying across the house.
- **No login.** I asked whether we needed accounts so things persist. The agent showed that everything is stored on the server, and a person on a new device taps their name on the join page to come back as themselves. I decided against a PIN.

The agent wrote these into a design spec and a task plan before any code ([`35694f8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/35694f8), [`ee566d3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/ee566d3)). For Crit 8 I had a fresh agent and a reviewer for every task. This time the deadline was close, so I chose to let the agent build every task itself in one session, with one fresh reviewer on the whole branch at the end. Each task started with a failing check, and the work stayed on a branch, because a push to `main` deploys.

## The decision about several people at once

The decision for Crit 9 is when a change counts. At first I chose that a payment waits until the person who was paid taps "Got it", and it was built that way. Then I thought about a busy week, with everyone accepting paybacks one by one and waiting on each other, and about the Serumah bot we already use, which registers payments straight away. I switched: payments count at once, and only the person paid can say one never arrived ([`5e7789e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/5e7789e)). The reasons and costs are in [`docs/decisions/0001-payments-count-at-once.md`](docs/decisions/0001-payments-count-at-once.md).

## Where the work was corrected

- The final reviewer found that a double tap on "Got it" or "Delete" showed "That didn't work" even though the first tap counted, and that a live page stopped updating for good if a reconnect failed during a deploy. Each got a failing check first, then the fix ([`a415af7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/a415af7)).
- When I tried the app, someone who joined while a page was open didn't appear in that page's forms. Fixing it showed that joining didn't tell open pages anything at all; a check for that came first ([`7e36f9f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/7e36f9f)).
- When I asked the agent to write my README, it stopped and pointed to the rule in `CLAUDE.md` that the README is my writing. I chose to answer its questions and let it arrange my own words ([`488b1b1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/488b1b1)).

## Crit 10: telling people apart

Crit 10 asked the app to tell people apart, check on the server what each person may change, and log who did what. The weak spot was the name list: anyone in the house could tap any name and become that person, so a housemate could add bills or dispute payments as someone else by accident.

I brainstormed with the agent again before any code, and my answer changed several times:

- **The model.** I first wanted a username and password, then an email reset, then a house account. I settled on a Netflix household: the house code is the household login, and each name is a profile with a required 4-digit PIN. A device that knows you opens straight in. This reverses my Crit 9 decision against a PIN, but not the trust: the PIN stops someone tapping the wrong name by accident, not housemates.
- **Forgetting a PIN.** The agent suggested housemates reset each other's PINs. I turned that down, because asking a housemate brings back the awkwardness the app is for. Instead you retype the house code and choose a new PIN. The reset shows on the house page for everyone and signs out the person's other devices.
- **Old data.** I chose to start fresh rather than migrate the Crit 8 and 9 people, who had no PIN. The app opens a new `serumah.db`; the old file stays on the volume.
- **The screens.** The agent's first mockup was too crowded. I asked for one purpose per screen, like Netflix: only the faces, then the name, then the PIN.

The agent wrote a design and a plan ([`338f74a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/338f74a)), a fresh reviewer read the design before planning, and the agent built it task by task on a branch, each task starting with a failing check ([`636cd72`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/636cd72), [`4c2ec0b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/4c2ec0b), [`417e3d8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/417e3d8), [`3659b66`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/3659b66)). Every action now writes one log line saying which house, who and what.

Where it was corrected:

- The final reviewer found that the log couldn't say whose browser took over a name, and that Chrome could save one person's PIN and offer it on another's page. Both got a failing check, then the fix: sign-ins and resets log `by=` the browser's own person, and the PIN box is no longer a password field ([`e3315bc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/e3315bc)).
- Every log line started with the house code, and I narrate the logs on a projector at the crit. I chose to name a house in the logs by a label like `h12` instead ([`828b26d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/828b26d)).
- When I wrote the README section on getting in, the agent checked it against the app. My claim that the PIN protects a housemate's phone was wrong, because a phone already signed in opens straight in, so I narrowed it ([`3e9b478`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/3e9b478)).

## Stack

One Node and TypeScript server, SQLite on the Fly volume, server-rendered HTML and no framework, as in Crit 8. The machine is small and the app is for one house, so I kept it to as little as possible. Live updates use server-sent events: the server only needs to tell open pages that something changed, and each page fetches itself again. Button presses stay ordinary form posts, so everything still works without JavaScript, just without the live part.

## Final project: reading receipts

I wanted the payer to photograph a receipt instead of typing the amounts. I thought about training my own model to read receipts, but that would have been a different project, and in the time left it would read worse than Claude Haiku. So the app sends the photo to Haiku ([`d67d2a0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/d67d2a0)).

Reading a receipt costs money, and I didn't want strangers using it on my bill. My first idea was a password in front of it, but the agent pointed out that this breaks my own rule of no passwords. Instead, the server lists the houses that may read receipts (`RECEIPT_HOUSES`), each up to a daily limit, and my API key has a spend limit. Every other house never sees the button. That rule went into `CLAUDE.md` and into checks before the code was written.

Haiku's reading only fills in the bill form: the shop, and each line with its price. My first version just listed the items next to an equal split. I changed my mind, because the real problem is that not everyone shares everything: Derrick shouldn't pay for Budi's sauce. The first version gave every line a tick per housemate, which made a long receipt very long. I chose to go person by person instead: pick a housemate, then tap the lines they had, and their face joins a small stack on that line ([`ff0d154`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/ff0d154)). I asked for the agent to show me designs first; we went through two rounds of mockups before building. Lines start with nobody, and a line nobody had counts as the payer's own, so the bill always covers the whole receipt. A misread price can be fixed before adding. Most of a house shop is shared, so tapping every line for every person was slow; from a third round of mockups I picked two shortcuts together: "Everyone had everything" for a shop that's mostly shared, and "Split the rest evenly" for one that's mostly separate. Receipts also carry lines that aren't things anyone bought, so I decided how each is handled: a promo comes off its own item, so whoever had the milk gets the milk's discount; GST, subtotals and payment lines are never split, because GST is already inside the prices; and a card surcharge, rounding or a discount on the whole shop is shared in proportion to what each person had. The agent tested the reading rules on a made-up receipt with a promo, a surcharge and a GST line before I tried real ones. The server works out each share from the lines and ticks, never from amounts the page sends, and warns when the lines don't add up to the receipt's total. The payer still taps Add bill, so a wrong reading costs a correction, not a wrong debt. The lines are saved with the bill, so the history shows what each share was for. That is my README's argument against simplifying debts: nobody should pay without knowing why. A bill typed in by hand stays split by amount, because typing every line is the work the scan exists to save. The photo is never stored or logged.

I added one dependency, Anthropic's SDK, for its retries and typed errors. I pinned it at 0.133.0, because every 1.x release was less than ten days old.

**For the marker:** reading receipts only works in a listed house. The code for one is in my private Ed post.

## What is not done

Chores and editing a bill are not built yet.
