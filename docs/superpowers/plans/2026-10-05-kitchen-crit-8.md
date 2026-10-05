# Kitchen: Crit 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Crit 8 ("It's alive!") slice of the kitchen app: a stranger can start or join a house with a name, say they are cooking or done, mark the kitchen clean or messy, and find it all still there when they come back, live at the `*.fly.dev` URL.

**Architecture:** One Node/TypeScript process using only built-in `node:http` and `node:sqlite`, plus `marked` to render the README. Four units with one job each: `rules` (pure functions over history), `store` (the only code touching SQLite), `pages` (HTML strings), and `app` (routing). Every action is a plain HTML form post that redirects back to a server-rendered page, so this slice ships no client JavaScript; JavaScript arrives with SSE in the Crit 9 plan.

**Tech Stack:** Node 24.21.0 (runs `.ts` directly, no build step), `node:sqlite`, `marked`, Vitest + jsdom (already in the repo), Docker image `node:24.21.0-alpine`.

**Spec:** `docs/superpowers/specs/2026-10-05-kitchen-design.md`

## Global Constraints

Copied from the spec, the repo's harness, and the brief. Every task includes these.

- "One Node/TypeScript process serves the pages, handles actions as ordinary HTTP requests, and stores data in one SQLite file on the `/data` volume. It runs on the course's fixed 256 MB machine."
- "Pages: plain HTML with a little JavaScript, no frontend framework. The README is rendered to HTML on the server, because the shipped check reads `/readme/` with no script running."
- "Names are trimmed, length-limited and escaped in the page, because other people see them."
- The app serves HTTP on `0.0.0.0:$PORT` (`fly.toml` sets `PORT=8080`) and publishes `README.md` at `/readme/`. Keep `spec/invariants.test.ts`, `fly.toml` and the `/data` mount as they are.
- Tool versions are pinned in `mise.toml`: node `24.21.0`, pnpm `11.9.0`.
- Node runs `.ts` by stripping types, so only erasable TypeScript is allowed: no `enum`, no `namespace`, no constructor parameter properties. Import with the `.ts` extension, and use `import type` for types.
- Out of scope for this plan, per the spec: showers, chore rotas, rent and bills, notifications, points, leaderboards, real accounts and passwords, live updates (Crit 9), logging (Crit 10), talangin and the per-burner tag (later).
- `README.md`, `PROCESS.md`, `CLAUDE.md` and `reflections/crit-8.md` are the author's own writing. No task drafts them.
- Commit trailers: end every commit message with the attribution line the session's commit instructions give.

## Review Focus

Failure modes the spec implies but that nobody would think to test unprompted, most likely first. Each has a test in the task that owns the code.

1. **A repeated "mark messy" must not move the blame.** Two housemates tapping "messy", or one double-tap, must not shift responsibility to whoever started cooking in between. Tests: Task 1 (rules), Task 2 (store no-op), Task 6 (HTTP).
2. **A name containing HTML or quotes must show as text everywhere.** Tests: Task 3 (pages), Task 6 (HTTP, on the cooking list and the join page).
3. **Names that differ only in case or spacing, or are empty, over-long, or contain control characters.** `dani` vs `Dani`, `"  Dani "`, an emoji-only name. Expect: the same name is taken; bad names get a clear 400 message. Tests: Task 2, Task 5.
4. **A cookie from another house, or a garbage cookie, must lead to the join page, never an error or someone else's identity.** Test: Task 5.
5. **Malformed, unexpected or oversized form input must produce a 4xx page, never a 500 or a hung request.** Unknown `action` or `state`, a missing field, a non-numeric `person`, a body over the limit, a malformed house code in the path. Tests: Task 5 (code, claim) and Task 6 (cook, mark, oversized body).

## File Structure

| File | Responsibility |
|---|---|
| `src/rules.ts` | Pure kitchen rules over history. No database, no web. |
| `src/names.ts` | Name limit and normalisation. Pure. |
| `src/store.ts` | SQLite access: houses, people, cook sessions, kitchen marks. Monotonic clock. |
| `src/pages.ts` | HTML strings: layout, home, join, kitchen, handoff, message. Escaping lives here. |
| `src/readme.ts` | Renders `README.md` to a full HTML page with `marked`. |
| `src/app.ts` | Request handler: routing, form and cookie handling. No rules, no SQL. |
| `src/main.ts` | Entry point: reads `PORT` and `DATA_DIR`, opens the store, listens. |
| `spec/unit/*.test.ts` | In-process checks (rules, names, store, pages). Need no running app. |
| `spec/helpers.ts` | Shared fetch helpers for checks against the running app. |
| `spec/site.test.ts`, `spec/houses.test.ts`, `spec/kitchen.test.ts` | Checks against the running app over HTTP. |
| `vitest.unit.config.ts` | Runs only `spec/unit/` with no `globalSetup`, so unit checks run before the app exists. |
| `Dockerfile` | Replaces the busybox placeholder with the Node image. |

`pnpm check` runs everything (`vitest.config.ts` includes all of `spec/`), against the running app, exactly as CI does.

**Running the app locally** (used from Task 4 on). In a second terminal, from the repo root:

```bash
DATA_DIR=/tmp/kitchen-dev pnpm start
```

Stop it with Ctrl-C and start it again after any change to `src/`. Use a fresh `DATA_DIR` whenever you want an empty database. `pnpm check` then finds it at `http://localhost:8080`.

---

### Task 1: Kitchen rules

**Files:**
- Create: `src/rules.ts`
- Create: `vitest.unit.config.ts`
- Create: `spec/unit/rules.test.ts`
- Modify: `package.json` (add `test:unit`), `tsconfig.json` (include `src`, erasable syntax only), `.gitignore` (ignore `data/`)

**Interfaces:**
- Consumes: nothing.
- Produces (`src/rules.ts`):
  - `type KitchenState = "clean" | "messy"`
  - `type Session = { personId: number; startedAt: number; endedAt: number | null }`
  - `type Mark = { state: KitchenState; markedBy: number; at: number }`
  - `cookingNow(sessions: Session[]): number[]` (person ids with an open session, in start order as given)
  - `kitchenState(marks: Mark[]): KitchenState`
  - `lastCooked(sessions: Session[]): number | null`
  - `responsible(sessions: Session[], marks: Mark[]): number | null`

- [ ] **Step 1: Commit the approved spec and this plan**

```bash
git add docs/superpowers/specs docs/superpowers/plans
git commit -m "docs: add kitchen design spec and Crit 8 implementation plan"
```

- [ ] **Step 2: Make sure dependencies are installed**

Run: `pnpm install --frozen-lockfile`
Expected: finishes with no errors (a no-op if already installed).

- [ ] **Step 3: Configure the repo for `src/` and unit checks**

In `tsconfig.json`, change the last compiler option line and the `include` line so they read:

```jsonc
    "verbatimModuleSyntax": true,
    // Node runs the .ts files directly by stripping types, so syntax that
    // needs a real compile (enum, namespace, parameter properties) must not
    // creep in.
    "erasableSyntaxOnly": true
  },
  "include": ["*.ts", "spec", "scripts", "src"]
```

In `package.json`, add this script after `"test"`:

```json
    "test:unit": "vitest run --config vitest.unit.config.ts",
```

Append to `.gitignore`:

```
# local SQLite data for the app (production data lives on the Fly volume)
data/
```

Create `vitest.unit.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// The unit checks (rules, names, store, pages) run in-process and need no
// running app, so they can run while the app is still being built:
//   pnpm test:unit
// `pnpm check` runs them too, through vitest.config.ts, which includes all of spec/.
export default defineConfig({
  test: { include: ["spec/unit/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the failing tests**

Create `spec/unit/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cookingNow, kitchenState, lastCooked, responsible } from "../../src/rules.ts";
import type { Mark, Session } from "../../src/rules.ts";

const DANI = 1;
const RAFI = 2;

const session = (personId: number, startedAt: number, endedAt: number | null = null): Session => ({
  personId,
  startedAt,
  endedAt,
});
const mark = (state: Mark["state"], at: number, markedBy = DANI): Mark => ({ state, markedBy, at });

describe("a new house", () => {
  it("is clean, with nobody cooking and nobody to name", () => {
    expect(kitchenState([])).toBe("clean");
    expect(cookingNow([])).toEqual([]);
    expect(lastCooked([])).toBeNull();
    expect(responsible([], [])).toBeNull();
  });
});

describe("cooking now", () => {
  it("lists everyone with an open session, so several people can cook at once", () => {
    const sessions = [session(DANI, 1), session(RAFI, 2), session(3, 3, 4)];
    expect(cookingNow(sessions)).toEqual([DANI, RAFI]);
  });
});

describe("responsibility", () => {
  it("names the last cook while the kitchen is messy", () => {
    const sessions = [session(DANI, 1, 2)];
    const marks = [mark("messy", 3)];
    expect(kitchenState(marks)).toBe("messy");
    expect(responsible(sessions, marks)).toBe(DANI);
  });

  it("names nobody once it is clean, but still reports who cooked last", () => {
    const sessions = [session(DANI, 1, 2)];
    const marks = [mark("messy", 3), mark("clean", 4, RAFI)];
    expect(kitchenState(marks)).toBe("clean");
    expect(responsible(sessions, marks)).toBeNull();
    expect(lastCooked(sessions)).toBe(DANI);
  });

  it("does not blame someone who starts cooking in an already messy kitchen", () => {
    const sessions = [session(DANI, 1, 2), session(RAFI, 4)];
    const marks = [mark("messy", 3)];
    expect(responsible(sessions, marks)).toBe(DANI);
    expect(lastCooked(sessions)).toBe(RAFI);
  });

  it("is not shifted by a repeated messy mark", () => {
    const sessions = [session(DANI, 1, 2), session(RAFI, 4)];
    const marks = [mark("messy", 3), mark("messy", 5, RAFI)];
    expect(responsible(sessions, marks)).toBe(DANI);
  });

  it("names a cook who is still cooking when the mess is called", () => {
    const sessions = [session(DANI, 1)];
    expect(responsible(sessions, [mark("messy", 2, RAFI)])).toBe(DANI);
  });

  it("names nobody when it is messy but nobody has cooked", () => {
    const marks = [mark("messy", 1)];
    expect(kitchenState(marks)).toBe("messy");
    expect(responsible([], marks)).toBeNull();
  });

  it("does not depend on the order the history arrives in", () => {
    const sessions = [session(RAFI, 4), session(DANI, 1, 2)];
    const marks = [mark("clean", 5), mark("messy", 3), mark("messy", 6)];
    expect(kitchenState(marks)).toBe("messy");
    expect(responsible(sessions, marks)).toBe(RAFI);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm test:unit`
Expected: FAIL, the suite cannot import `../../src/rules.ts` (file does not exist).

- [ ] **Step 6: Write the implementation**

Create `src/rules.ts`:

```ts
// The kitchen's rules, as plain functions over the recorded history. No
// database and no web code, so every rule can be checked directly.

export type KitchenState = "clean" | "messy";

export type Session = {
  personId: number;
  startedAt: number;
  endedAt: number | null;
};

export type Mark = {
  state: KitchenState;
  markedBy: number;
  at: number;
};

function latest<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (best === undefined || key(item) > key(best)) best = item;
  }
  return best;
}

// When the current mess began: the first messy mark since the last clean one.
// A repeated messy mark does not restart it, so repeating "messy" can never
// move the blame. Null when the kitchen is clean.
function messySince(marks: Mark[]): number | null {
  let since: number | null = null;
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    if (m.state === "messy") since ??= m.at;
    else since = null;
  }
  return since;
}

// Everyone with an open session. Several people can cook at once.
export function cookingNow(sessions: Session[]): number[] {
  return sessions.filter((s) => s.endedAt === null).map((s) => s.personId);
}

// The latest mark wins; a new house has no marks and starts clean.
export function kitchenState(marks: Mark[]): KitchenState {
  return messySince(marks) === null ? "clean" : "messy";
}

// The person of the most recent session, shown as a plain fact.
export function lastCooked(sessions: Session[]): number | null {
  return latest(sessions, (s) => s.startedAt)?.personId ?? null;
}

// Only while the kitchen is messy: the person of the most recent session that
// started before the mess began. Someone who starts cooking in a kitchen that
// is already messy is not blamed for it.
export function responsible(sessions: Session[], marks: Mark[]): number | null {
  const since = messySince(marks);
  if (since === null) return null;
  const before = sessions.filter((s) => s.startedAt < since);
  return latest(before, (s) => s.startedAt)?.personId ?? null;
}
```

- [ ] **Step 7: Run the tests to verify they pass, and typecheck**

Run: `pnpm test:unit && pnpm typecheck`
Expected: PASS (9 tests in `rules.test.ts`), typecheck exits 0 with no output.

- [ ] **Step 8: Commit**

```bash
git add src/rules.ts spec/unit/rules.test.ts vitest.unit.config.ts package.json tsconfig.json .gitignore
git commit -m "feat: add pure kitchen rules with unit checks"
```

---

### Task 2: Names and the store

**Files:**
- Create: `src/names.ts`, `src/store.ts`
- Create: `spec/unit/names.test.ts`, `spec/unit/store.test.ts`

**Interfaces:**
- Consumes: `KitchenState`, `Session`, `Mark`, `kitchenState` from `src/rules.ts`.
- Produces (`src/names.ts`): `NAME_MAX = 24`; `normaliseName(raw: string): string | null`.
- Produces (`src/store.ts`):
  - `type Person = { id: number; name: string }`
  - `type History = { sessions: Session[]; marks: Mark[] }`
  - `type JoinOutcome = { ok: true; person: Person; token: string } | { ok: false; reason: "no_house" | "invalid_name" | "name_taken" }`
  - `class Store` with `constructor(path: string)` (`":memory:"` allowed), `close(): void`, `createHouse(): string`, `houseExists(code: string): boolean`, `join(code: string, rawName: string): JoinOutcome`, `claim(code: string, personId: number): { person: Person; token: string } | null`, `personByToken(code: string, token: string): Person | null`, `people(code: string): Person[]`, `startCooking(code: string, personId: number): boolean`, `stopCooking(code: string, personId: number): boolean`, `mark(code: string, personId: number, state: KitchenState): boolean`, `history(code: string): History`.
  - Booleans: `startCooking`/`stopCooking`/`mark` return `false` (and record nothing) when the action changes nothing: already cooking, not cooking, or the kitchen is already in that state.

- [ ] **Step 1: Write the failing tests for names**

Create `spec/unit/names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAME_MAX, normaliseName } from "../../src/names.ts";

describe("normaliseName", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseName("  Dani   B ")).toBe("Dani B");
    expect(normaliseName("Dani\tB")).toBe("Dani B");
  });

  it("rejects empty, over-long and control-character names", () => {
    expect(normaliseName("")).toBeNull();
    expect(normaliseName("   ")).toBeNull();
    expect(normaliseName("x".repeat(NAME_MAX + 1))).toBeNull();
    expect(normaliseName("bad\u0007name")).toBeNull();
    expect(normaliseName("x".repeat(NAME_MAX))).toBe("x".repeat(NAME_MAX));
  });

  it("counts characters, not UTF-16 units", () => {
    expect(normaliseName("😀".repeat(NAME_MAX))).not.toBeNull();
    expect(normaliseName("😀".repeat(NAME_MAX + 1))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit`
Expected: FAIL, cannot import `../../src/names.ts`.

- [ ] **Step 3: Implement names**

Create `src/names.ts`:

```ts
export const NAME_MAX = 24;

// Names are shown to everyone in the house, so they are trimmed, collapsed to
// single spaces and length-limited. Null means the name cannot be used.
export function normaliseName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "" || [...name].length > NAME_MAX) return null;
  if (/\p{Cc}/u.test(name)) return null;
  return name;
}
```

- [ ] **Step 4: Write the failing tests for the store**

Create `spec/unit/store.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../src/store.ts";

const open: Store[] = [];
const memory = (): Store => {
  const store = new Store(":memory:");
  open.push(store);
  return store;
};
afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

function joinOk(store: Store, code: string, name: string) {
  const outcome = store.join(code, name);
  if (!outcome.ok) throw new Error(`join failed: ${outcome.reason}`);
  return outcome;
}

describe("houses", () => {
  it("creates houses with six-character codes that avoid look-alike characters", () => {
    const store = memory();
    const code = store.createHouse();
    expect(code).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(store.houseExists(code)).toBe(true);
    expect(store.houseExists("ZZZZZZ")).toBe(false);
  });
});

describe("joining", () => {
  it("stores the normalised name", () => {
    const store = memory();
    const code = store.createHouse();
    expect(joinOk(store, code, "  Dani   B  ").person.name).toBe("Dani B");
  });

  it("rejects bad names", () => {
    const store = memory();
    const code = store.createHouse();
    for (const name of ["", "   ", "x".repeat(25), "bad\u0007name"]) {
      expect(store.join(code, name), JSON.stringify(name)).toEqual({ ok: false, reason: "invalid_name" });
    }
  });

  it("treats a name as taken whatever its case, within one house only", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    joinOk(store, a, "Dani");
    expect(store.join(a, "dani")).toEqual({ ok: false, reason: "name_taken" });
    expect(store.join(b, "dani").ok).toBe(true);
  });

  it("reports an unknown house", () => {
    expect(memory().join("ZZZZZZ", "Dani")).toEqual({ ok: false, reason: "no_house" });
  });
});

describe("identity", () => {
  it("finds a person by token, only inside their own house", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.personByToken(a, dani.token)).toEqual(dani.person);
    expect(store.personByToken(b, dani.token)).toBeNull();
    expect(store.personByToken(a, "nonsense")).toBeNull();
    expect(store.personByToken(a, "")).toBeNull();
  });

  it("lets someone claim an existing name, only within its house", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.claim(a, dani.person.id)).toEqual({ person: dani.person, token: dani.token });
    expect(store.claim(b, dani.person.id)).toBeNull();
    expect(store.claim(a, 9999)).toBeNull();
  });

  it("lists the people in a house by name", () => {
    const store = memory();
    const code = store.createHouse();
    joinOk(store, code, "Rafi");
    joinOk(store, code, "Dani");
    expect(store.people(code).map((p) => p.name)).toEqual(["Dani", "Rafi"]);
  });
});

describe("cooking and marking", () => {
  it("records a session once and ends it once", () => {
    const store = memory();
    const code = store.createHouse();
    const { person } = joinOk(store, code, "Dani");
    expect(store.startCooking(code, person.id)).toBe(true);
    expect(store.startCooking(code, person.id)).toBe(false);
    expect(store.history(code).sessions).toHaveLength(1);
    expect(store.history(code).sessions[0].endedAt).toBeNull();
    expect(store.stopCooking(code, person.id)).toBe(true);
    expect(store.stopCooking(code, person.id)).toBe(false);
    expect(store.history(code).sessions[0].endedAt).not.toBeNull();
  });

  it("does not record a mark that repeats the current state", () => {
    const store = memory();
    const code = store.createHouse();
    const { person } = joinOk(store, code, "Dani");
    expect(store.mark(code, person.id, "clean")).toBe(false); // a new house is already clean
    expect(store.mark(code, person.id, "messy")).toBe(true);
    expect(store.mark(code, person.id, "messy")).toBe(false);
    expect(store.mark(code, person.id, "clean")).toBe(true);
    expect(store.history(code).marks.map((m) => m.state)).toEqual(["messy", "clean"]);
  });

  it("gives every event a later time than the one before it", () => {
    const store = memory();
    const code = store.createHouse();
    const { person } = joinOk(store, code, "Dani");
    store.startCooking(code, person.id);
    store.stopCooking(code, person.id);
    store.mark(code, person.id, "messy");
    const { sessions, marks } = store.history(code);
    expect(sessions[0].startedAt).toBeLessThan(sessions[0].endedAt!);
    expect(sessions[0].endedAt!).toBeLessThan(marks[0].at);
  });
});

describe("persistence", () => {
  it("keeps everything across a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    const path = join(dir, "nested", "kitchen.db");
    try {
      const first = new Store(path);
      const code = first.createHouse();
      const dani = joinOk(first, code, "Dani");
      first.startCooking(code, dani.person.id);
      first.mark(code, dani.person.id, "messy");
      first.close();

      const second = new Store(path);
      expect(second.houseExists(code)).toBe(true);
      expect(second.personByToken(code, dani.token)).toEqual(dani.person);
      const history = second.history(code);
      expect(history.sessions).toHaveLength(1);
      expect(history.marks.map((m) => m.state)).toEqual(["messy"]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm test:unit`
Expected: names tests PASS; the store suite FAILS, cannot import `../../src/store.ts`.

- [ ] **Step 6: Implement the store**

Create `src/store.ts`:

```ts
import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normaliseName } from "./names.ts";
import { kitchenState } from "./rules.ts";
import type { KitchenState, Mark, Session } from "./rules.ts";

export type Person = { id: number; name: string };
export type History = { sessions: Session[]; marks: Mark[] };
export type JoinOutcome =
  | { ok: true; person: Person; token: string }
  | { ok: false; reason: "no_house" | "invalid_name" | "name_taken" };

// No 0/O or 1/I, so a code read out loud or typed on a phone survives.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

const SCHEMA = `
  create table if not exists houses (
    code text primary key,
    created_at integer not null
  );
  create table if not exists people (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    name text not null,
    name_key text not null,
    token text not null unique,
    unique (house_code, name_key)
  );
  create table if not exists cook_sessions (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    person_id integer not null references people(id),
    started_at integer not null,
    ended_at integer
  );
  create table if not exists kitchen_marks (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    state text not null check (state in ('clean', 'messy')),
    marked_by integer not null references people(id),
    marked_at integer not null
  );
`;

type PersonRow = { id: number; name: string };
type SessionRow = { person_id: number; started_at: number; ended_at: number | null };
type MarkRow = { state: string; marked_by: number; marked_at: number };

export class Store {
  private db: DatabaseSync;
  private lastAt = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // Strictly increasing within this process, so two events never share a time
  // and "started before the mess was marked" always has a clear answer.
  private now(): number {
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    return this.lastAt;
  }

  houseExists(code: string): boolean {
    return this.db.prepare("select 1 from houses where code = ?").get(code) !== undefined;
  }

  createHouse(): string {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.houseExists(code));
    this.db.prepare("insert into houses (code, created_at) values (?, ?)").run(code, this.now());
    return code;
  }

  join(code: string, rawName: string): JoinOutcome {
    if (!this.houseExists(code)) return { ok: false, reason: "no_house" };
    const name = normaliseName(rawName);
    if (name === null) return { ok: false, reason: "invalid_name" };
    const key = name.toLowerCase();
    const taken = this.db.prepare("select 1 from people where house_code = ? and name_key = ?").get(code, key);
    if (taken !== undefined) return { ok: false, reason: "name_taken" };
    const token = randomBytes(24).toString("hex");
    const result = this.db
      .prepare("insert into people (house_code, name, name_key, token) values (?, ?, ?, ?)")
      .run(code, name, key, token);
    return { ok: true, person: { id: Number(result.lastInsertRowid), name }, token };
  }

  // Taking over an existing name on a new device. The house code is the only
  // secret, which the spec accepts for a house of housemates.
  claim(code: string, personId: number): { person: Person; token: string } | null {
    const row = this.db
      .prepare("select id, name, token from people where id = ? and house_code = ?")
      .get(personId, code) as (PersonRow & { token: string }) | undefined;
    return row === undefined ? null : { person: { id: row.id, name: row.name }, token: row.token };
  }

  personByToken(code: string, token: string): Person | null {
    const row = this.db
      .prepare("select id, name from people where house_code = ? and token = ?")
      .get(code, token) as PersonRow | undefined;
    return row === undefined ? null : { id: row.id, name: row.name };
  }

  people(code: string): Person[] {
    const rows = this.db
      .prepare("select id, name from people where house_code = ? order by name_key")
      .all(code) as PersonRow[];
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  private openSession(code: string, personId: number): { id: number } | undefined {
    return this.db
      .prepare("select id from cook_sessions where house_code = ? and person_id = ? and ended_at is null")
      .get(code, personId) as { id: number } | undefined;
  }

  startCooking(code: string, personId: number): boolean {
    if (this.openSession(code, personId) !== undefined) return false;
    this.db
      .prepare("insert into cook_sessions (house_code, person_id, started_at) values (?, ?, ?)")
      .run(code, personId, this.now());
    return true;
  }

  stopCooking(code: string, personId: number): boolean {
    const open = this.openSession(code, personId);
    if (open === undefined) return false;
    this.db.prepare("update cook_sessions set ended_at = ? where id = ?").run(this.now(), open.id);
    return true;
  }

  // A mark that repeats the current state records nothing. A repeat would
  // otherwise restart the mess and could move the blame to a later cook.
  mark(code: string, personId: number, state: KitchenState): boolean {
    if (kitchenState(this.history(code).marks) === state) return false;
    this.db
      .prepare("insert into kitchen_marks (house_code, state, marked_by, marked_at) values (?, ?, ?, ?)")
      .run(code, state, personId, this.now());
    return true;
  }

  history(code: string): History {
    const sessions = this.db
      .prepare("select person_id, started_at, ended_at from cook_sessions where house_code = ? order by started_at")
      .all(code) as SessionRow[];
    const marks = this.db
      .prepare("select state, marked_by, marked_at from kitchen_marks where house_code = ? order by marked_at")
      .all(code) as MarkRow[];
    return {
      sessions: sessions.map((r) => ({ personId: r.person_id, startedAt: r.started_at, endedAt: r.ended_at })),
      marks: marks.map((r) => ({ state: r.state as KitchenState, markedBy: r.marked_by, at: r.marked_at })),
    };
  }
}
```

- [ ] **Step 7: Run to verify everything passes, and typecheck**

Run: `pnpm test:unit && pnpm typecheck`
Expected: PASS (`names.test.ts` 3 tests, `rules.test.ts` 9, `store.test.ts` 12). Node prints an `ExperimentalWarning` for `node:sqlite`; that is expected. Typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/names.ts src/store.ts spec/unit/names.test.ts spec/unit/store.test.ts
git commit -m "feat: add SQLite store and name rules with unit checks"
```

---

### Task 3: Pages

**Files:**
- Create: `src/pages.ts`
- Create: `spec/unit/pages.test.ts`

**Interfaces:**
- Consumes: `KitchenState` from `src/rules.ts`; `NAME_MAX` from `src/names.ts`; `Person` type from `src/store.ts`.
- Produces (`src/pages.ts`):
  - `type KitchenView = { code: string; me: Person; cooking: Person[]; state: KitchenState; responsible: Person | null; lastCooked: Person | null; iAmCooking: boolean }`
  - `esc(text: string): string`
  - `layout(title: string, body: string): string`
  - `homePage(message?: string)`, `joinPage(code: string, people: Person[], message?: string)`, `kitchenPage(view: KitchenView)`, `handoffPage(code: string)`, `messagePage(title: string, message: string)`, each returning a full HTML document string.

- [ ] **Step 1: Write the failing tests**

Create `spec/unit/pages.test.ts`:

```ts
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { esc, handoffPage, homePage, joinPage, kitchenPage, layout } from "../../src/pages.ts";
import type { KitchenView } from "../../src/pages.ts";

const dani = { id: 1, name: "Dani" };
const rafi = { id: 2, name: "Rafi" };

const doc = (html: string) => new JSDOM(html).window.document;
const text = (html: string): string => doc(html).body.textContent ?? "";
const buttons = (html: string): string[] =>
  [...doc(html).querySelectorAll("button")].map((b) => b.textContent ?? "");

const view = (over: Partial<KitchenView> = {}): KitchenView => ({
  code: "ABC234",
  me: rafi,
  cooking: [],
  state: "clean",
  responsible: null,
  lastCooked: null,
  iAmCooking: false,
  ...over,
});

describe("esc", () => {
  it("escapes the characters that matter in HTML text and attributes", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("layout", () => {
  it("is a phone-ready page that links to the README", () => {
    const d = doc(layout("Hello", "<p>hi</p>"));
    expect(d.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(d.querySelector('a[href="/readme/"]')).not.toBeNull();
    expect(d.title).toBe("Hello");
  });
});

describe("kitchen page", () => {
  it("shows names as text, never as markup", () => {
    const html = kitchenPage(view({ cooking: [{ id: 3, name: "<img src=x onerror=alert(1)>" }] }));
    expect(doc(html).querySelector("img")).toBeNull();
    expect(text(html)).toContain("<img src=x onerror=alert(1)>");
  });

  it("says who is cooking now, or that nobody is", () => {
    expect(text(kitchenPage(view()))).toContain("Nobody right now.");
    const html = kitchenPage(view({ cooking: [dani, rafi] }));
    expect([...doc(html).querySelectorAll("li .name")].map((n) => n.textContent)).toEqual(["Dani", "Rafi"]);
  });

  it("lets you end someone else's session from the list, but not your own", () => {
    const html = kitchenPage(view({ me: rafi, cooking: [dani, rafi], iAmCooking: true }));
    expect(buttons(html)).toEqual(["End Dani's session", "I'm done", "Mark messy"]);
  });

  it("names the responsible person only while the kitchen is messy", () => {
    const messy = text(kitchenPage(view({ state: "messy", responsible: dani })));
    expect(messy).toContain("The kitchen is messy");
    expect(messy).toContain("Left by Dani.");

    const clean = text(kitchenPage(view({ state: "clean", responsible: dani })));
    expect(clean).toContain("The kitchen is clean");
    expect(clean).not.toContain("Left by");
  });

  it("always shows who cooked last as a plain fact", () => {
    expect(text(kitchenPage(view({ state: "clean", lastCooked: dani })))).toContain("Last cooked: Dani");
    expect(text(kitchenPage(view({ state: "messy", responsible: dani, lastCooked: rafi })))).toContain(
      "Last cooked: Rafi",
    );
    expect(text(kitchenPage(view()))).not.toContain("Last cooked");
  });

  it("offers only the buttons that change something", () => {
    expect(buttons(kitchenPage(view({ iAmCooking: false, state: "clean" })))).toEqual(["I'm cooking", "Mark messy"]);
    expect(buttons(kitchenPage(view({ iAmCooking: true, state: "messy" })))).toEqual(["I'm done", "Mark clean"]);
  });
});

describe("handoff page", () => {
  it("asks whether the kitchen was left clean or messy, and can be skipped", () => {
    const html = handoffPage("ABC234");
    expect(text(html)).toContain("Left the kitchen clean or messy?");
    expect(buttons(html)).toEqual(["Left it clean", "Left it messy"]);
    expect(doc(html).querySelector('a[href="/h/ABC234"]')?.textContent).toBe("Skip");
  });
});

describe("join page", () => {
  it("shows the house code and lets existing names be claimed", () => {
    const html = joinPage("ABC234", [dani, rafi]);
    expect(text(html)).toContain("ABC234");
    expect(buttons(html)).toEqual(["Join", "Dani", "Rafi"]);
  });

  it("escapes names and messages", () => {
    const html = joinPage("ABC234", [{ id: 9, name: "<b>x</b>" }], "<i>careful</i>");
    expect(doc(html).querySelector("b")).toBeNull();
    expect(doc(html).querySelector("i")).toBeNull();
    expect(text(html)).toContain("<b>x</b>");
  });

  it("has no claim list for an empty house", () => {
    expect(buttons(joinPage("ABC234", []))).toEqual(["Join"]);
  });
});

describe("home page", () => {
  it("offers to start or join a house", () => {
    expect(buttons(homePage())).toEqual(["Start a new house", "Join"]);
  });

  it("shows a message when given one", () => {
    expect(text(homePage("No such house"))).toContain("No such house");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit`
Expected: the pages suite FAILS, cannot import `../../src/pages.ts`. Other suites still pass.

- [ ] **Step 3: Implement the pages**

Create `src/pages.ts`:

```ts
import { NAME_MAX } from "./names.ts";
import type { KitchenState } from "./rules.ts";
import type { Person } from "./store.ts";

export type KitchenView = {
  code: string;
  me: Person;
  cooking: Person[];
  state: KitchenState;
  responsible: Person | null;
  lastCooked: Person | null;
  iAmCooking: boolean;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Everything another person typed goes through this before it reaches a page.
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; font: 1rem/1.5 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.15rem; }
  form { margin: 0.5rem 0; }
  button, input { font: inherit; min-height: 2.75rem; }
  button { padding: 0 1rem; }
  input { padding: 0 0.5rem; }
  .quiet { opacity: 0.7; }
  li form { display: inline; margin: 0 0 0 0.5rem; }
`;

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
${body}
      <p class="quiet"><a href="/readme/">About this app</a></p>
    </main>
  </body>
</html>
`;
}

function postForm(action: string, fields: Record<string, string>, label: string): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`)
    .join("");
  return `<form method="post" action="${esc(action)}">${hidden}<button type="submit">${esc(label)}</button></form>`;
}

const alertLine = (message?: string): string => (message ? `<p role="alert">${esc(message)}</p>` : "");

export function homePage(message?: string): string {
  return layout(
    "Kitchen",
    `      <h1>Kitchen</h1>
      <p>See who is cooking in your house, and whether the kitchen was left clean.</p>
      ${alertLine(message)}
      <form method="post" action="/houses">
        <button type="submit">Start a new house</button>
      </form>
      <form method="get" action="/join">
        <label>House code <input name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" /></label>
        <button type="submit">Join</button>
      </form>`,
  );
}

export function joinPage(code: string, people: Person[], message?: string): string {
  const claims =
    people.length === 0
      ? ""
      : `
      <h2>Already here? That's me</h2>
      ${people.map((p) => postForm(`/h/${code}/claim`, { person: String(p.id) }, p.name)).join("\n      ")}`;
  return layout(
    "Join",
    `      <h1>Join house ${esc(code)}</h1>
      <p>Share this code with your housemates: <strong>${esc(code)}</strong></p>
      ${alertLine(message)}
      <form method="post" action="/h/${esc(code)}/join">
        <label>Your name <input name="name" required maxlength="${NAME_MAX}" autocomplete="off" /></label>
        <button type="submit">Join</button>
      </form>${claims}`,
  );
}

export function kitchenPage(view: KitchenView): string {
  const base = `/h/${view.code}`;
  // Anyone can end someone else's session, so a forgotten "I'm done" never
  // leaves a housemate cooking overnight. Your own session ends with "I'm done".
  const endButton = (p: Person): string =>
    p.id === view.me.id ? "" : postForm(`${base}/cook`, { action: "end", person: String(p.id) }, `End ${p.name}'s session`);
  const cooking =
    view.cooking.length === 0
      ? "<p>Nobody right now.</p>"
      : `<ul>${view.cooking.map((p) => `<li><span class="name">${esc(p.name)}</span>${endButton(p)}</li>`).join("")}</ul>`;
  const left =
    view.state === "messy" && view.responsible !== null
      ? `<p>Left by <strong>${esc(view.responsible.name)}</strong>.</p>`
      : "";
  const last = view.lastCooked === null ? "" : `<p class="quiet">Last cooked: ${esc(view.lastCooked.name)}</p>`;
  const cookButton = view.iAmCooking
    ? postForm(`${base}/cook`, { action: "stop" }, "I'm done")
    : postForm(`${base}/cook`, { action: "start" }, "I'm cooking");
  const markButton =
    view.state === "messy"
      ? postForm(`${base}/mark`, { state: "clean" }, "Mark clean")
      : postForm(`${base}/mark`, { state: "messy" }, "Mark messy");
  return layout(
    "Kitchen",
    `      <h1>Kitchen</h1>
      <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong></p>
      <h2>Cooking now</h2>
      ${cooking}
      <h2>The kitchen is ${view.state}</h2>
      ${left}
      ${last}
      ${cookButton}
      ${markButton}`,
  );
}

export function handoffPage(code: string): string {
  const base = `/h/${code}`;
  return layout(
    "Leaving the kitchen",
    `      <h1>Left the kitchen clean or messy?</h1>
      ${postForm(`${base}/mark`, { state: "clean" }, "Left it clean")}
      ${postForm(`${base}/mark`, { state: "messy" }, "Left it messy")}
      <p><a href="${esc(base)}">Skip</a></p>`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `      <h1>${esc(title)}</h1>\n      <p>${esc(message)}</p>\n      <p><a href="/">Home</a></p>`);
}
```

- [ ] **Step 4: Run to verify everything passes, and typecheck**

Run: `pnpm test:unit && pnpm typecheck`
Expected: PASS (`pages.test.ts` 14 tests plus the earlier suites). Typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages.ts spec/unit/pages.test.ts
git commit -m "feat: add server-rendered pages with escaping"
```

---

### Task 4: A running server that serves `/` and `/readme/`

**Files:**
- Create: `src/readme.ts`, `src/app.ts`, `src/main.ts`
- Create: `spec/helpers.ts`, `spec/site.test.ts`
- Modify: `package.json` (add `start` script, add `marked` dependency)

**Interfaces:**
- Consumes: `homePage`, `messagePage`, `layout` from `src/pages.ts`; `Store` from `src/store.ts`.
- Produces:
  - `renderReadmePage(markdown: string): string` (`src/readme.ts`)
  - `createHandler(store: Store): (req: IncomingMessage, res: ServerResponse) => Promise<void>` and `class HttpError extends Error { status: number }` (`src/app.ts`)
  - spec helpers (`spec/helpers.ts`): `baseUrl`, `send(path, options?)`, `cookieOf(res)`, `textOf(html)`, `buttonsOf(html)`, `newHouse()`, `joinAs(code, name)`, `kitchen(code, cookie)`, `post(path, cookie, form)`, `personIdOf(code, name)`.

- [ ] **Step 1: Add the dependency and the start script**

Run: `pnpm add marked`
Expected: `marked` added to `dependencies` in `package.json`, and `pnpm-lock.yaml` updated.

In `package.json`, add this script after `"prepare"`:

```json
    "start": "node --disable-warning=ExperimentalWarning src/main.ts",
```

- [ ] **Step 2: Write the shared helpers and the failing checks**

Create `spec/helpers.ts`:

```ts
import { JSDOM } from "jsdom";
import { inject } from "vitest";

// Helpers for the checks that run against the RUNNING app (spec/global-setup.ts
// finds it). Forms are posted the way a browser would, and redirects are not
// followed, so each check sees exactly what the server answered.
export const baseUrl = inject("baseUrl");

export type Form = Record<string, string>;

export function send(
  path: string,
  options: { method?: string; cookie?: string; form?: Form; body?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  let body = options.body;
  if (options.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }
  return fetch(new URL(path, baseUrl), {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    redirect: "manual",
    headers,
    body,
  });
}

export function post(path: string, cookie: string, form: Form): Promise<Response> {
  return send(path, { cookie, form });
}

export function cookieOf(res: Response): string {
  const cookie = res.headers.getSetCookie()[0];
  if (!cookie) throw new Error("the response set no cookie");
  return cookie.split(";")[0];
}

const parse = (html: string): Document => new JSDOM(html).window.document;
export const textOf = (html: string): string => parse(html).body.textContent ?? "";
export const buttonsOf = (html: string): string[] =>
  [...parse(html).querySelectorAll("button")].map((b) => b.textContent ?? "");
export const cookingListOf = (html: string): string[] =>
  [...parse(html).querySelectorAll("li .name")].map((n) => n.textContent ?? "");

export async function newHouse(): Promise<string> {
  const res = await send("/houses", { method: "POST" });
  const match = res.headers.get("location")?.match(/^\/h\/([23456789A-HJ-NP-Z]{6})\/join$/);
  if (res.status !== 303 || !match) throw new Error(`starting a house gave ${res.status}`);
  return match[1];
}

export async function joinAs(code: string, name: string): Promise<string> {
  const res = await send(`/h/${code}/join`, { form: { name } });
  if (res.status !== 303) throw new Error(`joining as ${JSON.stringify(name)} gave ${res.status}`);
  return cookieOf(res);
}

export async function kitchen(code: string, cookie: string): Promise<string> {
  const res = await send(`/h/${code}`, { cookie });
  if (res.status !== 200) throw new Error(`the kitchen page gave ${res.status}`);
  return res.text();
}

// The id behind a name, read off the join page's "that's me" buttons.
export async function personIdOf(code: string, name: string): Promise<string> {
  const doc = parse(await (await send(`/h/${code}/join`)).text());
  for (const form of doc.querySelectorAll("form")) {
    const id = form.querySelector<HTMLInputElement>('input[name="person"]')?.value;
    if (id !== undefined && form.querySelector("button")?.textContent === name) return id;
  }
  throw new Error(`${name} is not listed on the join page of ${code}`);
}
```

Create `spec/site.test.ts`:

```ts
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buttonsOf, send, textOf } from "./helpers.ts";

describe("the site", () => {
  it("offers to start or join a house at /", async () => {
    const res = await send("/");
    expect(res.status).toBe(200);
    expect(buttonsOf(await res.text())).toEqual(["Start a new house", "Join"]);
  });

  it("says plainly when there is nothing at an address", async () => {
    const res = await send("/nothing-here");
    expect(res.status).toBe(404);
    expect(textOf(await res.text())).toContain("Not found");
  });

  it("answers an address with a stray percent sign with a 404, not a crash", async () => {
    const res = await send("/%");
    expect(res.status).toBe(404);
  });

  it("renders the README as HTML rather than showing its source", async () => {
    const res = await send("/readme/");
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector("article h1, article h2, article h3")).not.toBeNull();
  });

  it("redirects /readme to /readme/", async () => {
    const res = await send("/readme");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/readme/");
  });
});
```

- [ ] **Step 3: Verify the checks fail while there is no server**

Run: `pnpm check`
Expected: FAIL with `nothing is answering at http://localhost:8080: start your app first` after about a minute, because there is no server yet.

- [ ] **Step 4: Implement the README renderer, the handler and the entry point**

Create `src/readme.ts`:

```ts
import { marked } from "marked";
import { layout } from "./pages.ts";

// The README is the author's own file, so its HTML is trusted; it is rendered
// on the server because the shipped check reads /readme/ with no script running.
export function renderReadmePage(markdown: string): string {
  const body = marked.parse(markdown, { async: false });
  return layout("About", `<article>${body}</article>`);
}
```

Create `src/app.ts`:

```ts
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homePage, messagePage } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import type { Store } from "./store.ts";

const README = new URL("../README.md", import.meta.url);

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw ?? "/", "http://localhost");
  } catch {
    throw new HttpError(400, "That address doesn't look right.");
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, cookie === undefined ? { location } : { location, "set-cookie": cookie });
  res.end();
}

function notFound(res: ServerResponse): void {
  sendHtml(res, 404, messagePage("Not found", "There's nothing at this address."));
}

export function createHandler(store: Store) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(store, req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        res.setHeader("connection", "close");
        sendHtml(res, error.status, messagePage("That didn't work", error.message));
        return;
      }
      console.error(error);
      sendHtml(res, 500, messagePage("Something broke", "Something went wrong on our side. Try again in a moment."));
    }
  };
}

async function route(_store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const path = parseUrl(req.url).pathname;

  if (method === "GET" && path === "/") return sendHtml(res, 200, homePage());
  if (method === "GET" && path === "/readme") return redirect(res, "/readme/");
  if (method === "GET" && path === "/readme/") {
    return sendHtml(res, 200, renderReadmePage(readFileSync(README, "utf8")));
  }
  return notFound(res);
}
```

Create `src/main.ts`:

```ts
import { createServer } from "node:http";
import { join } from "node:path";
import { createHandler } from "./app.ts";
import { Store } from "./store.ts";

// Fly sets PORT; the volume is mounted at /data (the Dockerfile sets DATA_DIR).
const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR ?? "data";

const store = new Store(join(dataDir, "kitchen.db"));
const server = createServer(createHandler(store));
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port}, data in ${dataDir}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
```

- [ ] **Step 5: Start the app, run the checks, verify they pass**

In a second terminal: `DATA_DIR=/tmp/kitchen-dev pnpm start`
Expected output there: `listening on 0.0.0.0:8080, data in /tmp/kitchen-dev`

Run: `pnpm check`
Expected: PASS: typecheck clean; the two shipped checks in `invariants.test.ts` pass (`/` answers, `/readme/` publishes README.md); `site.test.ts` 5 tests pass; unit suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/readme.ts src/app.ts src/main.ts spec/helpers.ts spec/site.test.ts package.json pnpm-lock.yaml
git commit -m "feat: serve the home page and the README from a running server"
```

---

### Task 5: Houses and joining

**Files:**
- Modify: `src/app.ts` (replace the whole file with the version below)
- Create: `spec/houses.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4. `Store.createHouse`, `houseExists`, `join`, `claim`, `personByToken`, `people`, `history`; `kitchenPage`, `joinPage`, `homePage`, `messagePage`; the spec helpers.
- Produces (routes): `POST /houses`, `GET /join?code=`, `GET /h/:code/join`, `POST /h/:code/join` (field `name`), `POST /h/:code/claim` (field `person`), `GET /h/:code` (the kitchen page). Identity is the cookie `person_<CODE>`; without a valid one, `/h/:code` redirects to `/h/:code/join`.

- [ ] **Step 1: Write the failing checks**

Create `spec/houses.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buttonsOf, cookieOf, joinAs, kitchen, newHouse, personIdOf, post, send, textOf } from "./helpers.ts";

describe("starting and finding a house", () => {
  it("starts a house and sends you to pick a name", async () => {
    const res = await send("/houses", { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/h\/[23456789A-HJ-NP-Z]{6}\/join$/);
  });

  it("shows the house code on its join page", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}/join`);
    expect(res.status).toBe(200);
    expect(textOf(await res.text())).toContain(code);
  });

  it("says so for a house that does not exist", async () => {
    const res = await send("/h/ZZZZZZ/join");
    expect(res.status).toBe(404);
    expect(textOf(await res.text())).toContain("no house with that code");
  });

  it("treats a malformed code in the path as no house, not an error", async () => {
    for (const bad of ["x", "ABC", "<script>", "%00", "abcdef"]) {
      const res = await send(`/h/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(404);
    }
  });

  it("finds a house from a code typed in lower case with spaces around it", async () => {
    const code = await newHouse();
    const res = await send(`/join?code=${encodeURIComponent(` ${code.toLowerCase()} `)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("does not accept an unknown code at /join", async () => {
    const res = await send("/join?code=nope");
    expect(res.status).toBe(404);
    expect(textOf(await res.text())).toContain("no house with that code");
  });
});

describe("being someone in a house", () => {
  it("sends a visitor with no cookie to the join page", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("lets you join with a name and see the kitchen as that person", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    expect(textOf(await kitchen(code, cookie))).toContain("you are Dani");
  });

  it("remembers you on a later visit with the same cookie", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    await kitchen(code, cookie);
    expect(textOf(await kitchen(code, cookie))).toContain("you are Dani");
  });

  it("tells a second person their name is taken, whatever its case", async () => {
    const code = await newHouse();
    await joinAs(code, "Dani");
    const res = await send(`/h/${code}/join`, { form: { name: "dani" } });
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(textOf(html)).toContain("That name is taken");
    expect(buttonsOf(html)).toContain("Dani");
  });

  it("lets someone claim an existing name from a new device", async () => {
    const code = await newHouse();
    await joinAs(code, "Dani");
    const claim = await send(`/h/${code}/claim`, { form: { person: await personIdOf(code, "Dani") } });
    expect(claim.status).toBe(303);
    expect(textOf(await kitchen(code, cookieOf(claim)))).toContain("you are Dani");
  });

  it("rejects a claim for a person who is not in this house", async () => {
    const a = await newHouse();
    const b = await newHouse();
    await joinAs(a, "Dani");
    const id = await personIdOf(a, "Dani");
    for (const person of [id, "9999999", "abc", ""]) {
      const res = await send(`/h/${b}/claim`, { form: { person } });
      expect(res.status, JSON.stringify(person)).toBe(400);
    }
  });

  it("rejects bad names with a clear message", async () => {
    const code = await newHouse();
    for (const name of ["", "   ", "x".repeat(25), "bad\u0007name"]) {
      const res = await send(`/h/${code}/join`, { form: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(textOf(await res.text())).toContain("Pick a name");
    }
  });

  it("answers a join with no name field at all with a 400", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}/join`, { form: {} });
    expect(res.status).toBe(400);
  });

  it("keeps a cookie to its own house", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookie = await joinAs(a, "Dani");
    const forged = cookie.replace(`person_${a}`, `person_${b}`);
    const res = await send(`/h/${b}`, { cookie: forged });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${b}/join`);
  });

  it("treats a garbage cookie as no cookie", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}`, { cookie: `person_${code}=nonsense` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("shows a name containing markup as text, on the join and kitchen pages", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, `<b>x</b> Da"ni'`);
    const kitchenHtml = await kitchen(code, cookie);
    expect(kitchenHtml).not.toContain("<b>x</b>");
    expect(textOf(kitchenHtml)).toContain(`<b>x</b> Da"ni'`);
    const joinHtml = await (await send(`/h/${code}/join`)).text();
    expect(joinHtml).not.toContain("<b>x</b>");
    expect(buttonsOf(joinHtml)).toContain(`<b>x</b> Da"ni'`);
  });

  it("does not let a person from one house act in another", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookie = await joinAs(a, "Dani");
    const res = await post(`/h/${b}/cook`, cookie, { action: "start" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${b}/join`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

With the app from Task 4 still running, run: `pnpm test spec/houses.test.ts`
Expected: FAIL: routes return 404 (the app has no house routes yet).

- [ ] **Step 3: Replace `src/app.ts` with the house routes**

Replace the whole of `src/app.ts` with:

```ts
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NAME_MAX } from "./names.ts";
import { homePage, joinPage, kitchenPage, messagePage } from "./pages.ts";
import type { KitchenView } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import { cookingNow, kitchenState, lastCooked, responsible } from "./rules.ts";
import type { Person, Store } from "./store.ts";

const README = new URL("../README.md", import.meta.url);
const CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;
const MAX_BODY = 4096;
const NO_SUCH_HOUSE = "There's no house with that code. Check it and try again.";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw ?? "/", "http://localhost");
  } catch {
    throw new HttpError(400, "That address doesn't look right.");
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, cookie === undefined ? { location } : { location, "set-cookie": cookie });
  res.end();
}

function notFound(res: ServerResponse): void {
  sendHtml(res, 404, messagePage("Not found", "There's nothing at this address."));
}

// Form bodies here are a few short fields, so anything bigger is refused. The
// rest of an oversized body is read and thrown away before refusing: leaving
// the loop early would destroy the socket and the 413 would never be sent.
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_BODY) chunks.push(chunk as Buffer);
  }
  if (size > MAX_BODY) throw new HttpError(413, "That request is too large.");
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function cookieName(code: string): string {
  return `person_${code}`;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function cookieFor(req: IncomingMessage, code: string, token: string): string {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${cookieName(code)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function viewFor(store: Store, code: string, me: Person): KitchenView {
  const history = store.history(code);
  const people = new Map<number, Person>(store.people(code).map((p) => [p.id, p] as const));
  const named = (id: number | null): Person | null => (id === null ? null : (people.get(id) ?? null));
  const cooking = cookingNow(history.sessions);
  return {
    code,
    me,
    cooking: cooking.map((id) => people.get(id)).filter((p): p is Person => p !== undefined),
    state: kitchenState(history.marks),
    responsible: named(responsible(history.sessions, history.marks)),
    lastCooked: named(lastCooked(history.sessions)),
    iAmCooking: cooking.includes(me.id),
  };
}

export function createHandler(store: Store) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(store, req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        res.setHeader("connection", "close");
        sendHtml(res, error.status, messagePage("That didn't work", error.message));
        return;
      }
      console.error(error);
      sendHtml(res, 500, messagePage("Something broke", "Something went wrong on our side. Try again in a moment."));
    }
  };
}

async function route(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = parseUrl(req.url);
  const path = url.pathname;

  if (method === "GET" && path === "/") return sendHtml(res, 200, homePage());
  if (method === "GET" && path === "/readme") return redirect(res, "/readme/");
  if (method === "GET" && path === "/readme/") {
    return sendHtml(res, 200, renderReadmePage(readFileSync(README, "utf8")));
  }
  if (method === "POST" && path === "/houses") return redirect(res, `/h/${store.createHouse()}/join`);
  if (method === "GET" && path === "/join") {
    const code = (url.searchParams.get("code") ?? "").replace(/\s+/g, "").toUpperCase();
    if (CODE_RE.test(code) && store.houseExists(code)) return redirect(res, `/h/${code}/join`);
    return sendHtml(res, 404, homePage(NO_SUCH_HOUSE));
  }

  const match = path.match(/^\/h\/([^/]+)(?:\/([a-z]+))?\/?$/);
  if (match === null) return notFound(res);
  const [, code, action = ""] = match;
  if (!CODE_RE.test(code) || !store.houseExists(code)) {
    return sendHtml(res, 404, messagePage("No such house", NO_SUCH_HOUSE));
  }
  return house(store, req, res, code, method, action);
}

async function house(
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
  method: string,
  action: string,
): Promise<void> {
  if (method === "GET" && action === "join") {
    return sendHtml(res, 200, joinPage(code, store.people(code)));
  }
  if (method === "POST" && action === "join") {
    const outcome = store.join(code, (await readForm(req)).get("name") ?? "");
    if (outcome.ok) return redirect(res, `/h/${code}`, cookieFor(req, code, outcome.token));
    if (outcome.reason === "invalid_name") {
      const message = `Pick a name of 1 to ${NAME_MAX} characters, without control characters.`;
      return sendHtml(res, 400, joinPage(code, store.people(code), message));
    }
    const taken = "That name is taken. If it's you, tap it below, or pick another.";
    return sendHtml(res, 409, joinPage(code, store.people(code), taken));
  }
  if (method === "POST" && action === "claim") {
    const id = Number((await readForm(req)).get("person"));
    const claimed = Number.isInteger(id) ? store.claim(code, id) : null;
    if (claimed === null) throw new HttpError(400, "That name isn't in this house.");
    return redirect(res, `/h/${code}`, cookieFor(req, code, claimed.token));
  }

  // Everything below needs to know who is acting.
  const me = store.personByToken(code, readCookie(req, cookieName(code)) ?? "");
  if (me === null) return redirect(res, `/h/${code}/join`);

  if (method === "GET" && action === "") {
    return sendHtml(res, 200, kitchenPage(viewFor(store, code, me)));
  }
  return notFound(res);
}
```

- [ ] **Step 4: Restart the app and run the checks**

Stop the app (Ctrl-C) and start it again: `DATA_DIR=/tmp/kitchen-dev pnpm start`

Run: `pnpm check`
Expected: PASS: typecheck clean; `houses.test.ts` 18 tests pass; `site.test.ts`, the shipped `invariants.test.ts` and all unit suites still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts spec/houses.test.ts
git commit -m "feat: start and join a house with a name, remembered by cookie"
```

---

### Task 6: Cooking, the handoff, and marking the kitchen

**Files:**
- Modify: `src/app.ts` (two edits)
- Create: `spec/kitchen.test.ts`

**Interfaces:**
- Consumes: Task 5's `house()` after the identity check, and `Store.startCooking`, `stopCooking`, `mark`; `handoffPage`.
- Produces (routes): `POST /h/:code/cook` (field `action` = `start` | `stop` | `end`; `stop` ends your own session and redirects to the handoff page; `end` takes a `person` field, ends that housemate's session, and redirects to the kitchen with no handoff prompt), `GET /h/:code/handoff`, `POST /h/:code/mark` (field `state` = `clean` | `messy`).
- `Store.stopCooking(code, personId)` already works for any person: it only ends an open session of that person in that house, so an id from another house ends nothing.

- [ ] **Step 1: Write the failing checks**

Create `spec/kitchen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buttonsOf, cookingListOf, joinAs, kitchen, newHouse, personIdOf, post, send, textOf } from "./helpers.ts";

async function house(...names: string[]) {
  const code = await newHouse();
  const cookies: Record<string, string> = {};
  for (const name of names) cookies[name] = await joinAs(code, name);
  return { code, cookies };
}

const cook = (code: string, cookie: string, action: string) => post(`/h/${code}/cook`, cookie, { action });
const mark = (code: string, cookie: string, state: string) => post(`/h/${code}/mark`, cookie, { state });

describe("cooking", () => {
  it("shows everyone in the house who is cooking, several at once", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    expect((await cook(code, cookies.Dani, "start")).status).toBe(303);
    expect(cookingListOf(await kitchen(code, cookies.Rafi))).toEqual(["Dani"]);

    await cook(code, cookies.Rafi, "start");
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual(["Dani", "Rafi"]);
    expect(buttonsOf(await kitchen(code, cookies.Dani))).toContain("I'm done");
  });

  it("does not list someone twice when they press start twice", async () => {
    const { code, cookies } = await house("Dani");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "start");
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual(["Dani"]);
  });

  it("asks clean or messy the moment you are done", async () => {
    const { code, cookies } = await house("Dani");
    await cook(code, cookies.Dani, "start");
    const done = await cook(code, cookies.Dani, "stop");
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/h/${code}/handoff`);

    const handoff = await send(`/h/${code}/handoff`, { cookie: cookies.Dani });
    expect(handoff.status).toBe(200);
    expect(buttonsOf(await handoff.text())).toEqual(["Left it clean", "Left it messy"]);
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual([]);
  });

  it("lets anyone in the house end a session someone forgot, without moving the blame", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    expect(buttonsOf(await kitchen(code, cookies.Rafi))).toContain("End Dani's session");

    const ended = await post(`/h/${code}/cook`, cookies.Rafi, { action: "end", person: await personIdOf(code, "Dani") });
    expect(ended.status).toBe(303);
    expect(ended.headers.get("location")).toBe(`/h/${code}`); // no handoff prompt for someone who didn't cook
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual([]);

    await mark(code, cookies.Rafi, "messy");
    expect(textOf(await kitchen(code, cookies.Rafi))).toContain("Left by Dani.");
  });

  it("answers an end with no usable person with a 400", async () => {
    const { code, cookies } = await house("Dani");
    expect((await post(`/h/${code}/cook`, cookies.Dani, { action: "end", person: "abc" })).status).toBe(400);
    expect((await post(`/h/${code}/cook`, cookies.Dani, { action: "end" })).status).toBe(400);
  });
});

describe("the handoff", () => {
  it("names the last cook while the kitchen is messy", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is messy");
    expect(text).toContain("Left by Dani.");
  });

  it("names nobody once it is clean, but still shows who cooked last", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await mark(code, cookies.Rafi, "clean"); // anyone in the house can say so

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is clean");
    expect(text).not.toContain("Left by");
    expect(text).toContain("Last cooked: Dani");
  });

  it("does not blame someone who starts cooking in an already messy kitchen", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await cook(code, cookies.Rafi, "start");

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("Left by Dani.");
    expect(text).not.toContain("Left by Rafi");
    expect(text).toContain("Last cooked: Rafi");
  });

  it("keeps the blame where it was when someone marks messy again", async () => {
    const { code, cookies } = await house("Dani", "Rafi", "Sam");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await cook(code, cookies.Rafi, "start");
    await mark(code, cookies.Sam, "messy"); // a repeat of what is already true

    expect(textOf(await kitchen(code, cookies.Sam))).toContain("Left by Dani.");
  });

  it("is messy with nobody to name when nobody has cooked", async () => {
    const { code, cookies } = await house("Rafi");
    await mark(code, cookies.Rafi, "messy");
    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is messy");
    expect(text).not.toContain("Left by");
  });

  it("offers only the mark button that changes something", async () => {
    const { code, cookies } = await house("Rafi");
    expect(buttonsOf(await kitchen(code, cookies.Rafi))).toContain("Mark messy");
    await mark(code, cookies.Rafi, "messy");
    const buttons = buttonsOf(await kitchen(code, cookies.Rafi));
    expect(buttons).toContain("Mark clean");
    expect(buttons).not.toContain("Mark messy");
  });
});

describe("what people type", () => {
  it("shows a cook's name as text, never as markup", async () => {
    const { code, cookies } = await house(`<b>x</b>`);
    await cook(code, cookies[`<b>x</b>`], "start");
    const html = await kitchen(code, cookies[`<b>x</b>`]);
    expect(html).not.toContain("<b>x</b>");
    expect(cookingListOf(html)).toEqual([`<b>x</b>`]);
  });
});

describe("bad input", () => {
  it("answers an unknown cook action, mark state or missing field with a 400", async () => {
    const { code, cookies } = await house("Dani");
    expect((await cook(code, cookies.Dani, "bogus")).status).toBe(400);
    expect((await mark(code, cookies.Dani, "bogus")).status).toBe(400);
    expect((await post(`/h/${code}/cook`, cookies.Dani, {})).status).toBe(400);
    expect((await post(`/h/${code}/mark`, cookies.Dani, {})).status).toBe(400);
    expect(textOf(await kitchen(code, cookies.Dani))).toContain("The kitchen is clean");
  });

  it("does nothing, and does not crash, for someone with no cookie", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/mark`, { form: { state: "messy" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
    expect(textOf(await kitchen(code, cookies.Dani))).toContain("The kitchen is clean");
  });

  it("refuses an oversized body with a 413 instead of hanging", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/join`, {
      cookie: cookies.Dani,
      body: `name=${"x".repeat(10_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("answers an unknown page inside a house with a 404", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/nonsense`, { cookie: cookies.Dani });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

With the app from Task 5 still running, run: `pnpm test spec/kitchen.test.ts`
Expected: FAIL: the cook, mark and handoff routes return 404.

- [ ] **Step 3: Add the routes to `src/app.ts`**

Edit 1, the import from `./pages.ts`. Replace:

```ts
import { homePage, joinPage, kitchenPage, messagePage } from "./pages.ts";
```

with:

```ts
import { handoffPage, homePage, joinPage, kitchenPage, messagePage } from "./pages.ts";
```

Edit 2, in `house()`. Replace:

```ts
  if (method === "GET" && action === "") {
    return sendHtml(res, 200, kitchenPage(viewFor(store, code, me)));
  }
```

with:

```ts
  if (method === "GET" && action === "") {
    return sendHtml(res, 200, kitchenPage(viewFor(store, code, me)));
  }
  if (method === "GET" && action === "handoff") {
    return sendHtml(res, 200, handoffPage(code));
  }
  if (method === "POST" && action === "cook") {
    const form = await readForm(req);
    const choice = form.get("action");
    if (choice === "start") {
      store.startCooking(code, me.id);
      return redirect(res, `/h/${code}`);
    }
    if (choice === "stop") {
      store.stopCooking(code, me.id);
      return redirect(res, `/h/${code}/handoff`);
    }
    if (choice === "end") {
      // Anyone in the house can end a session someone forgot. Only that
      // person's open session in this house can end, so a stray id ends nothing.
      const id = Number(form.get("person") ?? "");
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "That person isn't in this house.");
      store.stopCooking(code, id);
      return redirect(res, `/h/${code}`);
    }
    throw new HttpError(400, "Choose start, stop or end.");
  }
  if (method === "POST" && action === "mark") {
    const state = (await readForm(req)).get("state");
    if (state !== "clean" && state !== "messy") throw new HttpError(400, "Choose clean or messy.");
    store.mark(code, me.id, state);
    return redirect(res, `/h/${code}`);
  }
```

- [ ] **Step 4: Restart the app and run the whole check**

Stop the app (Ctrl-C) and start it again: `DATA_DIR=/tmp/kitchen-dev pnpm start`

Run: `pnpm check`
Expected: PASS: typecheck clean; `kitchen.test.ts` 16 tests pass; everything from Tasks 1 to 5 and the two shipped checks still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts spec/kitchen.test.ts
git commit -m "feat: cook, hand off and mark the kitchen clean or messy"
```

---

### Task 7: The image and the deploy path

**Files:**
- Modify: `Dockerfile` (replace the busybox placeholder), `.dockerignore`
- Delete: `placeholder/` (its job is done once the real app serves `/` and `/readme/`)

**Interfaces:**
- Consumes: the whole app. The image runs `node src/main.ts`, serving on `0.0.0.0:$PORT`, with data in `/data` (`DATA_DIR=/data`).
- Produces: an image CI can build, start with a throwaway `/data`, and run `pnpm check` against, which then deploys.

Docker Desktop is not running on this machine right now. Start it first (`open -a Docker`) and wait until `docker info` prints a server version.

- [ ] **Step 1: Replace the Dockerfile**

Replace the whole of `Dockerfile` with:

```dockerfile
# syntax = docker/dockerfile:1

# The kitchen app. Whatever it is built with, the image must serve HTTP on
# 0.0.0.0:$PORT (fly.toml sets PORT) and publish README.md at /readme/
# (spec/README.md says what's checked). Node runs the .ts files directly, so
# there is no build step; SQLite is node's own, so nothing native to compile.

FROM docker.io/library/node:24.21.0-alpine
WORKDIR /app

# Only production dependencies go in the image: marked, for the README page.
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src/ src/
COPY README.md ./

# /data is the Fly volume: the only storage that survives a restart or redeploy.
ENV DATA_DIR=/data
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
```

Append to `.dockerignore`:

```
data
```

- [ ] **Step 2: Build the image and run the spec against it, the way CI does**

Stop the local dev server if it is still running. Then:

```bash
docker build -t app .
docker run -d --init --name app -p 8080:8080 -e PORT=8080 --tmpfs /data app
pnpm check
```

Expected: the build succeeds; `pnpm check` passes against the container: typecheck clean, and every suite (shipped invariants, `site`, `houses`, `kitchen`, unit) green.

If anything fails, run `docker logs app` to see what the container printed.

- [ ] **Step 3: Check that data survives a restart, on a real volume**

```bash
docker rm -f app
docker run -d --init --name app -p 8080:8080 -e PORT=8080 -v kitchen-data:/data app
curl -si -X POST http://localhost:8080/houses | grep -i '^location'
```

Expected: a line like `location: /h/K7M2QX/join`. Use that code below.

```bash
docker restart app
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/h/K7M2QX/join
```

Expected: `200`: the house is still there after the restart.

Clean up:

```bash
docker rm -f app
docker volume rm kitchen-data
```

- [ ] **Step 4: Remove the placeholder**

```bash
git rm -r placeholder
```

Run: `docker build -t app .`
Expected: still builds (nothing in the new Dockerfile uses `placeholder/`).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: build the kitchen app into the deploy image"
```

---

## Self-review against the spec

- **Section 1 (purpose):** covered by the whole plan; no code task needed.
- **Section 2 (positions):** blame only while messy: rules (Task 1), page (Task 3), HTTP (Task 6). Anyone can mark: Task 6 ("anyone in the house can say so"). Anyone can end someone's session: page button (Task 3), `end` route and check (Task 6). No nagging, points, rotas: nothing built. Trust among housemates, no password: Tasks 2 and 5 (name plus cookie, `claim`).
- **Section 3 (scope):** the Crit 8 slice is Tasks 1 to 7. Live updates, logging, talangin and the burner tag are deliberately absent.
- **Section 4 (architecture):** server, store, rules, pages are `app.ts`, `store.ts`, `rules.ts`, `pages.ts`. SQLite on `/data` and the 256 MB limit: Task 7 (`DATA_DIR=/data`, Alpine image, no build tooling). README rendered on the server: Task 4. SSE is the Crit 9 plan.
- **Section 5 (data and rules):** four stored things and the derived rules: Tasks 1 and 2. The responsibility rule is "the most recent session that started before the mess began", exactly as the spec now words it; a repeated messy mark is not recorded (Task 2) and would not move the blame even if one slipped in (Task 1).
- **Section 6 (screens and requests):** join, kitchen, `/readme/`; the seven requests are `POST /houses`, join, cook start, cook stop, cook end (someone else's), mark, and the kitchen page's state; the handoff prompt on "I'm done" with a skip link, and no prompt when ending someone else's session: Tasks 3, 5, 6.
- **Section 7 (edge cases):** unknown code, name taken with "that's me", idempotent actions (including ending an already ended session), simultaneous actions (SQLite serialises writes and the second is a no-op), escaped and length-limited names, restart safety: Tasks 2, 5, 6, 7.
- **Section 8 (checks):** every listed check exists. Returning with the same cookie: `houses.test.ts` ("remembers you on a later visit"). Surviving a restart: checked by hand against the image with a real volume in Task 7, Step 3; surviving a redeploy stays a judged promise for the README. The Crit 9 stream check belongs to the next plan.
- **Placeholder scan:** none. **Type consistency:** `Person`, `KitchenView`, `Session`, `Mark`, `JoinOutcome` and every `Store` method name match between the tasks that define and use them.

## Not in this plan (yours, and due for Crit 8)

These are the author's own work. Nothing here drafts them for you.

- A first draft of `README.md` with your definition of good and the sources you consulted. It is served at `/readme/` as soon as the app runs.
- `PROCESS.md`, `CLAUDE.md`, and `reflections/crit-8.md`.
- Deploying (`flyctl deploy --remote-only --ha=false -a <repo-name>` while the repo is private) and flipping the repo public with `/ship` at the cutoff.
- The Crit 8 cutoff time, which is not on the course page.

## Decided after review

A forgotten "I'm done" no longer leaves someone cooking indefinitely: anyone in the house can end another person's session from the kitchen page (spec section 2). Ending someone else's session does not ask "clean or messy?", and does not move responsibility.
