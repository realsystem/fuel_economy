import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptiveThresholdDark, connectedComponents, otsuThreshold, resize, rgbaToValue, shear, type GrayImage,
} from '../src/processor/image.ts';
import { classifySegments, DIGIT_PATTERNS } from '../src/processor/NumberDetector.ts';
import { findDisplay } from '../src/processor/ImagePreprocessor.ts';
import { processRgba } from '../src/processor/ImageProcessor.ts';
import { renderDisplay } from './helpers/sevenSegment.ts';

const gray = (w: number, h: number, f: (x: number, y: number) => number): GrayImage => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { width: w, height: h, data };
};

// --- preprocessing primitives ---

test('rgbaToValue keeps coloured backlights bright', () => {
  const blue = new Uint8Array([20, 40, 230, 255]);
  assert.equal(rgbaToValue(blue, 1, 1).data[0], 230);
});

test('otsu separates a bimodal image', () => {
  const img = gray(10, 10, (x) => (x < 5 ? 30 : 220));
  const t = otsuThreshold(img);
  assert.ok(t >= 30 && t < 220, `threshold ${t}`);
});

test('adaptive threshold marks dark strokes as ink regardless of overall brightness', () => {
  const img = gray(40, 40, (x, y) => (x >= 18 && x < 22 ? 60 : 120 + y)); // gradient background, dark bar
  const m = adaptiveThresholdDark(img, 15, 10);
  assert.equal(m.data[20 * 40 + 20], 1);
  assert.equal(m.data[20 * 40 + 5], 0);
});

test('connected components finds separate blobs with correct boxes', () => {
  const m = { width: 10, height: 5, data: new Uint8Array(50) };
  for (const [x, y] of [[1, 1], [2, 1], [2, 2], [7, 3], [8, 4]]) m.data[y * 10 + x] = 1;
  const { components } = connectedComponents(m);
  assert.equal(components.length, 2);
  const a = components.find((c) => c.x === 1)!;
  assert.deepEqual([a.width, a.height, a.area], [2, 2, 3]);
});

test('resize changes dimensions and preserves flat colour', () => {
  const r = resize(gray(100, 50, () => 77), 40, 20);
  assert.deepEqual([r.width, r.height], [40, 20]);
  assert.ok(r.data.every((v) => v === 77));
});

test('shear moves rows in opposite directions about the centre', () => {
  const m = { width: 9, height: 3, data: new Uint8Array(27) };
  for (let y = 0; y < 3; y++) m.data[y * 9 + 4] = 1;
  const s = shear(m, 1);
  assert.equal(s.data[0 * 9 + 3], 1); // top row shifted left
  assert.equal(s.data[2 * 9 + 5], 1); // bottom row shifted right
});

test('findDisplay locates a bright panel inside a dark bezel', () => {
  const img = gray(200, 100, (x, y) => (x >= 40 && x < 160 && y >= 20 && y < 80 ? 220 : 50));
  const d = findDisplay(img);
  assert.ok(d.found);
  assert.deepEqual(d.rect, { x: 40, y: 20, width: 120, height: 60 });
});

// --- digit recognition ---

test('ideal segment patterns classify to their digit', () => {
  for (const p of DIGIT_PATTERNS) {
    const r = classifySegments([...p.on]);
    assert.equal(r.char, p.digit);
    assert.equal(r.score, 1);
  }
});

test('a partially lit segment still classifies but with lower score', () => {
  const eight = [1, 1, 1, 1, 1, 1, 1];
  eight[4] = 0.4; // faint bottom-left: between 8 and 9
  const r = classifySegments(eight);
  assert.ok(['8', '9'].includes(r.char));
  assert.ok(r.score < 1);
  assert.ok(r.alternative, 'close call should report an alternative');
});

// --- whole pipeline on synthetic displays (numbers not in the photo set) ---

const cases: Array<{ lines: [string, string]; slant?: number; panel?: [number, number, number] }> = [
  { lines: ['45.67', '12.345'] },
  { lines: ['108.90', '26.071'], slant: 0.12 },
  { lines: ['3.20', '0.874'], panel: [170, 230, 245] },
  { lines: ['76.54', '19.582'], slant: 0.18 },
];

for (const c of cases) {
  test(`synthetic display ${c.lines.join(' / ')}${c.slant ? ' (italic)' : ''}`, () => {
    const img = renderDisplay({ lines: c.lines, slant: c.slant, panel: c.panel });
    const r = processRgba(img.data, img.width, img.height, 'synthetic.png');
    assert.deepEqual(r.values.map((v) => v.text), c.lines);
    const val = (id?: string) => r.values.find((v) => v.id === id)?.value;
    assert.equal(val(r.fields.amount), Number(c.lines[0]));
    assert.equal(val(r.fields.volume), Number(c.lines[1]));
    for (const v of r.values) assert.ok(v.box && v.box.width > 0, 'bounding box reported');
  });
}

test('blank image yields no_numbers, not a crash', () => {
  const W = 300, H = 200, data = new Uint8Array(W * H * 4).fill(200);
  const r = processRgba(data, W, H, 'blank.png');
  assert.equal(r.status, 'no_numbers');
  assert.equal(r.values.length, 0);
  assert.equal(r.error?.code, 'no_numbers');
});
