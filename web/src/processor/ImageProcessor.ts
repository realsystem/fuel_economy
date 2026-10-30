/**
 * Full pipeline on decoded pixels. Pure and synchronous: it holds no global
 * state, so it can run in a Web Worker, in Node tests, or on a server.
 *
 *   RGBA pixels → normalise → display candidates → binarise → read numbers
 *   → pick the most convincing candidate → classify fields → result
 */
import { resolveConfig, type ProcessingConfig } from './config.ts';
import {
  binarizeDisplay, cropDisplay, displayCandidates, FALLBACK_METHODS, normalize, type BinarizeMethod,
} from './ImagePreprocessor.ts';
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
  //
  // The standard threshold runs first. If it gives a confident reading, that
  // is the answer, so clean photos take exactly the original path. Otherwise
  // the fallback methods (reflections, glare, light-on-dark displays) are
  // tried too. A reading found only by a fallback is accepted without review
  // only if a second method independently gives the same amount and volume:
  // each extra method is another chance of a confident misreading.
  const regions = displayCandidates(gray);
  type Reading = { method: BinarizeMethod; raw: RawLine[]; score: number; ok: boolean; key: string };
  const perMethod: Reading[] = [];
  const tryMethod = (method: BinarizeMethod): Reading | null => {
    let best: Reading | null = null;
    for (const region of regions) {
      const mask = binarizeDisplay(cropDisplay(gray, region), cfg, method);
      const lines = detectNumbers(mask, cfg);
      const offset = region.found ? { x: region.rect.x, y: region.rect.y } : { x: 0, y: 0 };
      const raw = toRawLines(lines, offset, scaleToOriginal);
      const norm = normalizeLines(raw, cfg);
      const classified = norm.values.filter((v) => v.field !== 'unknown');
      const score = scoreLines(lines)
        + classified.reduce((s, v) => s + 4 * v.fieldConfidence, 0)
        + (norm.status === 'ok' ? 4 : 0);
      const pick = (id?: string) => norm.values.find((v) => v.id === id)?.value ?? null;
      const key = `${pick(norm.fields.amount)}|${pick(norm.fields.volume)}`;
      if (!best || score > best.score) best = { method, raw, score, ok: norm.status === 'ok', key };
    }
    if (best) perMethod.push(best);
    return best;
  };

  const primary = tryMethod('mean');
  let chosen = primary;
  let uncorroborated = false;
  if (!primary?.ok) {
    for (const method of FALLBACK_METHODS) tryMethod(method);
    const agreeCount = (r: Reading) => perMethod.filter((m) => m.key === r.key).length;
    const bestOf = (rs: Reading[]) => rs.reduce<Reading | null>((p, c) => (!p || c.score > p.score ? c : p), null);
    const primaryUsable = !!primary && !primary.key.includes('null');
    // 1. a confident reading that another method confirms;
    // 2. otherwise the standard reading, if it found both amount and volume;
    // 3. otherwise the most convincing fallback reading (flagged unless confirmed).
    chosen = bestOf(perMethod.filter((m) => m.ok && agreeCount(m) >= 2))
      ?? (primaryUsable ? primary : bestOf(perMethod));
    if (chosen && chosen.method !== 'mean' && chosen.ok) uncorroborated = agreeCount(chosen) < 2;
  }

  const raw = chosen?.raw ?? [];
  const norm = normalizeLines(raw, cfg);
  if (uncorroborated && norm.status === 'ok') {
    norm.status = 'partial';
    norm.warnings.push('This photo was hard to read (reflection, glare or an unusual display) and only one method produced these numbers; please check them.');
  }
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
    incomplete: l.incomplete,
  }));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
