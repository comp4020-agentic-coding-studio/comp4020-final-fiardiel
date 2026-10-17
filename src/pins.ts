import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// A PIN guards against opening someone else's name by accident, so four ASCII
// digits are enough. Look-alike digits and spaces are refused, not converted.
export function isPin(raw: string): boolean {
  return /^[0-9]{4}$/.test(raw);
}

// Stored as "<salt>:<hash>", never as the digits.
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash || hash.length !== 64) return false;
  return timingSafeEqual(scryptSync(pin, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}
