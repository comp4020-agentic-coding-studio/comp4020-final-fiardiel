# Serumah: rules for the agent

These come from the argument in `README.md`. If a change would break one, stop and say so instead of working around it.

## What the app must never do

- **Let anyone but the receiver undo a payment.** A payment counts as soon as it is recorded, because the house trusts each other. Only the person it was paid to can say it never arrived; then it stops counting.
- **Let anyone act for the person concerned.** Only the payer deletes their bill; only the receiver disputes a payment.
- **Get the money wrong.** Amounts are whole cents everywhere. An equal split adds up to its total exactly. A bill split by item is worked out on the server from the items and who is ticked on each, never from amounts the page sends, so each person's share and the saved items always agree. On a receipt, a discount on one item comes off that item's price; GST, subtotals, totals and payment lines are never split; a fee or credit on the whole receipt (surcharge, delivery, rounding, a whole-shop discount) is shared in proportion to what each person had, with the leftover cents to the payer, so the shares always add up to the receipt exactly. Balances are worked out from the bills and received payments every time, never stored.
- **Nag or shame.** No notifications, reminders, "overdue", rankings of who owes most, or emphasis on debts. Balances are plain facts in name order. What you're owed and what you owe may use the two house colours (ink blue and terracotta) so the direction reads at a glance, but never red or green, and never more size or weight on one side. Red is kept for the Delete button only, which warns about removing a bill, never about a debt. The app shows the state when someone looks.
- **Require accounts, passwords or email.** A person is a name inside a house, with a 4-digit PIN that guards against using someone else's name by accident, not against housemates. The house code is the one shared secret; retyping it resets a PIN. PINs are never stored or logged in plain form, and the logs name a house by a label like `h12`, never by its code.
- **Show a name or any typed text as markup.** Everything another person typed is escaped in the page. Names are trimmed, length-limited, normalised, and refused when invisible.
- **Let one house touch another.** Every read and write is scoped to the house code. A cookie works only in its own house.
- **Spend money reading a receipt for a house that isn't on the list.** Reading a receipt calls Claude, which costs money, so it works only in houses the server lists in `RECEIPT_HOUSES`, up to a daily limit each. Every other house never sees the button. What it reads only fills in the bill form, line by line, for the payer to fix and to say who had each line, person by person, starting from nobody; a line nobody had counts as the payer's own, so the bill always covers the whole receipt. Nothing is added until the payer taps Add bill. A bill typed in by hand stays split by amount, not by item. Receipt photos are never stored or logged.

## How to work here

- Run `pnpm check` (typecheck plus every check in `spec/`) against the running app, and `pnpm check:evidence`, before saying anything is done.
- A rule that matters is a check in `spec/`. When the agent gets something wrong, the fix goes into this file or into `spec/` as a failing check first, not just a retry.
- The stack is Node 24 running TypeScript directly (erasable syntax only, `.ts` imports), built-in `node:sqlite` on `/data`, and no frontend framework. Do not add a dependency without saying why.
- `README.md` and `reflections/` are my own writing. Help find sources, check claims against the app and run checks, but do not draft their prose. `PROCESS.md` and the rules in this file were drafted by the agent from my answers and decisions in the session.
