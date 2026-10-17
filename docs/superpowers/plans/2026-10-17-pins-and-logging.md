# Profile PINs and an Action Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every name in a house gets a required 4-digit PIN (reset by retyping the house code), and every action writes a "who did what" line to the server log, for Crit 10.

**Architecture:** Two new small modules, `src/log.ts` (one escaped log line per action) and `src/pins.ts` (PIN format check and `scrypt` hashing). `Store` gains a PIN hash per person, sign-in by PIN, reset (which rotates the cookie token and records a `pin_changes` row), on a fresh `serumah.db`. `app.ts` replaces the open `/claim` with a per-person PIN page `/h/<code>/as/<id>` and a reset page `/h/<code>/reset/<id>`, and logs after each action.

**Tech Stack:** Node 24 TypeScript (erasable syntax, `.ts` imports), `node:sqlite`, `node:crypto`, vitest + jsdom for checks. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-pins-and-logging-design.md`

## Global Constraints

- Every rule in `CLAUDE.md` holds: whole cents, no nagging, no red/green for debts, everything typed is escaped, every read and write scoped to the house code.
- No new dependency. PINs hashed with `node:crypto` `scrypt`, per-person random salt, compared with `timingSafeEqual`.
- A PIN is exactly four ASCII digits `[0-9]{4}`. It is never stored or logged in plain form.
- Database file is `join(dataDir, "serumah.db")`. `kitchen.db` is not opened, migrated or deleted.
- Log lines go to stdout with `console.log`, one line each, format `house=<CODE> person="<name>"#<id> action=<action> [key=value ...]`; strings JSON-quoted, numbers bare, `person=-` when nobody is signed in.
- Copy: the history entry reads `<Name>'s PIN was changed`. No warning colour or emphasis.
- No lockout after wrong PINs.
- `README.md` and `reflections/` are Rafi's writing; do not edit them.
- Before saying a task is done: `pnpm check` against the running app (`pnpm start` in another shell, default `http://localhost:8080`) and `pnpm check:evidence`.

## Review Focus

- A PIN page or reset for a person id from **another house** (`/h/A/as/<id of someone in B>`): 404, never a cookie for house A. → Task 5 test.
- **Look-alike PINs**: `" 1234"`, `"12345"`, `"١٢٣٤"` (Arabic-Indic digits), `"12a4"`, empty: refused with the PIN message, nothing changes. → Task 3 test.
- **The old cookie after a reset**: the device signed in before the reset lands on the join page, not the house. → Task 5 test.
- **Reset with the code typed loosely** (`"k7p 2qx"`): accepted the same way the home page's join form accepts it (spaces removed, upper-cased); a wrong code is refused and the PIN is unchanged. → Task 5 test.
- **A name with quotes or a newline** in a log line cannot start a new line or fake a `person=` field. → Task 2 test (already written in `spec/unit/log.test.ts`).

---

### Task 1: Design the home and "who's using Serumah?" screens with Rafi

No code. Done when Rafi approves a mockup.

**Files:**
- Create: a throwaway mockup only (visual companion or an Artifact), not in `src/`.

- [ ] **Step 1:** Load `frontend-design:frontend-design`. Read `src/pages.ts` (`layout`, `homePage`, `joinPage`, the CSS tokens at the top) so the mockup uses the existing ink blue / terracotta / mustard / plum palette and spacing scale.
- [ ] **Step 2:** Mock four screens: home (start a house / type a code / your houses), join as "Who's using Serumah?" (name tiles like Netflix profiles, plus "I'm new here" with name + PIN), the PIN page for one name (4 digit boxes, "Forgot my PIN"), and the reset page (house code + new PIN).
- [ ] **Step 3:** Show Rafi, iterate until approved. Write the approved choices (layout, tile style, copy) as a short list at the bottom of this plan under "Approved design", which Task 5 follows.

### Task 2: Update the CLAUDE.md rule, and the action log

**Files:**
- Modify: `CLAUDE.md` (the "Require accounts or passwords" bullet)
- Create: `src/log.ts`
- Test: `spec/unit/log.test.ts` (already written, currently failing)

**Interfaces:**
- Produces: `logLine(code: string, person: Person | null, action: string, details?: Record<string, string | number>): string` and `logAction(...same): void` (prints `logLine(...)` with `console.log`).

- [ ] **Step 1:** Replace the CLAUDE.md bullet "**Require accounts or passwords.** A person is a name inside a house. The house code is the one shared secret." with: "**Require accounts, passwords or email.** A person is a name inside a house, with a 4-digit PIN that guards against using someone else's name by accident, not against housemates. The house code is the one shared secret; retyping it resets a PIN. PINs are never stored or logged in plain form."
- [ ] **Step 2:** Run `pnpm test:unit spec/unit/log.test.ts`. Expected: FAIL, cannot find `src/log.ts`.
- [ ] **Step 3:** Implement `logLine` / `logAction` in `src/log.ts`. Quote strings with `JSON.stringify` (escapes `"` and `\n`); `person` is `JSON.stringify(name) + "#" + id`.
- [ ] **Step 4:** Run `pnpm test:unit spec/unit/log.test.ts`. Expected: 3 passed.
- [ ] **Step 5:** Commit `CLAUDE.md src/log.ts spec/unit/log.test.ts` — `feat: one log line per action saying which house, who and what; PINs in the rules`.

### Task 3: PIN format and hashing

**Files:**
- Create: `src/pins.ts`
- Test: `spec/unit/pins.test.ts`

**Interfaces:**
- Produces: `isPin(raw: string): boolean`, `hashPin(pin: string): string` (returns `"<salt hex>:<hash hex>"`), `pinMatches(pin: string, stored: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it("accepts exactly four ASCII digits", () => {
  expect(isPin("0427")).toBe(true);
  for (const raw of ["", "123", "12345", " 1234", "12a4", "١٢٣٤", "１２３４"]) expect(isPin(raw), raw).toBe(false);
});
it("stores a PIN only as a salted hash", () => {
  const a = hashPin("0427");
  expect(a).not.toContain("0427");
  expect(hashPin("0427")).not.toBe(a); // fresh salt each time
  expect(pinMatches("0427", a)).toBe(true);
  expect(pinMatches("0428", a)).toBe(false);
});
```

- [ ] **Step 2:** `pnpm test:unit spec/unit/pins.test.ts` → FAIL, module missing.
- [ ] **Step 3:** Implement in `src/pins.ts`: `/^[0-9]{4}$/`, `randomBytes(16)`, `scryptSync(pin, salt, 32)`, `timingSafeEqual`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit — `feat: 4-digit PINs, stored only as a salted scrypt hash`.

### Task 4: Store: PINs, sign-in, reset, PIN changes, fresh database

**Files:**
- Modify: `src/store.ts` (schema `people`, new `pin_changes` table, `join`, remove `claim`, add methods below)
- Modify: `src/main.ts:13-14` (`serumah.db`, drop the kitchen.db comment)
- Test: `spec/unit/store.test.ts` (update every `store.join(code, name)` to pass a PIN; new describe block "pins")

**Interfaces:**
- Consumes: `isPin`, `hashPin`, `pinMatches` from Task 3.
- Produces:
  - `join(code: string, rawName: string, pin: string): JoinOutcome`, where the failure reasons gain `"invalid_pin"`. Name is checked before PIN.
  - `person(code: string, personId: number): Person | null`
  - `signIn(code: string, personId: number, pin: string): { ok: true; person: Person; token: string } | { ok: false; reason: "no_person" | "wrong_pin" }` (returns the person's current token, does not rotate)
  - `resetPin(code: string, personId: number, pin: string): { person: Person; token: string } | null` (null when the person isn't in this house or the PIN is malformed; sets a new hash, a new token, inserts a `pin_changes` row, in one transaction)
  - `pinChanges(code: string): { personId: number; at: number }[]`
  - `claim` is removed.
- Schema: `people.pin_hash text not null`; `pin_changes (id integer primary key autoincrement, house_code text not null references houses(code), person_id integer not null references people(id), created_at integer not null)`.

- [ ] **Step 1: Write the failing tests** in `spec/unit/store.test.ts` (and change `joinOk` to `store.join(code, name, "1234")`):

```ts
describe("pins", () => {
  it("refuses a join without a proper PIN", () => {
    const store = memory(); const code = store.createHouse();
    expect(store.join(code, "Dani", "12")).toEqual({ ok: false, reason: "invalid_pin" });
  });
  it("signs in with the right PIN only, and only in the person's own house", () => {
    const store = memory(); const a = store.createHouse(); const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.signIn(a, dani.person.id, "1234")).toEqual({ ok: true, person: dani.person, token: dani.token });
    expect(store.signIn(a, dani.person.id, "9999")).toEqual({ ok: false, reason: "wrong_pin" });
    expect(store.signIn(b, dani.person.id, "1234")).toEqual({ ok: false, reason: "no_person" });
  });
  it("a reset sets a new PIN, signs the old token out and is recorded", () => {
    const store = memory(); const code = store.createHouse();
    const dani = joinOk(store, code, "Dani");
    const reset = store.resetPin(code, dani.person.id, "5678")!;
    expect(reset.token).not.toBe(dani.token);
    expect(store.personByToken(code, dani.token)).toBeNull();
    expect(store.signIn(code, dani.person.id, "1234")).toEqual({ ok: false, reason: "wrong_pin" });
    expect(store.signIn(code, dani.person.id, "5678").ok).toBe(true);
    expect(store.pinChanges(code)).toEqual([{ personId: dani.person.id, at: expect.any(Number) }]);
  });
  it("won't reset someone in another house", () => {
    const store = memory(); const a = store.createHouse(); const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.resetPin(b, dani.person.id, "5678")).toBeNull();
  });
});
```

- [ ] **Step 2:** `pnpm test:unit spec/unit/store.test.ts` → FAIL (`signIn` not a function, join takes no PIN).
- [ ] **Step 3:** Implement the interfaces above in `src/store.ts`; `pinChanges` ordered by `created_at desc`. Change `main.ts` to `serumah.db`.
- [ ] **Step 4:** `pnpm test:unit` → all unit checks pass (`pnpm typecheck` will still fail in `app.ts` until Task 5; that's expected).
- [ ] **Step 5:** Commit — `feat: PINs in the store, a reset signs other devices out, fresh serumah.db`.

### Task 5: Routes, pages and logging in the app

**Files:**
- Modify: `src/app.ts` (route regex, `house()`: join, PIN page, reset, remove claim, `logAction` after each action, history entry)
- Modify: `src/pages.ts` (`homePage`, `joinPage` per the approved design; new `pinPage`, `resetPage`; `Entry` gains `{ kind: "pin"; person: Person }` rendered as `<Name>'s PIN was changed`)
- Modify: `spec/helpers.ts` (`joinAs(code, name, pin = "1234")` posts `{ name, pin }`; `personIdOf` reads the id from the join page's `a[href^="/h/<code>/as/"]` link whose text is the name; new `signInAs(code, id, pin): Promise<Response>` posts `{ pin }` to `/h/<code>/as/<id>`)
- Modify: `spec/houses.test.ts:175-192` (claim checks become PIN checks)
- Test: `spec/houses.test.ts` (new describe "PINs"), `spec/unit/pages.test.ts` (history entry copy and escaping)

**Interfaces:**
- Consumes: Task 2 `logAction`, Task 4 store methods, Task 1 "Approved design".
- Produces routes:
  - `POST /h/<code>/join` form `name`, `pin` → 303 to house + cookie; bad PIN → 400 join page with "Pick a 4-digit PIN."
  - `GET /h/<code>/as/<id>` → 200 PIN page for that name; unknown id or id from another house → 404.
  - `POST /h/<code>/as/<id>` form `pin` → right: 303 to `/h/<code>` + cookie; wrong: 401 PIN page with "That PIN isn't right." ; unknown id → 404.
  - `GET /h/<code>/reset/<id>` → reset page; `POST` form `code`, `pin` → code matches (after removing whitespace and upper-casing) and PIN valid: 303 + new cookie, broadcast; wrong code: 400 "That isn't this house's code."; bad PIN: 400 "Pick a 4-digit PIN."
  - `POST /h/<code>/claim` → 404 (removed).
  - Route regex becomes `/^\/h\/([^/]+)(?:\/([a-z]+)(?:\/(\d+))?)?\/?$/`; an id segment is only valid on `as` and `reset`, otherwise 404.
- Log actions (person, details): `create_house` (null), `join` (new person), `sign_in`, `wrong_pin` (the person whose PIN was tried), `reset_pin`, `wrong_code` (reset with a wrong house code), `add_bill` {bill, cents (total)}, `delete_bill` {bill}, `delete_refused` {bill}, `pay` {payment, to (id), cents}, `dispute` {payment}, `dispute_refused` {payment}. Never the PIN or the typed code.

- [ ] **Step 1: Write the failing checks** in `spec/houses.test.ts`:

```ts
describe("PINs", () => {
  it("asks for a 4-digit PIN when joining", async () => {
    const code = await newHouse();
    for (const pin of ["", "12", "12345", "abcd"]) {
      const res = await send(`/h/${code}/join`, { form: { name: "Dani", pin } });
      expect(res.status, pin).toBe(400);
      expect(textOf(await res.text())).toContain("Pick a 4-digit PIN");
    }
  });
  it("opens a name on a new device only with its PIN", async () => {
    const code = await newHouse(); await joinAs(code, "Dani", "0427");
    const id = await personIdOf(code, "Dani");
    const wrong = await signInAs(code, id, "1111");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toEqual([]);
    const right = await signInAs(code, id, "0427");
    expect(right.status).toBe(303);
    expect(textOf(await housePage(code, cookieOf(right)))).toContain("you are Dani");
  });
  it("won't show or open a person from another house", async () => {
    const a = await newHouse(); const b = await newHouse(); await joinAs(a, "Dani");
    const id = await personIdOf(a, "Dani");
    expect((await send(`/h/${b}/as/${id}`)).status).toBe(404);
    expect((await signInAs(b, id, "1234")).status).toBe(404);
  });
  it("the old claim route is gone", async () => {
    const { code, ids } = await setUpHouse("Dani");
    expect((await send(`/h/${code}/claim`, { form: { person: ids.Dani } })).status).toBe(404);
  });
  it("resets a PIN with the house code typed loosely, signs the old device out, and tells the house", async () => {
    const { code, cookies, ids } = await setUpHouse("Ana", "Dani");
    const loose = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
    const reset = await send(`/h/${code}/reset/${ids.Dani}`, { form: { code: loose, pin: "5678" } });
    expect(reset.status).toBe(303);
    const old = await send(`/h/${code}`, { cookie: cookies.Dani });
    expect(old.headers.get("location")).toBe(`/h/${code}/join`);
    expect(textOf(await housePage(code, cookies.Ana))).toContain("Dani's PIN was changed");
    expect((await signInAs(code, ids.Dani, "5678")).status).toBe(303);
  });
  it("refuses a reset with the wrong house code and keeps the PIN", async () => {
    const { code, ids } = await setUpHouse("Dani");
    const res = await send(`/h/${code}/reset/${ids.Dani}`, { form: { code: "ZZZZZZ", pin: "5678" } });
    expect(res.status).toBe(400);
    expect((await signInAs(code, ids.Dani, "1234")).status).toBe(303);
  });
});
```

And in `spec/unit/pages.test.ts`: a history with `{ kind: "pin", person: { id: 1, name: "<b>Dani</b>" } }` renders the text `<b>Dani</b>'s PIN was changed` with no `<b>` element.

- [ ] **Step 2:** Start the app (`pnpm start`), run `pnpm check`. Expected: the new checks FAIL, and `pnpm typecheck` fails on `store.claim` / `store.join` arity.
- [ ] **Step 3:** Implement the routes, pages (following "Approved design"), `viewFor` adding `pinChanges` to the history for everyone, and the `logAction` calls listed above, each after the store call succeeds (or is refused, for the `_refused` / `wrong_` actions). Update `spec/houses.test.ts` claim checks to the new flow.
- [ ] **Step 4:** Restart the app, run `pnpm check` and `pnpm check:evidence`. Expected: all green. Watch the app's terminal while the checks run: one log line per action, no PIN digits anywhere.
- [ ] **Step 5:** Commit — `feat: a PIN page per name, reset with the house code, and every action logged`.

### Task 6: Deploy and rehearse the crit

- [ ] **Step 1:** Push to `main`; wait for the CI `check` job and deploy to go green (`gh run watch`).
- [ ] **Step 2:** Open the live URL in two Chrome profiles; with `mise exec -- flyctl logs -a <app>` running, create a house, join as two people, add a bill, try the other person's name with a wrong PIN, reset a PIN. Expected: each action appears as one line naming the house and person; the second profile can't act as the first without the PIN.
- [ ] **Step 3:** Tell Rafi what's left for them: the README access paragraph (agent then checks it against the app) and `reflections/crit-10.md`. Tag the cutoff state with `comp4020:ship` only when Rafi asks.

## Approved design

(filled in at the end of Task 1)
