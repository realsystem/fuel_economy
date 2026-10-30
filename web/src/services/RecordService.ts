/**
 * Creating and updating fuel records. Pure functions: each returns a new
 * record, so the UI state stays immutable and these are easy to test.
 */
import {
  effectiveValue, emptyField, type FieldValue, type FuelField, type FuelRecord,
} from '../models/FuelRecord.ts';
import type { ProcessingResult } from '../models/ProcessingResult.ts';
import { ERROR_MESSAGES } from '../models/ProcessingError.ts';

export function newRecord(id: string, fileName: string, fileSize: number): FuelRecord {
  return {
    id, fileName, fileSize,
    status: 'queued',
    amount: emptyField(), volume: emptyField(), unitPrice: emptyField(),
    result: null, note: null, processedAt: null,
  };
}

function fieldFrom(result: ProcessingResult, id: string | undefined): FieldValue {
  const v = id ? result.values.find((x) => x.id === id) : undefined;
  if (!v) return emptyField();
  return {
    detected: v.value,
    detectedText: v.text,
    // A digit with a close alternative reading caps confidence so the field is marked for checking.
    confidence: Math.min(v.confidence, v.fieldConfidence || v.confidence, v.ambiguousDigits.length ? 0.7 : 1),
    corrected: null,
    derived: null,
  };
}

/** Apply a processing result to a record. Previous user corrections are discarded only by an explicit reprocess. */
export function applyResult(record: FuelRecord, result: ProcessingResult): FuelRecord {
  const base: FuelRecord = {
    ...record,
    result,
    processedAt: result.processedAt,
    amount: fieldFrom(result, result.fields.amount),
    volume: fieldFrom(result, result.fields.volume),
    unitPrice: fieldFrom(result, result.fields.unitPrice),
  };
  if (result.status === 'error') {
    const code = result.error?.code ?? 'internal';
    return { ...base, status: 'failed', note: result.error?.message ?? ERROR_MESSAGES[code] };
  }
  if (result.status === 'no_numbers') {
    return withDerived({ ...base, status: 'review', note: 'No numbers were found. You can enter the values by hand.' });
  }
  const note = result.warnings.length ? result.warnings.join(' ') : null;
  return withDerived({ ...base, status: result.status === 'ok' ? 'detected' : 'review', note });
}

/** Recompute the derived unit price (amount / volume) when it was not read directly. */
export function withDerived(r: FuelRecord): FuelRecord {
  const amount = effectiveValue(r.amount);
  const volume = effectiveValue(r.volume);
  const derived = amount !== null && volume !== null && volume > 0 ? amount / volume : null;
  return { ...r, unitPrice: { ...r.unitPrice, derived } };
}

/** Record a user edit. `value` null clears the correction (back to the detected value). */
export function correctField(r: FuelRecord, field: FuelField, value: number | null): FuelRecord {
  const f = r[field];
  // Editing back to exactly the detected value is not a correction.
  const corrected = value !== null && value === f.detected ? null : value;
  const next = withDerived({ ...r, [field]: { ...f, corrected } });
  // An edited record needs a fresh confirmation.
  return next.status === 'confirmed' ? { ...next, status: 'review' } : next;
}

/** A record can be confirmed once it has an amount and a volume. */
export function canConfirm(r: FuelRecord): boolean {
  const a = effectiveValue(r.amount), v = effectiveValue(r.volume);
  return a !== null && v !== null && a > 0 && v > 0;
}

export function confirmRecord(r: FuelRecord): FuelRecord {
  return canConfirm(r) ? { ...r, status: 'confirmed' } : r;
}

export function unconfirmRecord(r: FuelRecord): FuelRecord {
  return r.status === 'confirmed' ? { ...r, status: r.result?.status === 'ok' ? 'detected' : 'review' } : r;
}
