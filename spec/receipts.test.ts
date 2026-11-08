import { describe, expect, it } from "vitest";
import { baseUrl, historyOf, housePage, send, setUpHouse } from "./helpers.ts";

// The app under check runs without an Anthropic API key (CI never has one), so
// reading receipts is off: no house may see it or reach it.
describe("reading receipts when the server has no API key", () => {
  it("shows no receipt upload on the bill page", async () => {
    const { code, cookies } = await setUpHouse("Rafi", "Dina");
    const html = await (await send(`/h/${code}/bill`, { cookie: cookies.Rafi })).text();
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain(`/h/${code}/receipt`);
  });

  it("refuses a receipt posted anyway, and adds nothing", async () => {
    const { code, cookies } = await setUpHouse("Rafi", "Dina");
    const form = new FormData();
    form.append("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "r.jpg");
    const res = await fetch(new URL(`/h/${code}/receipt`, baseUrl), {
      method: "POST",
      headers: { cookie: cookies.Rafi },
      body: form,
      redirect: "manual",
    });
    expect(res.status).toBe(404);
    expect(historyOf(await housePage(code, cookies.Rafi))).toEqual([]);
  });
});
