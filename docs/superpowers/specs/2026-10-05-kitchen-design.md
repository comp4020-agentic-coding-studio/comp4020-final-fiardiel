# Kitchen: design

Working title: the kitchen. Status: design agreed in conversation, awaiting the
author's review of this file. Nothing here is built yet.

This is a design record, not the README. `README.md` (the argument for what
"good" means), `PROCESS.md` and `CLAUDE.md` are the author's own writing and
are not drafted here. Section 2 records the positions the README will have to
argue and the spec checks will have to protect, so the three places stay in
agreement.

## 1. Purpose and context

The author lives in a house of four people who each cook for themselves. The
recurring frictions are the kitchen (collisions, and mess left for the next
person), cleanliness, and talangin (who fronted money for shared items).
Showers were a minor friction and are cut.

The app is a small multi-user website for one house, centred on the kitchen:
who is cooking right now, and whether the kitchen is left clean for the next
person. It is the author's COMP4020 final project (brief: multi-user,
real-time, persistent, deployed, good by a definition the author defends).

Success for the author: a house can use it for real, a stranger (a marker) can
join a house and do the core thing in seconds, and the README's claims are
true of the live app.

## 2. Positions the design takes

These are the author's decisions. They shape the README and the checks.

- **The kitchen is the centre.** Live use (who is cooking) and slow use
  (cleanliness) meet in one object, instead of two unrelated features.
- **Cleanliness is a handoff, not a chore chart.** No rotas, schedules,
  points or leaderboards. The app makes the state of the kitchen visible and
  leaves the rest to the people.
- **No nagging.** No notifications, reminders or shaming.
- **Blame only while there is a problem.** If the kitchen is messy, the last
  cook is shown as responsible. If it is clean, nobody is highlighted. "Last
  cooked: name" stays visible as a plain fact either way, so responsible people
  who clean up are never blamed.
- **Anyone in the house can mark the kitchen clean or messy.** It works the way
  the house already does: you walk in, you see it, you say so.
- **Anyone in the house can end someone's cooking session.** If someone forgets
  to press "I'm done", whoever sees the empty kitchen ends it for them, the same
  way they would mark the mess. Nobody stays "cooking" overnight.
- **Trust among housemates.** A person is a name inside a house, with no
  password. Impersonation by someone holding the house code is accepted as
  low-stakes, and the README should say so.

## 3. Scope

### In (Crit 8 slice, week 9)

Create or join a house, say you are cooking, say you are done and mark the
kitchen clean or messy, see the kitchen's state, and have all of it still there
on return. The page loads current state on open and after the viewer's own
actions. No live updates yet.

### Next

- **Crit 9 (week 10):** live updates with Server-Sent Events, and one recorded
  multi-user behaviour decision.
- **Crit 10 (week 11):** server-side logging.

### Later, only if the core is solid (in this order)

1. **Talangin for kitchen and shared items.** Log "I bought X for the house" or
   "I covered X for someone", and show who owes whom. Kitchen and shared items
   only.
2. **Optional per-burner tag.** The kitchen has one large and three small
   stovetops. Cooking sessions could optionally note which one. Skipped by
   default because four housemates and four stovetops rarely collide.

### Out

Showers, chore rotas and schedules, rent and utility bills, notifications,
points, leaderboards, real accounts and passwords.

## 4. Architecture

One Node/TypeScript process serves the pages, handles actions as ordinary HTTP
requests, and stores data in one SQLite file on the `/data` volume. It runs on
the course's fixed 256 MB machine. Four parts, one job each:

- **Server:** receives requests, routes them, returns pages. Holds no kitchen
  rules. In the Crit 8 slice every page is rendered on the server and every
  action is a form post. JSON (for re-fetching state) and the event stream
  arrive with SSE in Crit 9.
- **Store:** the only code that touches SQLite. Saves and loads houses,
  people, cook sessions and kitchen marks.
- **Kitchen rules:** plain functions with no database or web code. From the
  history, they work out who is cooking, the kitchen's state, and who (if
  anyone) is shown as responsible. Isolated so the rules can be tested
  directly.
- **Pages:** plain HTML with a little JavaScript, no frontend framework. The
  README is rendered to HTML on the server, because the shipped check reads
  `/readme/` with no script running.

The transport for Crit 9 is **Server-Sent Events**: the app mostly pushes
updates to people, and button presses are ordinary requests. The client
re-fetches current state on every reconnect, since a sleeping phone can miss
events. The server sends a periodic heartbeat so proxies do not close the quiet
connection. The author justifies this choice, with its trade-offs against
WebSockets and polling, in `PROCESS.md`.

## 5. Data and rules

History is kept. Every action adds a record, except ending a cook session,
which fills in that session's end time. Nothing is deleted.

- **House:** a short random code.
- **Person:** a name, unique within a house. The browser keeps a token so the
  same person returns on that device. Without the token, a person picks their
  existing name again ("that's me"), which is the accepted low-stakes
  impersonation.
- **Cook session:** a person, a start time, and an end time. No end time means
  cooking now.
- **Kitchen mark:** "clean" or "messy", who marked it, and when.

Derived by the kitchen rules:

- **Cooking now:** every session with no end time. Several people may cook at
  once.
- **Kitchen state:** the latest mark. A new house starts clean. A mark that
  repeats the current state records nothing.
- **Responsible person:** shown only while the state is messy. It is the person
  of the most recent cook session that started before the mess began, where the
  mess begins at the first messy mark since the kitchen was last clean. If
  someone starts cooking in an already messy kitchen, they are not blamed for
  it, and marking it messy again does not move the blame to them. If no session
  started before the mess, nobody is named.
- **Last cooked:** the person of the most recent session, always shown without
  emphasis.

## 6. Screens and requests

Three screens, phone-first and usable on desktop, with real buttons for the
keyboard pass.

- **Join:** start a new house (the app gives a code to share) or join one with
  its code, then choose a name.
- **Kitchen:** who is cooking now; the kitchen's state, clean or messy; the
  responsible person only while messy; a quiet "last cooked: name". Buttons:
  "I'm cooking", "I'm done", "mark clean", "mark messy", and beside each other
  person who is cooking, a button to end their session.
- **`/readme/`:** the README rendered in full.

"I'm done" immediately asks "left it clean or messy?" with two buttons, so the
handoff happens at the moment of leaving. It can be skipped, and anyone can
mark the kitchen later. Ending someone else's session does not ask: the person
ending it was not the cook, and can mark the kitchen separately if it needs it.

Seven requests: create a house, join a house, start cooking, stop your own
cooking, end someone else's cooking, mark the kitchen, get the kitchen's
current state.

## 7. Edge cases

- Unknown house code: a clear message.
- Name taken in that house: offer "that's me" or pick another name.
- Starting while already cooking, stopping or ending a session that has already
  ended, or marking the state it is already in: harmless, and the response is
  the current state.
- Two people acting at the same moment (both marking messy, or both ending the
  same session): SQLite applies the writes one at a time, and the second is a
  harmless repeat. The result is the same as if they had acted one after the
  other.
- Names are trimmed, length-limited and escaped in the page, because other
  people see them.
- Restarts lose nothing, because all data is in SQLite on `/data`.

## 8. Checks (`spec/`)

The two shipped checks in `spec/invariants.test.ts` stay. New checks run
against the running app over HTTP:

- Create a house, join, start cooking: you appear in another housemate's
  cooking list.
- Done then messy: you are shown as responsible. Marking clean removes the
  responsibility but keeps "last cooked".
- The responsibility rule: someone who starts cooking in an already messy
  kitchen is not made responsible, even when someone marks it messy again.
- Anyone in the house can end someone else's session, and that does not move
  responsibility.
- A name containing HTML appears as text.
- Returning with the same browser cookie finds you as the same person, with the
  house's state as it was left.
- Crit 9: with two open streams, an action by one person reaches the other
  within one second.

Surviving a restart is checked by hand against the Docker image with a real
volume. Surviving a redeploy cannot be checked in CI. Both are **judged**
promises: the README lists them as judged and says how they were judged.

## 9. Open items

- The Crit 8 cutoff date and time are not on the course page. Check with the
  tutor or `/comp4020:radar`.
- The app's name. "The kitchen" is a working title.
- The stack justification and ADR for `PROCESS.md`: the author's own writing.
- **History and visibility.** The database keeps every messy mark with a name,
  forever, while the page only names someone while the kitchen is messy. Keep
  it and argue why in the README, or limit what is stored or shown.
- **Disputes.** Whether the kitchen page shows recent marks ("marked messy by
  Sam, 8pm") so a disagreement is visible, or leaves them out deliberately.
- **Sources.** The reading behind the definition of good. Crit 8 asks the author
  to name it, and the README cites it.
- **Why live matters here.** The README should say what real-time adds for a
  house, for example that the state is accurate the moment you check before
  walking to the kitchen. To revisit for Crit 9.
