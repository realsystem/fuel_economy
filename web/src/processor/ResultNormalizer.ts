/**
 * Turns raw detected lines into typed values with a field classification.
 *
 * The detector only knows "there is a number on line N". Deciding which number
 * is the sale amount and which is the volume uses three kinds of evidence,
 * strongest first:
 *   1. Arithmetic: with three numbers, amount = volume × unit price.
 *   2. Decimal places: pumps show money to 2 decimals and volume to 3.
 *   3. Layout: on two-line pumps the sale amount is usually on top.
 * When the evidence is weak the value is still returned, with a low
 * fieldConfidence, or as 'unknown'. Nothing is silently dropped.
 */
import type { ProcessingConfig } from './config.ts';
import type { DetectedValue, ProcessingResult } from '../models/ProcessingResult.ts';
import { decimalPlaces } from '../utils/numberFormatting.ts';

export interface RawLine {
  text: string;
  decimalIndex: number;
  digitCount: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number } | null;
  ambiguousDigits: Array<{ index: number; alternative: string }>;
}

export interface NormalizedOutput {
  values: DetectedValue[];
  fields: ProcessingResult['fields'];
  status: ProcessingResult['status'];
  warnings: string[];
}

const AMOUNT_DECIMALS = 2;
const VOLUME_DECIMALS = 3;

function toValue(line: RawLine, index: number): DetectedValue {
  const unreadable = line.text.includes('?');
  const value = unreadable ? null : Number(line.text);
  return {
    id: `v${index}`,
    text: line.text,
    value: value !== null && Number.isFinite(value) ? value : null,
    confidence: unreadable ? Math.min(line.confidence, 0.3) : line.confidence,
    box: line.box,
    field: 'unknown',
    fieldConfidence: 0,
    decimalInferred: false,
    ambiguousDigits: line.ambiguousDigits,
  };
}

/** Place a decimal point by convention when none was seen ("2000" → 20.00). */
function inferDecimal(v: DetectedValue, decimals: number): void {
  if (v.value === null || v.text.includes('.') || v.text.length <= decimals) return;
  v.value = Number(v.text.slice(0, -decimals) + '.' + v.text.slice(-decimals));
  v.decimalInferred = true;
  v.confidence *= 0.7;
}

export function normalizeLines(lines: RawLine[], cfg: ProcessingConfig): NormalizedOutput {
  const warnings: string[] = [];
  const values = lines.map(toValue);
  const fields: ProcessingResult['fields'] = {};
  if (!values.length) return { values, fields, status: 'no_numbers', warnings: ['No numbers were found.'] };

  const readable = values.filter((v) => v.value !== null);
  const assign = (v: DetectedValue, field: 'amount' | 'volume' | 'unitPrice', conf: number) => {
    v.field = field;
    v.fieldConfidence = conf;
    fields[field] = v.id;
  };

  // 1. Arithmetic consistency between three readable numbers.
  let classified = false;
  if (readable.length >= 3) {
    outer: for (const a of readable) for (const vol of readable) for (const p of readable) {
      if (a === vol || a === p || vol === p) continue;
      if (!a.value || !vol.value || !p.value) continue;
      if (Math.abs(a.value - vol.value * p.value) / a.value < 0.01 && decimalPlaces(a.text) === AMOUNT_DECIMALS) {
        assign(a, 'amount', 0.95); assign(vol, 'volume', 0.9); assign(p, 'unitPrice', 0.9);
        classified = true;
        break outer;
      }
    }
  }

  // 2 + 3. Decimal places, with the two-line layout as a tie-breaker.
  if (!classified && values.length >= 2) {
    const byDecimals = (d: number) => values.find((v) => v.value !== null && decimalPlaces(v.text) === d && v.field === 'unknown');
    let amount = byDecimals(AMOUNT_DECIMALS);
    let volume = byDecimals(VOLUME_DECIMALS);
    let conf = 0.85;
    if (amount && volume) {
      if (values.length === 2 && values.indexOf(amount) !== 0) {
        warnings.push('Volume is shown above the amount on this display; check the fields.');
        conf = 0.75;
      }
    } else if (values.length === 2) {
      // Fall back on layout: top = amount, bottom = volume.
      const [top, bottom] = values;
      if (!amount && (!volume || volume === bottom)) amount = top;
      if (!volume && amount === top) volume = bottom;
      conf = 0.5;
      if (amount && !amount.text.includes('.')) inferDecimal(amount, AMOUNT_DECIMALS);
      if (volume && !volume.text.includes('.')) inferDecimal(volume, VOLUME_DECIMALS);
      warnings.push('Fields were assigned by position only; check that amount and volume are correct.');
    }
    if (amount && volume && amount !== volume) {
      assign(amount, 'amount', conf);
      assign(volume, 'volume', conf);
      classified = true;
    }
  }

  // Plausibility of the implied unit price (affects confidence only).
  const a = values.find((v) => v.id === fields.amount);
  const vol = values.find((v) => v.id === fields.volume);
  if (a?.value && vol?.value) {
    const price = a.value / vol.value;
    const { min, max } = cfg.plausibleUnitPrice;
    if (price >= min && price <= max) {
      a.fieldConfidence = Math.min(0.95, a.fieldConfidence + 0.1);
      vol.fieldConfidence = Math.min(0.95, vol.fieldConfidence + 0.1);
    } else {
      a.fieldConfidence *= 0.5;
      vol.fieldConfidence *= 0.5;
      warnings.push(`Implied unit price ${price.toFixed(3)} is outside the expected range ${min}–${max}.`);
    }
  }

  for (const v of values) {
    if (v.value === null) warnings.push(`Some digits in "${v.text}" could not be read.`);
    else if (v.decimalInferred) warnings.push(`No decimal point was seen in "${v.text}"; it was placed by convention.`);
    for (const a of v.ambiguousDigits) {
      const digitsOnly = v.text.replace('.', '');
      warnings.push(`In "${v.text}", digit ${a.index + 1} ("${digitsOnly[a.index]}") could also be "${a.alternative}".`);
    }
  }
  if (!classified) warnings.push('The numbers could not be matched to amount and volume.');

  const strong = (v: DetectedValue | undefined) =>
    !!v && v.value !== null && v.confidence >= 0.85 && v.fieldConfidence >= 0.8 && !v.decimalInferred && !v.ambiguousDigits.length;
  const status = strong(a) && strong(vol) ? 'ok' : 'partial';
  return { values, fields, status, warnings };
}
