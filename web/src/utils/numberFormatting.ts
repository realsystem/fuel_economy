/**
 * Parse a number typed by a user or read from a display.
 * Accepts "12.34", "12,34" (decimal comma), "1,234.56", " 7 ".
 * Returns null for empty, non-numeric or negative input.
 */
export function parseNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s$€£]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    // The last separator is the decimal one.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length !== 3 ? parts.join('.') : parts.join('');
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Fixed-decimal formatting with a '.' separator regardless of locale (used for CSV). */
export function formatFixed(n: number | null | undefined, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toFixed(decimals);
}

/** Decimals used for display and export of each field. */
export const FIELD_DECIMALS = { amount: 2, volume: 3, unitPrice: 3 } as const;

/** Count digits after the decimal point in a numeric string ("24.07" → 2, "18" → 0). */
export function decimalPlaces(text: string): number {
  const i = text.indexOf('.');
  return i < 0 ? 0 : text.length - i - 1;
}
