import { describe, expect, it } from "vitest";
import { baseUrl, historyOf, housePage, send, setUpHouse } from "./helpers.ts";

// In CI the app runs without an Anthropic API key, so reading receipts is off
// and no house may see it or reach it. The deployed app has a key, so there
// every house has it (spec/unit/receipt.test.ts checks that); these skip.
const receiptsOn = async (): Promise<boolean> => {
  const { code, cookies } = await setUpHouse("Probe");
  return (await (await send(`/h/${code}/bill`, { cookie: cookies.Probe })).text()).includes('type="file"');
};

describe("reading receipts when the server has no API key", () => {
  it("shows no receipt upload on the bill page", async (ctx) => {
    if (await receiptsOn()) ctx.skip();
    const { code, cookies } = await setUpHouse("Rafi", "Dina");
    const html = await (await send(`/h/${code}/bill`, { cookie: cookies.Rafi })).text();
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain(`/h/${code}/receipt`);
  });

  it("refuses a receipt posted anyway, and adds nothing", async (ctx) => {
    if (await receiptsOn()) ctx.skip();
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
