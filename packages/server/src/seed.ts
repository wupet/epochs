/** The largest seed: the world's generator keeps a 32-bit state. */
export const MAX_SEED = 2 ** 32 - 1;

/** Reads `EPOCHS_SEED`: a whole number from 0 to 2^32 - 1 written in digits. Returns null for anything else. */
export function parseSeed(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const seed = Number(text);
  return Number.isSafeInteger(seed) && seed <= MAX_SEED ? seed : null;
}
