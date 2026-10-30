/**
 * The processing result is the contract between any processing provider
 * (in-browser today, a remote worker later) and the rest of the app. It is
 * plain JSON-serialisable data so it can cross a worker boundary or an HTTP
 * API unchanged.
 */
import type { ProcessingError } from './ProcessingError.ts';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a detected number means. 'unknown' is a legitimate answer: the
 * detector exposes numbers it cannot classify rather than guessing.
 * New kinds (e.g. 'odometer') can be added without changing the shape.
 */
export type FieldKind = 'amount' | 'volume' | 'unitPrice' | 'unknown' | (string & {});

export interface DetectedValue {
  id: string;
  /** Text as read from the display, e.g. "24.07". '?' marks an unreadable digit. */
  text: string;
  /** Parsed number, or null when the text could not be parsed. */
  value: number | null;
  /** 0..1 reading confidence (digit match quality, decimal point evidence). */
  confidence: number;
  /** Location in original image pixels, when known. */
  box: BoundingBox | null;
  field: FieldKind;
  /** 0..1 confidence in the field classification. */
  fieldConfidence: number;
  /** True when the decimal point was not seen and was placed by convention. */
  decimalInferred: boolean;
  /** Digits whose reading had a close runner-up, e.g. [{ index: 2, alternative: '8' }]. */
  ambiguousDigits: Array<{ index: number; alternative: string }>;
}

export type ProcessingStatus = 'ok' | 'partial' | 'no_numbers' | 'error';

export interface ProcessingResult {
  schemaVersion: 1;
  /** Identifier of the processor that produced this, e.g. "browser-segment@0.1.0". */
  processor: string;
  /** What kind of image this was read as. Future: 'odometer', 'receipt'. */
  subject: 'fuel_pump' | (string & {});
  imageName: string;
  imageSize: { width: number; height: number } | null;
  status: ProcessingStatus;
  values: DetectedValue[];
  /** Ids into `values` for the classified fields, when classification succeeded. */
  fields: {
    amount?: string;
    volume?: string;
    unitPrice?: string;
  };
  warnings: string[];
  error?: ProcessingError;
  processedAt: string;
  durationMs: number;
}

export function emptyResult(imageName: string, processor: string): ProcessingResult {
  return {
    schemaVersion: 1,
    processor,
    subject: 'fuel_pump',
    imageName,
    imageSize: null,
    status: 'error',
    values: [],
    fields: {},
    warnings: [],
    processedAt: new Date().toISOString(),
    durationMs: 0,
  };
}
