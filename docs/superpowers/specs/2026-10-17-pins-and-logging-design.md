# Profile PINs and an action log (Crit 10)

## Why

Crit 10 ("Fly by instruments") asks that the app tell people apart, that what
each person may see and change is checked on the server, and that server logs
say who did what. Two pod members will use the app from its URL alone, in
separate Chrome profiles, while Rafi narrates from `flyctl logs`.

Today anyone in a house can tap any name on the join page and become that
person (`POST /h/<code>/claim` hands over the cookie with no check). The house
trusts each other, so this was accepted. But it makes **accidents** easy:
tapping the wrong name on a shared laptop, or picking up a housemate's phone,
and then adding bills or disputing payments as someone else. At the crit it is
also exactly the negative finding: one user changing what belongs to another.
And the server logs nothing but startup and crashes, so there is nothing to
narrate from.

## The model: a Netflix household

- **The house code is the household login.** Typing it gets you to "who's
  using Serumah?". It stays exactly as it is: six characters, the one shared
  secret.
- **Each name is a profile with a required 4-digit PIN.** The PIN is an "it's
  really me" check against accidents, not a wall against housemates. The house
  trusts each other; bills and payments still count the moment they are
  recorded.
- **A device that knows you opens straight in.** The existing per-house cookie
  keeps you signed in, as Netflix remembers your profile.

## Goals

1. Joining with a new name asks for the name and a 4-digit PIN (typed twice
   or once, builder's call). The PIN is required.
2. Opening an existing name from the join page asks for that name's PIN. Right
   PIN: signed in as that person (cookie set, as now). Wrong PIN: stays on the
   PIN screen with a plain message, nothing changes.
3. **Forgot my PIN:** from the PIN screen, the person types the house code
   again and a new 4-digit PIN. That sets the new PIN and signs them in.
   Retyping the code is the deliberate step that stops an accidental reset.
4. **A PIN change shows on the house page** as a plain fact in the history,
   e.g. "Dani's PIN was changed", visible to everyone in the house. It is not
   a notification, not emphasised, not coloured as a warning.
5. **Start fresh.** The houses and people from Crits 8 and 9 are not carried
   over (Rafi's decision). The app opens a new database file
   (`/data/serumah.db`) instead of `kitchen.db`, so every person has a PIN
   from the moment they join and there is no "no PIN yet" state. The old file
   is left on the volume untouched, not deleted, so the reset can be undone.
5b. **Setting or resetting a PIN signs that person out everywhere else.** The
   person's cookie token is replaced, so every other device holding the old
   one (say, a housemate's phone signed in by accident) is back at the join
   page and must enter the new PIN.
6. **Every action writes one log line** to stdout (so it reaches `flyctl
   logs` and persists there), saying house, person (name and id), action and
   its details. Covered: create house, join, PIN sign-in, wrong PIN, PIN
   reset, first PIN set, add bill, delete bill (and refused delete), record
   payment, dispute (and refused dispute). Format:
   `house=K7P2QX person="Dani"#3 action=add_bill bill=12 cents=4500`.
   A name or note cannot break the line or forge another field (quotes and
   newlines are escaped). The PIN itself is never logged.

## Non-goals

- No user accounts, emails, passwords or house account. No outside service,
  no new dependency.
- No change to the house code (length, rotation). Possible later for the
  Final Project.
- No lockout after wrong PINs. Anyone with the house code can reset a PIN
  anyway, so a lockout would only punish mistyping; the log records every
  wrong attempt.
- No change to who may delete a bill or dispute a payment.

## Anti-goals (a failure even if it works)

- Breaking a `CLAUDE.md` rule: nagging, red/green for debts, a house touching
  another house, typed text shown as markup, money wrong.
- A PIN stored or logged as plain digits.
- The PIN screen reachable for a person in another house, or a cookie from one
  house working in another.
- Deleting the old `kitchen.db` (it stays on the volume).

## Constraints

- Stack as in `CLAUDE.md`: Node 24 TypeScript, `node:sqlite`, no framework,
  no new dependency. Hash PINs with `node:crypto` (`scrypt` with a per-person
  salt, compared with `timingSafeEqual`).
- New database file, so no migration: `people` gets a non-null PIN hash and
  salt, and there is a place to record PIN changes for the history.
- Every rule above gets a check in `spec/` first (failing), per `CLAUDE.md`.
  Existing checks that claim a name without a PIN (`spec/houses.test.ts`) are
  updated to the new flow. `pnpm check` and `pnpm check:evidence` green.
- Deployed by **Mon 19 Oct 12:00**.

## Decided by Rafi

- Netflix model; house code stays the household login, no house account.
- Required 4-digit PIN for every name.
- Reset by retyping the house code, no asking a housemate, no email.
- PIN changes show on the house page.
- Setting or resetting a PIN signs that person out on every other device.
- Crit 8 and 9 data is not carried over; start with a fresh database.

## Left to the builder (Claude's calls, flagged for Rafi)

- `scrypt` hashing; no lockout (see non-goals).
- The PIN screen is its own page per person (e.g. `/h/<code>/as/<id>`), so a
  wrong PIN can re-show it with the message.
- PIN input: `inputmode="numeric"`, `pattern="[0-9]{4}"`,
  `autocomplete="off"`, server re-checks exactly four ASCII digits.
- The "PIN changed" history entry is shown to everyone in the house (the
  history otherwise shows only entries involving the viewer; this one is
  about the house's profiles, so everyone sees it).
- The visual design of the home page, the "who's using Serumah?" join page
  and the PIN screens is the plan's first step, done with Rafi (mockups they
  react to) before any code, so nothing is built twice.
- The agent updates the `CLAUDE.md` rule "Require accounts or passwords" to
  describe PINs as the first build step, before any PIN code, since Rafi has
  decided on PINs and `CLAUDE.md` rules are agent-drafted from their decisions.
- PIN-change entries are stored with the house's history and count toward the
  five latest entries on the house page like any other entry.

## Rafi writes (not the agent)

- Updating the README's "no login" paragraph to describe PINs, plus a plain statement of
  who can see and change what (the brief's "written record of the access
  decision"). The agent checks the wording against the app.
- `reflections/crit-10.md`.
