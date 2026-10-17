import { describe, expect, it } from "vitest";
import { logLine } from "../../src/log.ts";

describe("logLine", () => {
  it("says which house, who, and what, on one line", () => {
    const line = logLine("K7P2QX", { id: 3, name: "Dani" }, "add_bill", { bill: 12, cents: 4500 });
    expect(line).toBe('house=K7P2QX person="Dani"#3 action=add_bill bill=12 cents=4500');
  });

  it("can't be broken onto a second line or faked by a name", () => {
    const line = logLine("K7P2QX", { id: 1, name: 'Ana" person="Bo' }, "join", { note: "a\nb" });
    expect(line).not.toContain("\n");
    expect(line).toBe('house=K7P2QX person="Ana\\" person=\\"Bo"#1 action=join note="a\\nb"');
  });

  it("logs someone not yet in the house", () => {
    expect(logLine("K7P2QX", null, "create_house")).toBe("house=K7P2QX person=- action=create_house");
  });

  it("names the device that acted on someone else's name", () => {
    const line = logLine("K7P2QX", { id: 1, name: "Ana" }, "reset_pin", {}, { id: 2, name: "Bo" });
    expect(line).toBe('house=K7P2QX person="Ana"#1 action=reset_pin by="Bo"#2');
    expect(logLine("K7P2QX", { id: 1, name: "Ana" }, "sign_in", {}, null)).toBe('house=K7P2QX person="Ana"#1 action=sign_in by=-');
  });
});
