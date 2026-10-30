/**
 * Regression test over the real photos in ../images (expected values in
 * fixtures/expected.json). Fails if accuracy drops below the recorded level,
 * or if any wrong reading is reported without a review flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccuracy } from '../scripts/accuracy.ts';

const MIN_FULLY_CORRECT = 8; // of 8 at the time of writing; lower it only with a reason.

test('regression photos: accuracy and honest review flags', async () => {
  const rows = await runAccuracy();
  assert.equal(rows.length, 8, 'all regression photos were found');
  const correct = rows.filter((r) => r.amountCorrect && r.volumeCorrect);
  const silentlyWrong = rows.filter((r) => !r.needsReview && !(r.amountCorrect && r.volumeCorrect));
  assert.deepEqual(silentlyWrong.map((r) => r.image), [], 'wrong values must be flagged for review');
  assert.ok(correct.length >= MIN_FULLY_CORRECT,
    `expected at least ${MIN_FULLY_CORRECT} fully correct, got ${correct.length}: ${rows.filter((r) => !correct.includes(r)).map((r) => r.image).join(', ')}`);
});
