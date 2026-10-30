import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLines, type RawLine } from '../src/processor/ResultNormalizer.ts';
import { DEFAULT_CONFIG } from '../src/processor/config.ts';

const line = (text: string, confidence = 0.98, extra: Partial<RawLine> = {}): RawLine => ({
  text, decimalIndex: text.indexOf('.'), digitCount: text.replace('.', '').length, confidence,
  box: { x: 0, y: 0, width: 10, height: 10 }, ambiguousDigits: [], ...extra,
});
const field = (out: ReturnType<typeof normalizeLines>, f: 'amount' | 'volume' | 'unitPrice') =>
  out.values.find((v) => v.id === out.fields[f]);

test('two lines with 2 and 3 decimals: amount and volume', () => {
  const out = normalizeLines([line('24.07'), line('6.362')], DEFAULT_CONFIG);
  assert.equal(field(out, 'amount')?.value, 24.07);
  assert.equal(field(out, 'volume')?.value, 6.362);
  assert.equal(out.status, 'ok');
});

test('decimal places win over position when volume is on top', () => {
  const out = normalizeLines([line('9.735'), line('29.68')], DEFAULT_CONFIG);
  assert.equal(field(out, 'amount')?.value, 29.68);
  assert.equal(field(out, 'volume')?.value, 9.735);
  assert.ok(out.warnings.some((w) => w.includes('above')));
});

test('three lines are classified by arithmetic', () => {
  const out = normalizeLines([line('45.00'), line('12.500'), line('3.600')], DEFAULT_CONFIG);
  assert.equal(field(out, 'amount')?.value, 45);
  assert.equal(field(out, 'volume')?.value, 12.5);
  assert.equal(field(out, 'unitPrice')?.value, 3.6);
});

test('missing decimal point is placed by convention and flagged', () => {
  const out = normalizeLines([line('2000'), line('4348')], DEFAULT_CONFIG);
  const a = field(out, 'amount')!, v = field(out, 'volume')!;
  assert.equal(a.value, 20);
  assert.equal(v.value, 4.348);
  assert.ok(a.decimalInferred && v.decimalInferred);
  assert.equal(out.status, 'partial');
});

test('unreadable digits keep the text but no value', () => {
  const out = normalizeLines([line('2?.07'), line('6.362')], DEFAULT_CONFIG);
  const unread = out.values.find((v) => v.text === '2?.07')!;
  assert.equal(unread.value, null);
  assert.equal(out.status, 'partial');
});

test('a single number is exposed as unknown, not guessed', () => {
  const out = normalizeLines([line('38.83')], DEFAULT_CONFIG);
  assert.equal(out.values[0].field, 'unknown');
  assert.equal(out.fields.amount, undefined);
  assert.equal(out.status, 'partial');
});

test('implausible unit price lowers confidence and warns', () => {
  const out = normalizeLines([line('99.99'), line('0.123')], DEFAULT_CONFIG);
  assert.ok(field(out, 'amount')!.fieldConfidence < 0.8);
  assert.ok(out.warnings.some((w) => w.includes('outside the expected range')));
  assert.equal(out.status, 'partial');
});

test('ambiguous digit names the digit and its alternative', () => {
  const out = normalizeLines([line('24.07', 0.95, { ambiguousDigits: [{ index: 3, alternative: '9' }] }), line('6.362')], DEFAULT_CONFIG);
  assert.equal(out.status, 'partial');
  assert.ok(out.warnings.some((w) => w.includes('digit 4 ("7") could also be "9"')));
});

test('no lines → no_numbers', () => {
  assert.equal(normalizeLines([], DEFAULT_CONFIG).status, 'no_numbers');
});
