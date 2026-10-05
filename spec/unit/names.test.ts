import { describe, expect, it } from "vitest";
import { NAME_MAX, nameKey, normaliseName } from "../../src/names.ts";

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

  it("rejects a name made only of invisible characters", () => {
    expect(normaliseName("\u200b")).toBeNull();
    expect(normaliseName(" \u200b\u00ad ")).toBeNull();
  });

  it("rejects bidirectional override and isolate controls", () => {
    expect(normaliseName("a\u202eb")).toBeNull();
    expect(normaliseName("a\u2066b")).toBeNull();
  });

  it("gives composed and decomposed accents the same name", () => {
    expect(normaliseName("Am\u00e9")).toBe(normaliseName("Ame\u0301"));
  });

  it("accepts an emoji sequence joined with a zero-width joiner", () => {
    expect(normaliseName("\u{1F469}\u200d\u{1F373}")).toBe("\u{1F469}\u200d\u{1F373}");
  });
});

describe("nameKey", () => {
  it("ignores case and invisible characters", () => {
    expect(nameKey("Dani\u00ad")).toBe(nameKey("dani"));
  });
});
