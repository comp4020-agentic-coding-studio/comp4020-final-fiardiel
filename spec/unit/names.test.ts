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
