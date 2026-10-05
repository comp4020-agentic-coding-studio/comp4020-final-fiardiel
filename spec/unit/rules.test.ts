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
