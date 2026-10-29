import Anthropic from "@anthropic-ai/sdk";
import { MAX_CENTS } from "./money.ts";
import { normaliseNote } from "./names.ts";

// Reading a receipt photo with Claude. What comes back only fills in the bill
// form for the payer to check; nothing here adds a bill.

export type Reading = { shop: string; totalCents: number; items: { name: string; cents: number }[] };
export type ReadReceipt = (image: Buffer, mediaType: string) => Promise<Reading | null>;
// Who may read receipts: the listed houses, each up to its daily limit.
export type Receipts = { houses: Set<string>; limit: ScanLimit; read: ReadReceipt };

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const ITEMS_MAX = 60;
// Short enough that "<name> -$1,000,000.00" still fits in a note.
const ITEM_NAME_MAX = 60;

const isCents = (n: unknown, min: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= MAX_CENTS;
// Text off a receipt is shown to the house like anything typed, so it gets the same cleaning.
const clean = (raw: unknown, max: number): string | null =>
  typeof raw === "string" ? normaliseNote([...raw.trim().replace(/\s+/g, " ")].slice(0, max).join("")) : null;

// The model's answer, checked like any other input: whole cents, a positive
// total, cleaned names. Items that don't pass are dropped; a bad total refuses it all.
export function checkReading(raw: unknown): Reading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isCents(r.total_cents, 1) || !Array.isArray(r.items)) return null;
  const items: Reading["items"] = [];
  for (const item of r.items.slice(0, ITEMS_MAX)) {
    const name = clean(item?.name, ITEM_NAME_MAX);
    const cents: unknown = item?.cents;
    if (name !== null && name !== "" && typeof cents === "number" && isCents(Math.abs(cents), 0)) items.push({ name, cents });
  }
  return { shop: clean(r.shop, ITEM_NAME_MAX) ?? "", totalCents: r.total_cents, items };
}

const SCHEMA = {
  type: "object",
  properties: {
    shop: { type: "string", description: "The shop's name as printed, e.g. Coles Civic. Empty if not shown." },
    total_cents: { type: "integer", description: "The total paid, in whole cents: $18.50 is 1850." },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          cents: { type: "integer", description: "The line's price in whole cents; negative for a discount." },
        },
        required: ["name", "cents"],
        additionalProperties: false,
      },
    },
  },
  required: ["shop", "total_cents", "items"],
  additionalProperties: false,
};

const PROMPT =
  "This is a photo of a shopping receipt. Read the shop's name, every line item with its price, and the total paid. " +
  "Give amounts in whole cents. If a price can't be read, leave that line out rather than guess.";

export function claudeReader(client: Anthropic): ReadReceipt {
  return async (image, mediaType) => {
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image.toString("base64") } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    // A refusal or a cut-off answer is no reading.
    if (response.stop_reason !== "end_turn") return null;
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    try {
      return checkReading(JSON.parse(text));
    } catch {
      return null;
    }
  };
}

// shortcut: counts live in memory, so a restart (Fly stops idle machines) resets
// them; the API key's spend limit is the hard cap. Move to SQLite if that's not enough.
export class ScanLimit {
  perDay: number;
  #used = new Map<string, number>();
  constructor(perDay: number) {
    this.perDay = perDay;
  }

  // Takes one of today's scans for the house, if any are left. Days are Canberra days.
  take(code: string, now = new Date()): boolean {
    const key = `${code} ${now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })}`;
    const used = this.#used.get(key) ?? 0;
    if (used >= this.perDay) return false;
    this.#used.set(key, used + 1);
    return true;
  }
}
