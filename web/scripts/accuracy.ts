/**
 * Accuracy report over the regression photos in ../images.
 * Usage: npm run accuracy            (prints a table)
 *        npm run accuracy -- --json  (machine-readable)
 *
 * Photos whose amount is not readable by eye (expected amount null) are
 * scored on volume only and counted separately.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRgba } from './loadImage.ts';
import { processRgba } from '../src/processor/ImageProcessor.ts';
import type { ProcessingResult } from '../src/models/ProcessingResult.ts';

export interface AccuracyRow {
  image: string;
  /** 'tuning' = the original fuel* photos the detector was tuned on; 'phone' = later photos. */
  set: 'tuning' | 'phone';
  expected: { amount: number | null; volume: number };
  amount: number | null;
  volume: number | null;
  /** null when the true amount is unknown. */
  amountCorrect: boolean | null;
  volumeCorrect: boolean;
  /** Amount (when known) and volume both correct. */
  correct: boolean;
  /** Some reported value is wrong (as opposed to missing). */
  hasWrongValue: boolean;
  status: ProcessingResult['status'];
  needsReview: boolean;
  ms: number;
}

const here = new URL('.', import.meta.url).pathname;
const IMAGES = join(here, '../../images');
const EXPECTED = join(here, '../test/fixtures/expected.json');

export async function runAccuracy(): Promise<AccuracyRow[]> {
  const expected = JSON.parse(readFileSync(EXPECTED, 'utf8'));
  const rows: AccuracyRow[] = [];
  for (const f of readdirSync(IMAGES).sort()) {
    const e = expected[f];
    if (!e) continue;
    const img = await loadRgba(join(IMAGES, f));
    const t = Date.now();
    const r = processRgba(img.data, img.width, img.height, f);
    const pick = (id?: string) => r.values.find((v) => v.id === id)?.value ?? null;
    const amount = pick(r.fields.amount), volume = pick(r.fields.volume);
    const amountCorrect = e.amount === null ? null : amount === e.amount;
    const volumeCorrect = volume === e.volume;
    rows.push({
      image: f,
      set: f.startsWith('fuel') ? 'tuning' : 'phone',
      expected: { amount: e.amount, volume: e.volume },
      amount, volume, amountCorrect, volumeCorrect,
      correct: amountCorrect !== false && volumeCorrect,
      hasWrongValue: (amount !== null && amountCorrect === false) || (volume !== null && !volumeCorrect),
      status: r.status,
      needsReview: r.status !== 'ok',
      ms: Date.now() - t,
    });
  }
  return rows;
}

export function summarize(rows: AccuracyRow[]) {
  const scored = rows.filter((r) => r.expected.amount !== null);
  return {
    images: rows.length,
    correct: scored.filter((r) => r.correct).length,
    scored: scored.length,
    volumeOnly: rows.length - scored.length,
    volumeOnlyCorrect: rows.filter((r) => r.expected.amount === null && r.volumeCorrect).length,
    acceptedAsOk: rows.filter((r) => !r.needsReview).length,
    flagged: rows.filter((r) => r.needsReview).length,
    flaggedButCorrect: rows.filter((r) => r.needsReview && r.correct).length,
    wrongUnflagged: rows.filter((r) => !r.needsReview && (!r.correct || r.hasWrongValue)).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await runAccuracy();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const fmt = (v: number | null, ok: boolean | null) => `${v ?? '—'}${ok === false ? ' ✗' : ok === null ? ' ?' : ''}`.padEnd(11);
    console.log('image                         amount     volume     status   time');
    for (const r of rows) {
      console.log(`${r.image.padEnd(30)}${fmt(r.amount, r.amountCorrect)}${fmt(r.volume, r.volumeCorrect)}${r.status.padEnd(9)}${r.ms}ms`);
    }
    for (const set of ['tuning', 'phone'] as const) {
      const s = summarize(rows.filter((r) => r.set === set));
      if (!s.images) continue;
      console.log(`\n${set === 'tuning' ? 'Tuning photos (fuel*)' : 'Phone photos (not used for tuning)'}: ${s.images}`);
      console.log(`  fully correct: ${s.correct} / ${s.scored}${s.volumeOnly ? `  (+${s.volumeOnly} scored on volume only: ${s.volumeOnlyCorrect} correct)` : ''}`);
      console.log(`  accepted without review: ${s.acceptedAsOk}   flagged for review: ${s.flagged} (of which actually correct: ${s.flaggedButCorrect})`);
      console.log(`  wrong but NOT flagged: ${s.wrongUnflagged}`);
    }
  }
}
