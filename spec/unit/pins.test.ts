import { describe, expect, it } from "vitest";
import { hashPin, isPin, pinMatches } from "../../src/pins.ts";

describe("pins", () => {
  it("accepts exactly four ASCII digits", () => {
    expect(isPin("0427")).toBe(true);
    for (const raw of ["", "123", "12345", " 1234", "1234 ", "12a4", "١٢٣٤", "１２３４"]) expect(isPin(raw), raw).toBe(false);
  });

  it("stores a PIN only as a salted hash", () => {
    const a = hashPin("0427");
    expect(a).not.toContain("0427");
    expect(hashPin("0427")).not.toBe(a);
    expect(pinMatches("0427", a)).toBe(true);
    expect(pinMatches("0428", a)).toBe(false);
  });

  it("never matches a malformed stored value", () => {
    expect(pinMatches("0427", "")).toBe(false);
    expect(pinMatches("0427", "abc:def")).toBe(false);
  });
});
