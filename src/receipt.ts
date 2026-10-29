import Anthropic from "@anthropic-ai/sdk";
import { MAX_CENTS } from "./money.ts";
import { normaliseNote } from "./names.ts";

// Reading a receipt photo with Claude. What comes back only fills in the bill
// form for the payer to check; nothing here adds a bill.

// `off` is how much a discount took off that item (already out of `cents`);
// `fees` are charges or credits on the whole receipt; GST is only a note.
export type Reading = {
  shop: string;
  totalCents: number;
  items: { name: string; cents: number; off: number }[];
  fees: { name: string; cents: number }[];
  gstCents: number;
};
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
  // A line's name and signed cents, or null when either isn't sound.
  const line = (raw: unknown): { name: string; cents: number } | null => {
    const l = raw as Record<string, unknown> | null;
    const name = clean(l?.name, ITEM_NAME_MAX);
    const cents = l?.cents;
    return name !== null && name !== "" && typeof cents === "number" && isCents(Math.abs(cents), 0) ? { name, cents } : null;
  };
  const items: Reading["items"] = [];
  for (const raw of r.items.slice(0, ITEMS_MAX)) {
    const item = line(raw);
    const off = (raw as Record<string, unknown> | null)?.discount_cents;
    if (item !== null) items.push({ ...item, off: isCents(off, 0) ? off : 0 });
  }
  const fees = (Array.isArray(r.fees) ? r.fees.slice(0, ITEMS_MAX) : []).map(line).filter((f) => f !== null);
  return { shop: clean(r.shop, ITEM_NAME_MAX) ?? "", totalCents: r.total_cents, items, fees, gstCents: isCents(r.gst_cents, 0) ? r.gst_cents : 0 };
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
          cents: { type: "integer", description: "What was paid for this item in whole cents, after any discount on this item." },
          discount_cents: { type: "integer", description: "How much a discount or promo on this item took off, in whole cents; 0 if none." },
        },
        required: ["name", "cents", "discount_cents"],
        additionalProperties: false,
      },
    },
    fees: {
      type: "array",
      description: "Charges or credits on the whole receipt rather than one item.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          cents: { type: "integer", description: "In whole cents; negative for a credit, a whole-shop discount or rounding down." },
        },
        required: ["name", "cents"],
        additionalProperties: false,
      },
    },
    gst_cents: { type: "integer", description: "The GST the receipt says is included, in whole cents; 0 if not shown." },
  },
  required: ["shop", "total_cents", "items", "fees", "gst_cents"],
  additionalProperties: false,
};

const PROMPT = [
  "This is a photo of a shopping receipt. Read the shop's name, every item bought, and the total paid, in whole cents.",
  "When a discount, promo or price drop applies to one item, take it off that item: give the price paid in cents and the amount taken off in discount_cents, and don't list the discount as a line of its own.",
  "Charges or credits on the whole receipt go in fees, not items: card or payment surcharges, delivery, service or packing fees, cash rounding, and discounts on the whole shop.",
  "A bag fee or a bottle or can deposit is an item.",
  "Don't list GST, subtotals, totals, how it was paid, change, savings summaries or loyalty points as items or fees. If the receipt says how much GST is included, give it in gst_cents.",
  "If a price can't be read, leave that line out rather than guess.",
].join(" ");

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
