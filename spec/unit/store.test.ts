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
