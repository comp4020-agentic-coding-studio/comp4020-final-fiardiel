# The kitchen: rules for the agent

These come from the argument in `README.md`. If a change would break one, stop and say so instead of working around it.

## What the app must never do

- **Count a payment the receiver hasn't confirmed.** "I paid Dina back" changes no balance until Dina says she got it. A payment she says she didn't get is gone.
- **Let anyone act for the person concerned.** Only the payer deletes their bill; only the receiver answers a payment.
- **Get the money wrong.** Amounts are whole cents everywhere. An equal split adds up to its total exactly. Balances are worked out from the bills and received payments every time, never stored.
- **Nag or shame.** No notifications, reminders, "overdue", rankings of who owes most, or emphasis on debts. Balances are plain facts in name order. The app shows the state when someone looks.
- **Require accounts or passwords.** A person is a name inside a house. The house code is the one shared secret.
- **Show a name or any typed text as markup.** Everything another person typed is escaped in the page. Names are trimmed, length-limited, normalised, and refused when invisible.
- **Let one house touch another.** Every read and write is scoped to the house code. A cookie works only in its own house.

## How to work here

- Run `pnpm check` (typecheck plus every check in `spec/`) against the running app, and `pnpm check:evidence`, before saying anything is done.
- A rule that matters is a check in `spec/`. When the agent gets something wrong, the fix goes into this file or into `spec/` as a failing check first, not just a retry.
- The stack is Node 24 running TypeScript directly (erasable syntax only, `.ts` imports), built-in `node:sqlite` on `/data`, and no frontend framework. Do not add a dependency without saying why.
- `README.md` and `reflections/` are my own writing. Help find sources, check claims against the app and run checks, but do not draft their prose. `PROCESS.md` and the rules in this file were drafted by the agent from my answers and decisions in the session.
