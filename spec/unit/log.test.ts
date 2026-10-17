import { describe, expect, it } from "vitest";
import { logLine } from "../../src/log.ts";

describe("logLine", () => {
  it("says which house, who, and what, on one line", () => {
    const line = logLine("h12", { id: 3, name: "Dani" }, "add_bill", { bill: 12, cents: 4500 });
    expect(line).toBe('house=h12 person="Dani"#3 action=add_bill bill=12 cents=4500');
  });

  it("can't be broken onto a second line or faked by a name", () => {
    const line = logLine("h12", { id: 1, name: 'Ana" person="Bo' }, "join", { note: "a\nb" });
    expect(line).not.toContain("\n");
    expect(line).toBe('house=h12 person="Ana\\" person=\\"Bo"#1 action=join note="a\\nb"');
  });

  it("logs someone not yet in the house", () => {
    expect(logLine("h12", null, "create_house")).toBe("house=h12 person=- action=create_house");
  });

  it("names the device that acted on someone else's name", () => {
    const line = logLine("h12", { id: 1, name: "Ana" }, "reset_pin", {}, { id: 2, name: "Bo" });
    expect(line).toBe('house=h12 person="Ana"#1 action=reset_pin by="Bo"#2');
    expect(logLine("h12", { id: 1, name: "Ana" }, "sign_in", {}, null)).toBe('house=h12 person="Ana"#1 action=sign_in by=-');
  });
});
