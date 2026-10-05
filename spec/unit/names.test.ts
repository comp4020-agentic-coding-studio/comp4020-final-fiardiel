import { readFileSync } from "node:fs";
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

  it("refuses all nine bidirectional controls, written as escapes in the source", () => {
    const controls = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const point of controls) {
      expect(normaliseName(`a${String.fromCodePoint(point)}b`), point.toString(16)).toBeNull();
    }
    // A maintainer must be able to read the pattern, so no raw control may sit in the file.
    const source = readFileSync(new URL("../../src/names.ts", import.meta.url), "utf8");
    expect(/[\u202a-\u202e\u2066-\u2069]/u.test(source)).toBe(false);
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
