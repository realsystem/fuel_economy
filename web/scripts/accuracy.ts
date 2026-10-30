/**
 * Accuracy report over the regression photos in ../images.
 * Usage: npm run accuracy            (prints a table)
 *        npm run accuracy -- --json  (machine-readable)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRgba } from './loadImage.ts';
import { processRgba } from '../src/processor/ImageProcessor.ts';
import type { ProcessingResult } from '../src/models/ProcessingResult.ts';

export interface AccuracyRow {
  image: string;
  expected: { amount: number; volume: number };
  amount: number | null;
  volume: number | null;
  amountCorrect: boolean;
  volumeCorrect: boolean;
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
    if (!expected[f]) continue;
    const img = await loadRgba(join(IMAGES, f));
    const t = Date.now();
    const r = processRgba(img.data, img.width, img.height, f);
    const pick = (id?: string) => r.values.find((v) => v.id === id)?.value ?? null;
    const amount = pick(r.fields.amount), volume = pick(r.fields.volume);
    rows.push({
      image: f,
      expected: { amount: expected[f].amount, volume: expected[f].volume },
      amount, volume,
      amountCorrect: amount === expected[f].amount,
      volumeCorrect: volume === expected[f].volume,
      status: r.status,
      needsReview: r.status !== 'ok',
      ms: Date.now() - t,
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await runAccuracy();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const fmt = (v: number | null, ok: boolean) => `${v ?? '—'}${ok ? '' : ' ✗'}`.padEnd(10);
    console.log('image        amount    volume    status   time');
    for (const r of rows) {
      console.log(`${r.image.padEnd(12)} ${fmt(r.amount, r.amountCorrect)}${fmt(r.volume, r.volumeCorrect)}${r.status.padEnd(9)}${r.ms}ms`);
    }
    const both = rows.filter((r) => r.amountCorrect && r.volumeCorrect).length;
    const wrong = rows.filter((r) => (r.amount !== null && !r.amountCorrect) || (r.volume !== null && !r.volumeCorrect)).length;
    console.log(`\nimages: ${rows.length}`);
    console.log(`fully correct (amount and volume): ${both}`);
    console.log(`fields correct: ${rows.reduce((s, r) => s + +r.amountCorrect + +r.volumeCorrect, 0)} / ${rows.length * 2}`);
    console.log(`images with an incorrect value: ${wrong}`);
    console.log(`flagged for review: ${rows.filter((r) => r.needsReview).length}`);
    console.log(`flagged for review but actually correct: ${rows.filter((r) => r.needsReview && r.amountCorrect && r.volumeCorrect).length}`);
    console.log(`wrong but NOT flagged for review: ${rows.filter((r) => !r.needsReview && !(r.amountCorrect && r.volumeCorrect)).length}`);
  }
}
