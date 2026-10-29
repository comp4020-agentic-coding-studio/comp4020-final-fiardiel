import { describe, expect, it } from "vitest";
import { baseUrl, historyOf, housePage, send, setUpHouse } from "./helpers.ts";

// The app under check runs without RECEIPT_HOUSES (CI never has it), so every
// house here is one that isn't on the list: reading a receipt costs money, so
// these houses must never see it or reach it.
describe("reading receipts in a house that isn't on the list", () => {
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
