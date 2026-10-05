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

  it("answers HEAD requests like GET", async () => {
    expect((await send("/", { method: "HEAD" })).status).toBe(200);
    expect((await send("/readme/", { method: "HEAD" })).status).toBe(200);
  });

  it("redirects /readme to /readme/", async () => {
    const res = await send("/readme");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/readme/");
  });
});
