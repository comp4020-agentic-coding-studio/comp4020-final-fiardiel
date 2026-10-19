import { describe, expect, it } from "vitest";
import { logLine } from "../../src/log.ts";

const rafi = { id: 6, name: "Rafi" };
const bo = { id: 2, name: "Bo" };

describe("logLine", () => {
  it("reads as one plain sentence: which house, who, and what", () => {
    expect(logLine("h3", rafi, "add_bill", { bill: 3, cents: 2000 })).toBe('[h3] "Rafi" (#6) added bill #3 for $20.00');
    expect(logLine("h3", rafi, "join")).toBe('[h3] "Rafi" (#6) joined');
    expect(logLine("h3", null, "create_house")).toBe("[h3] a new house was started");
    expect(logLine("h3", rafi, "pay", { payment: 4, to: "Bo", cents: 1550 })).toBe('[h3] "Rafi" (#6) paid "Bo" $15.50 (payment #4)');
  });

  it("counts open pages in words", () => {
    expect(logLine("h3", null, "broadcast", { clients: 1 })).toBe("[h3] told 1 open page to refresh");
    expect(logLine("h3", null, "broadcast", { clients: 0 })).toBe("[h3] told 0 open pages to refresh");
    expect(logLine("h3", rafi, "connect", { clients: 2 })).toBe('[h3] "Rafi" (#6) opened the house page (2 pages open)');
    expect(logLine("h3", rafi, "disconnect", { clients: 1 })).toBe('[h3] "Rafi" (#6) left the house page (1 page still open)');
  });

  it("starts every refusal with REFUSED", () => {
    expect(logLine("h4", rafi, "rejected", { status: 404, reason: "That bill isn't here any more." })).toBe(
      '[h4] REFUSED "Rafi" (#6): That bill isn\'t here any more. (404)',
    );
    expect(logLine("-", null, "rejected", { status: 404, reason: "no house with that code" })).toBe(
      "[-] REFUSED someone not signed in: no house with that code (404)",
    );
    expect(logLine("h3", rafi, "delete_refused", { bill: 3 })).toBe('[h3] REFUSED "Rafi" (#6): can\'t delete bill #3, someone else paid it');
  });

  it("names the browser that acted on someone else's name", () => {
    expect(logLine("h1", { id: 1, name: "Ana" }, "reset_pin", {}, bo)).toBe('[h1] "Ana" (#1) had their PIN reset, from "Bo" (#2)\'s browser');
    expect(logLine("h1", { id: 1, name: "Ana" }, "sign_in", {}, null)).toBe('[h1] "Ana" (#1) signed in with their PIN, from a new browser');
  });

  it("can't be broken onto a second line or faked by a name", () => {
    const line = logLine("h3", { id: 1, name: 'Ana" (#2) joined\n[h9] x' }, "join");
    expect(line).not.toContain("\n");
    expect(line).toBe('[h3] "Ana\\" (#2) joined\\n[h9] x" (#1) joined');
  });
});
