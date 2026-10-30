/**
 * Regression test over the real photos in ../images (expected values in
 * fixtures/expected.json). Fails if accuracy drops below the recorded level,
 * or if any wrong reading is accepted without a review flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccuracy, summarize } from '../scripts/accuracy.ts';

// Levels at the time of writing; lower them only with a reason.
const MIN_CORRECT = { tuning: 8, phone: 28 };

test('regression photos: accuracy and honest review flags', async () => {
  const rows = await runAccuracy();
  assert.ok(rows.length >= 51, `expected all regression photos, found ${rows.length}`);

  const silentlyWrong = rows.filter((r) => !r.needsReview && (!r.correct || r.hasWrongValue));
  assert.deepEqual(silentlyWrong.map((r) => r.image), [], 'wrong values must be flagged for review');

  for (const set of ['tuning', 'phone'] as const) {
    const s = summarize(rows.filter((r) => r.set === set));
    assert.ok(s.correct >= MIN_CORRECT[set], `${set}: expected at least ${MIN_CORRECT[set]} fully correct, got ${s.correct}/${s.scored}`);
  }
});
