/**
 * Full pipeline on decoded pixels. Pure and synchronous: it holds no global
 * state, so it can run in a Web Worker, in Node tests, or on a server.
 *
 *   RGBA pixels → normalise → display candidates → binarise → read numbers
 *   → pick the most convincing candidate → classify fields → result
 */
import { resolveConfig, type ProcessingConfig } from './config.ts';
import { binarizeDisplay, cropDisplay, displayCandidates, normalize } from './ImagePreprocessor.ts';
import { detectNumbers, type DetectedLine } from './NumberDetector.ts';
import { normalizeLines, type RawLine } from './ResultNormalizer.ts';
import type { ProcessingResult } from '../models/ProcessingResult.ts';

export const PROCESSOR_ID = 'browser-segment@0.1.0';

/** How convincing a set of lines is: readable digits, weighted by confidence, plus decimal points. */
function scoreLines(lines: DetectedLine[]): number {
  let s = 0;
  for (const l of lines.slice(0, 3)) {
    const readable = l.digits.filter((d) => d.char !== '?').length;
    s += readable * l.confidence + (l.decimalIndex >= 0 ? 1 : 0) - (l.digits.length - readable);
  }
  return s;
}

export function processRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  imageName: string,
  options?: Partial<ProcessingConfig>,
): ProcessingResult {
  const started = Date.now();
  const cfg = resolveConfig(options);
  const { gray, scaleToOriginal } = normalize(rgba, width, height, cfg);

  // Read every display candidate; keep the one whose reading is most
  // convincing. A consistent amount/volume pair outweighs extra digits, so a
  // stray mark that adds a digit does not win over a clean reading.
  let best: { raw: RawLine[]; score: number } | null = null;
  for (const region of displayCandidates(gray)) {
    const mask = binarizeDisplay(cropDisplay(gray, region), cfg);
    const lines = detectNumbers(mask, cfg);
    const offset = region.found ? { x: region.rect.x, y: region.rect.y } : { x: 0, y: 0 };
    const raw = toRawLines(lines, offset, scaleToOriginal);
    const norm = normalizeLines(raw, cfg);
    const classified = norm.values.filter((v) => v.field !== 'unknown');
    const score = scoreLines(lines)
      + classified.reduce((s, v) => s + 4 * v.fieldConfidence, 0)
      + (norm.status === 'ok' ? 4 : 0);
    if (!best || score > best.score) best = { raw, score };
  }

  const raw = best?.raw ?? [];
  const norm = normalizeLines(raw, cfg);
  return {
    schemaVersion: 1,
    processor: PROCESSOR_ID,
    subject: 'fuel_pump',
    imageName,
    imageSize: { width, height },
    status: norm.status,
    values: norm.values,
    fields: norm.fields,
    warnings: norm.warnings,
    error: norm.status === 'no_numbers' ? { code: 'no_numbers', message: 'No numbers were found on this image.' } : undefined,
    processedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

function toRawLines(lines: DetectedLine[], offset: { x: number; y: number }, scaleToOriginal: number): RawLine[] {
  return lines.map((l) => ({
    text: l.text,
    decimalIndex: l.decimalIndex,
    digitCount: l.digits.length,
    confidence: round(l.confidence),
    box: {
      x: Math.round((l.box.x + offset.x) * scaleToOriginal),
      y: Math.round((l.box.y + offset.y) * scaleToOriginal),
      width: Math.round(l.box.width * scaleToOriginal),
      height: Math.round(l.box.height * scaleToOriginal),
    },
    ambiguousDigits: l.digits.flatMap((d, i) => (d.alternative ? [{ index: i, alternative: d.alternative }] : [])),
  }));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
