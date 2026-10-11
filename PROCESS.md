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

## Stack

One Node and TypeScript server, SQLite on the Fly volume, server-rendered HTML and no framework, as in Crit 8. The machine is small and the app is for one house, so I kept it to as little as possible. Live updates use server-sent events: the server only needs to tell open pages that something changed, and each page fetches itself again. Button presses stay ordinary form posts, so everything still works without JavaScript, just without the live part.

## What is not done

Chores, reading receipts and editing a bill are not built yet. The page has no real design yet, so the three-second test in the README doesn't pass.
