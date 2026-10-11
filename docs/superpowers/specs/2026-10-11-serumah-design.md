# Serumah: design

Working title: Serumah. Status: design agreed in conversation on 2026-10-11,
awaiting the author's review of this file. Nothing here is built yet. It
replaces the kitchen design (`2026-10-05-kitchen-design.md`) as the direction
of the final project, on the tutor's feedback at Crit 8 that this idea was the
more complete one.

This is a design record, not the README. `README.md`, `PROCESS.md`,
`reflections/` and the crit 9 decision record are the author's own writing and
are not drafted here. Section 2 records the positions those documents will
have to argue and the checks will have to protect, so the README, `CLAUDE.md`
and `spec/` stay in agreement.

## 1. Purpose and context

Serumah is a Telegram bot the author's housemate made: it splits grocery
bills, tracks who owes whom, and rotates chores. This app is a web version for
one house, built for the final project brief (multi-user, real-time, persists,
good by a definition the author defends).

The angle that makes it good, to be argued in the README: money and chores
between friends are awkward, and nobody wants to be the one asking "you still
owe me $14". The app turns them into plain facts anyone can look at, so nobody
has to ask, and it never nags or shames. It continues the kitchen's rules: no
blame, no nagging, state shown plainly when someone looks.

Success for the author: a house can use it for real, a marker with only the URL
can join a house and add a bill in seconds, and a bill or payment one person
enters shows up on every other open screen in that house within a second.

## 2. Positions the design takes

These are the author's decisions.

- **The house trusts the payer.** Whoever paid enters the bill and sets each
  person's amount themselves: worked out by hand, on a calculator, or with an
  AI. Nobody confirms their share. It is the same trust as the house code,
  where anyone with the code can act as anyone in the house.
- **The receiver confirms payments.** "I paid Dina $15.50" stays pending until
  Dina taps "got it" (or "didn't get it", which removes it). Whoever knows the
  fact enters it: the payer knows what was bought, and the receiver knows
  whether money arrived. This is the crit 9 decision (section 7).
- **Balances are pairwise.** You only ever owe someone you shared a bill with.
  No debt simplification across the house, because it can tell you to pay
  someone you never shared anything with.
- **Balances are derived, never stored.** They are recomputed from bills and
  received payments every time, so they cannot drift across restarts.
- **No nagging, no shaming.** No reminders, no notifications, no "overdue",
  no ranking of who owes most, no emphasis on debts.
- **No accounts or passwords.** A person is a name inside a house; the house
  code is the one shared secret.

## 3. Scope

### In (Crit 9, cutoff Mon 2026-10-12 12:00)

- Create or join a house with a code and a name (kept from the kitchen app).
- Add a bill: a note, and one amount per housemate. An "equal split" shortcut
  takes a total and the ticked people and fills the amounts, which the payer
  can then edit. The bill's total is the sum of the amounts. A bill may have
  one person in it.
- The payer deletes their own bill (the way to fix a mistake: delete and
  re-enter).
- Record a payment you made to someone; the receiver marks it received or not
  received.
- See your balances with each housemate, pending payments to and from you, and
  the house's history of bills and payments, newest first.
- Every change above reaches every open page in that house within about a
  second, without a reload.

### Next (Crit 10)

Chores: a list of chores, each with an order of housemates and whose turn it
is. The person whose turn it is marks it done and the turn passes on; no clock,
no "overdue". Swapping a turn waits for the other person to accept.

### Not built, with reasons for the README

- **Receipt OCR.** The payer types the amounts. OCR would later fill the same
  amount boxes, and nothing else would change.
- **Shares confirmed by each person, or items claimed by each person.**
  Considered and set aside for trusting the payer (section 7).
- **Debt simplification.** See section 2.
- **Reminders and notifications.** See section 2.
- **Editing a bill.** Delete and re-enter instead, for now.
- **Moving real money.** The app records who owes whom; money moves outside it.
- **The kitchen.** Dropped. The Crit 8 version stays in git history and on its
  cutoff tag.

## 4. Behaviour in detail

### Money

- Amounts are whole cents (integers) everywhere: stored, computed and
  compared. They are shown as dollars with two decimals.
- An amount is a positive number of dollars with at most two decimals. A bill
  needs at least one person with an amount above zero; people left at zero
  are not in the bill.
- The equal-split shortcut divides the total into cents among the ticked
  people. Any remainder cents go to the payer's share if the payer is ticked,
  otherwise to the first ticked person in name order, so the amounts always
  add up to the total exactly.
- A payer's own amount on their bill is their share of it and creates no debt.
- The balance between A and B is the sum of what B owes A from A's bills,
  minus what A owes B from B's bills, minus the received payments B made to
  A, plus the received payments A made to B. It is shown from the viewer's
  side as "You owe X $n", "X owes you $n", or nothing when it is zero.
- A payment has an amount, a payer and a receiver, both in the house and not
  the same person. Status is `pending`, `received` or `rejected`. Only
  `received` payments count. Only the receiver can change the status, and only
  while it is `pending`.
- A payment larger than the current balance is allowed (people round up, or
  pay ahead); the balance then flips direction.

### Who can do what (enforced by the server)

| Action                         | Who                          |
| ------------------------------ | ---------------------------- |
| Add a bill                     | Any housemate; they are the payer |
| Delete a bill                  | Its payer                    |
| Record a payment               | Any housemate; they are the payer |
| Mark a payment received/not    | Its receiver, while pending  |

Anyone else gets a refusal, including a person from another house.

### Two people at once

Each change is a single conditional SQLite write. A payment only moves to
`received` or `rejected` if it is still `pending`; a bill is only deleted if
it still exists and the requester is its payer. If two requests race, one
applies and the other is told the state already changed and shown the current
state. SQLite allows one writer at a time, so no change lands half-done.

### Real time

- Each house page opens `GET /h/:code/events`, a server-sent events stream,
  for the person whose cookie belongs to that house; anyone else is refused.
- After any successful write, the server sends a `changed` event to every
  stream open in that house, and to no other house.
- On `changed`, the page re-fetches its content and redraws in place. The
  browser reconnects a dropped stream on its own; on reconnect the page
  re-fetches too, so someone coming back sees the current state.
- A heartbeat comment every 25 seconds keeps Fly's proxy from closing an idle
  stream. On shutdown, open streams are closed so the machine can stop.
- Without JavaScript, every action still works as a plain form post and
  redirect; only the live updates are lost.

## 5. Architecture

Same stack as Crit 8: Node 24 running TypeScript directly, built-in
`node:sqlite` on the Fly volume at `/data`, server-rendered HTML, no frontend
framework, no new dependencies.

- `src/money.ts` (pure): the equal split into cents, parsing and formatting
  dollar amounts, and pairwise balances from bills and payments.
- `src/store.ts`: keeps `houses` and `people`; drops `cook_sessions` and
  `kitchen_marks`; adds `bills (id, house_code, paid_by, note, created_at)`,
  `bill_shares (bill_id, person_id, cents)` and
  `payments (id, house_code, from_id, to_id, cents, status, created_at, resolved_at)`.
  Every query is scoped by house code.
- `src/live.ts`: the open event streams per house, `broadcast(code)`, the
  heartbeat and shutdown.
- `src/app.ts`: routes. Kitchen routes go; bill, payment and events routes
  come in under `/h/:code/`.
- `src/pages.ts`: the house page (balances, pending payments, add-bill form,
  record-payment form, history) with every piece of typed text escaped.
- `src/rules.ts` (kitchen state) is removed; `src/names.ts` stays.

## 6. Harness changes

### `CLAUDE.md` rules (to confirm with the author)

- **Never count a payment the receiver hasn't confirmed.**
- **Only the person concerned acts:** the payer deletes their bill, the
  receiver confirms a payment.
- **Never nag or shame:** no reminders, no "overdue", no ranking of debts, no
  emphasis on who owes. Balances are plain facts.
- **Money always adds up:** amounts in integer cents, an equal split sums to
  its total exactly, balances are derived from the record and never stored.
- Kept: no accounts or passwords; never show typed text as markup; one house
  never touches another.
- Dropped: the kitchen blame rule.

### Checks in `spec/` (written first, red until built)

- Money (unit): an equal split sums to the total and puts remainders on the
  payer; parsing refuses negative, zero-total, over-precise and non-numeric
  amounts; balances are pairwise; a pending or rejected payment changes no
  balance and a received one does.
- Permissions (against the running app): only the receiver can confirm or
  reject a payment, only the payer can delete a bill, and a person from
  another house is refused on both and on the events stream.
- Two at once: two simultaneous "got it" requests on one payment produce
  exactly one change.
- Real time: a bill added by A arrives as an event on B's open stream within a
  second; a stream in another house receives nothing.
- Persists: a bill and a received payment are still there after the app
  restarts (as the Crit 8 restart check does for houses).
- No nag: no house page contains "overdue", "late", "remind" or "reminder".
- Kept: house, name, escaping and isolation checks; `spec/kitchen.test.ts` and
  the kitchen unit tests are removed with the kitchen.

## 7. The crit 9 decision

Recorded by the author at `docs/decisions/0001-receiver-confirms-payments.md`.
The facts it draws on:

- **Context:** when several people use the app, which changes count straight
  away and which wait for someone else to agree.
- **Options considered:** (A) every person confirms their share of a bill
  before it counts; (B) everything counts straight away and anyone can
  dispute; (C) bills count straight away on the payer's word, payments wait
  for the receiver. Also considered and set aside: each person claiming their
  own items from a receipt (with first-come-first-served on the last unit).
- **Chosen:** C, because whoever knows the fact enters it.
- **Costs:** a payer can put a wrong amount on someone with nobody checking
  (accepted as house trust, the same as the house code); a receiver who never
  taps "got it" leaves the payer showing as owing; the live picture is quieter
  than a version where everyone claims at once.
