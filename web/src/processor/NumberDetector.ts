/**
 * Number detection on a binarised display.
 *
 * Port of the second half of the original pipeline:
 *  - pump_ocr.py: split the display into text lines using the row projection,
 *    crop each line to its digit components, find the decimal point
 *    geometrically and insert it by position.
 *  - ocr_segment.py: recognise each digit by testing which of its seven
 *    segments are lit and looking the pattern up in DIGITS_LOOKUP.
 *
 * Differences from the Python originals: every size is relative to the line
 * height instead of absolute pixels, italic displays are straightened with a
 * shear search before digits are separated, and digits are matched to the
 * closest segment pattern (with a score) instead of requiring an exact match.
 */
import type { ProcessingConfig } from './config.ts';
import { connectedComponents, shear, type Component, type Mask, type Rect } from './image.ts';

/** Segment order: top, top-left, top-right, middle, bottom-left, bottom-right, bottom (as in ocr_segment.py). */
export type SegmentPattern = readonly [number, number, number, number, number, number, number];

/** DIGITS_LOOKUP from ocr_segment.py, plus common alternate forms of 6, 7 and 9. */
export const DIGIT_PATTERNS: ReadonlyArray<{ digit: string; on: SegmentPattern }> = [
  { digit: '0', on: [1, 1, 1, 0, 1, 1, 1] },
  { digit: '1', on: [0, 0, 1, 0, 0, 1, 0] },
  { digit: '2', on: [1, 0, 1, 1, 1, 0, 1] },
  { digit: '3', on: [1, 0, 1, 1, 0, 1, 1] },
  { digit: '4', on: [0, 1, 1, 1, 0, 1, 0] },
  { digit: '5', on: [1, 1, 0, 1, 0, 1, 1] },
  { digit: '6', on: [1, 1, 0, 1, 1, 1, 1] },
  { digit: '7', on: [1, 0, 1, 0, 0, 1, 0] },
  { digit: '8', on: [1, 1, 1, 1, 1, 1, 1] },
  { digit: '9', on: [1, 1, 1, 1, 0, 1, 1] },
  { digit: '6', on: [0, 1, 0, 1, 1, 1, 1] }, // 6 without top bar
  { digit: '7', on: [1, 1, 1, 0, 0, 1, 0] }, // 7 with top-left serif
  { digit: '9', on: [1, 1, 1, 1, 0, 1, 0] }, // 9 without bottom bar
];

export interface DetectedDigit {
  char: string;
  /** 0..1, how well the lit segments match the chosen digit. */
  score: number;
  /** Runner-up digit, when it was close. */
  alternative?: string;
  box: Rect;
}

export interface DetectedLine {
  /** Digits with a '.' inserted where a decimal point was found; '?' for unreadable digits. */
  text: string;
  digits: DetectedDigit[];
  /** Index in `digits` before which the decimal point sits, or -1 if none was seen. */
  decimalIndex: number;
  /** Bounding box of the whole number, in display coordinates. */
  box: Rect;
  /** Height of the digits in pixels (display coordinates). */
  digitHeight: number;
  /** Mean digit score. */
  confidence: number;
}

interface Band { y0: number; y1: number }

/** Find horizontal bands of ink (candidate text lines) from the row projection. */
export function findBands(mask: Mask, cfg: ProcessingConfig): Band[] {
  const proj = new Array<number>(mask.height).fill(0);
  for (let y = 0; y < mask.height; y++) {
    let s = 0;
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x++) s += mask.data[row + x];
    proj[y] = s;
  }
  const max = Math.max(...proj, 0);
  if (max === 0) return [];
  const t = max * 0.06;
  const minH = mask.height * cfg.minLineHeightFraction;
  const bands: Band[] = [];
  let start = -1;
  for (let y = 0; y <= mask.height; y++) {
    const on = y < mask.height && proj[y] > t;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      // Bridge tiny gaps (the horizontal gap between upper and lower segments is never this small).
      const gapEnd = y + Math.max(1, Math.round(mask.height * 0.01));
      let resumed = false;
      for (let k = y; k < Math.min(gapEnd, mask.height); k++) if (proj[k] > t) { resumed = true; break; }
      if (resumed) continue;
      if (y - start >= minH) bands.push({ y0: start, y1: y });
      start = -1;
    }
  }
  return bands;
}

/** Choose the shear that best separates digits (maximises empty columns). */
export function estimateShear(mask: Mask, maxShear: number): number {
  let best = 0, bestScore = -1;
  for (let s = -maxShear; s <= maxShear + 1e-9; s += 0.025) {
    const m = shear(mask, s);
    let minX = m.width, maxX = -1;
    const col = new Uint8Array(m.width);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (m.data[y * m.width + x]) { col[x] = 1; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    let empty = 0;
    for (let x = minX; x <= maxX; x++) if (!col[x]) empty++;
    // Prefer smaller shear on ties.
    const score = empty - Math.abs(s) * 0.5;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return Math.round(best * 1000) / 1000;
}

function segmentFill(m: Mask, x0: number, x1: number, y0: number, y1: number): number[] {
  const w = x1 - x0, h = y1 - y0;
  const hit = (ax: number, bx: number, ay: number, by: number, horizontal: boolean): number => {
    const X0 = x0 + Math.floor(ax * w), X1 = x0 + Math.ceil(bx * w);
    const Y0 = y0 + Math.floor(ay * h), Y1 = y0 + Math.ceil(by * h);
    let lines = 0, lit = 0;
    if (horizontal) {
      for (let x = X0; x < X1; x++) {
        lines++;
        for (let y = Y0; y < Y1; y++) if (m.data[y * m.width + x]) { lit++; break; }
      }
    } else {
      for (let y = Y0; y < Y1; y++) {
        lines++;
        for (let x = X0; x < X1; x++) if (m.data[y * m.width + x]) { lit++; break; }
      }
    }
    return lines ? lit / lines : 0;
  };
  return [
    hit(0.3, 0.7, 0, 0.22, true),     // top
    hit(0, 0.3, 0.14, 0.38, false),   // top-left
    hit(0.7, 1, 0.14, 0.38, false),   // top-right
    hit(0.3, 0.7, 0.38, 0.62, true),  // middle
    hit(0, 0.3, 0.62, 0.86, false),   // bottom-left
    hit(0.7, 1, 0.62, 0.86, false),   // bottom-right
    hit(0.3, 0.7, 0.78, 1, true),     // bottom
  ];
}

/** Match measured segment fills against the digit patterns. */
export function classifySegments(fill: number[]): { char: string; score: number; alternative?: string } {
  const scored = DIGIT_PATTERNS.map((p) => {
    let s = 0;
    for (let i = 0; i < 7; i++) s += p.on[i] ? fill[i] : 1 - fill[i];
    return { digit: p.digit, score: s / 7 };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runner = scored.find((s) => s.digit !== best.digit)!;
  return {
    char: best.digit,
    score: best.score,
    alternative: best.score - runner.score < 0.08 ? runner.digit : undefined,
  };
}

/**
 * Read the numbers on a binarised display. Returns lines top to bottom.
 */
export function detectNumbers(mask: Mask, cfg: ProcessingConfig): DetectedLine[] {
  const { labels, components } = connectedComponents(mask);
  const lines: DetectedLine[] = [];
  for (const band of findBands(mask, cfg)) {
    const line = readBand(mask, labels, components, band, cfg);
    if (line) lines.push(line);
  }
  // Keep the most prominent lines (by digit height), but report them top to bottom.
  const kept = [...lines].sort((a, b) => b.digitHeight - a.digitHeight).slice(0, cfg.maxLines);
  return lines.filter((l) => kept.includes(l));
}

function readBand(mask: Mask, labels: Int32Array, comps: Component[], band: Band, cfg: ProcessingConfig): DetectedLine | null {
  const bandH = band.y1 - band.y0;
  // Components that belong to this line: mostly inside the band vertically.
  const members = comps.filter((c) => {
    const ov = Math.min(c.y + c.height, band.y1) - Math.max(c.y, band.y0);
    return ov > 0 && ov >= c.height * 0.7 && c.height <= bandH * 1.2;
  });
  if (!members.length) return null;

  // Decimal-point candidates: small compact blobs sitting in the lower part of the line.
  const dotMax = bandH * 0.24;
  const isDot = (c: Component) =>
    c.height <= dotMax && c.width <= dotMax && c.height >= bandH * 0.04 &&
    c.width / c.height < 2.2 && c.height / c.width < 2.2 &&
    c.area / (c.width * c.height) > 0.4 &&
    c.y + c.height > band.y0 + bandH * 0.65;
  const dots = members.filter(isDot);
  const parts = members.filter((c) => !isDot(c));
  if (!parts.length) return null;

  // Local mask holding only this line's digit parts.
  const x0 = Math.min(...members.map((c) => c.x));
  const x1 = Math.max(...members.map((c) => c.x + c.width));
  const pad = Math.ceil(bandH * cfg.maxShear) + 2;
  const W = x1 - x0 + pad * 2, H = bandH;
  const local: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
  const partLabels = new Set(parts.map((c) => c.label));
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (band.y0 + y) * mask.width + x;
      if (mask.data[i] && partLabels.has(labels[i])) local.data[y * W + (x - x0 + pad)] = 1;
    }
  }
  const s = estimateShear(local, cfg.maxShear);
  const straight = shear(local, s);

  // Column runs → digit cells.
  const col = new Array<number>(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) col[x] += straight.data[y * W + x];
  const runs: Array<{ a: number; b: number }> = [];
  let a = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && col[x] > 0;
    if (on && a < 0) a = x;
    if (!on && a >= 0) { runs.push({ a, b: x }); a = -1; }
  }
  // Merge runs separated by a hairline gap (split segments inside one digit).
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.a - last.b <= Math.max(1, bandH * 0.03)) last.b = r.b; else merged.push({ ...r });
  }

  const cy = (H - 1) / 2;
  const unshearX = (x: number, y: number) => x - Math.round(s * (y - cy)) - pad + x0;

  type Cell = { a: number; b: number; top: number; bottom: number };
  const cells: Cell[] = [];
  for (const r of merged) {
    let top = H, bottom = -1;
    for (let y = 0; y < H; y++) {
      for (let x = r.a; x < r.b; x++) if (straight.data[y * W + x]) { if (y < top) top = y; if (y > bottom) bottom = y; break; }
    }
    if (bottom < 0) continue;
    const h = bottom - top + 1;
    if (h < bandH * 0.6) continue; // fragments and minus signs are not digits
    cells.push({ a: r.a, b: r.b, top, bottom: bottom + 1 });
  }
  if (!cells.length) return null;

  // Real digits share a top and bottom edge; stray marks (glare streaks, bezel
  // fragments) rarely line up with them.
  // Photos taken at an angle make digit height change across the line, so the
  // edges are fitted as lines (Theil–Sen: robust to the odd stray cell).
  if (cells.length >= 3) {
    const cx = cells.map((c) => (c.a + c.b) / 2);
    const fit = (ys: number[]) => {
      const slopes: number[] = [];
      for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) slopes.push((ys[j] - ys[i]) / (cx[j] - cx[i] || 1));
      const m = median(slopes);
      const b = median(ys.map((y, i) => y - m * cx[i]));
      return (x: number) => b + m * x;
    };
    const topAt = fit(cells.map((c) => c.top));
    const bottomAt = fit(cells.map((c) => c.bottom));
    const tol = median(cells.map((c) => c.bottom - c.top)) * 0.08;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (Math.abs(cells[i].top - topAt(cx[i])) > tol || Math.abs(cells[i].bottom - bottomAt(cx[i])) > tol) cells.splice(i, 1);
    }
  }
  if (!cells.length) return null;

  // Keep the main cluster of digits: split where the gap is much larger than a digit pitch.
  const digitH = median(cells.map((c) => c.bottom - c.top));
  const clusters: Cell[][] = [[cells[0]]];
  for (let i = 1; i < cells.length; i++) {
    if (cells[i].a - cells[i - 1].b > digitH * 0.8) clusters.push([]);
    clusters[clusters.length - 1].push(cells[i]);
  }
  const main = clusters.reduce((p, c) => (c.length > p.length ? c : p));
  const typicalW = median(main.filter((c) => c.b - c.a > digitH * 0.35).map((c) => c.b - c.a)) || digitH * 0.55;

  const digits: DetectedDigit[] = main.map((c) => {
    const w = c.b - c.a, h = c.bottom - c.top;
    let res: { char: string; score: number; alternative?: string };
    if (w < h * 0.3 || w < typicalW * 0.5) {
      // A lone vertical bar: the digit 1 (only the right-hand segments are lit).
      res = { char: '1', score: 0.9 };
    } else {
      res = classifySegments(segmentFill(straight, c.a, c.b, c.top, c.bottom));
    }
    if (res.score < cfg.minDigitScore) res = { ...res, char: '?' };
    const bx0 = Math.min(unshearX(c.a, c.top), unshearX(c.a, c.bottom));
    const bx1 = Math.max(unshearX(c.b, c.top), unshearX(c.b, c.bottom));
    return { ...res, box: { x: bx0, y: band.y0 + c.top, width: bx1 - bx0, height: h } };
  });

  // Decimal point: the dot candidate lying between two digits of the main cluster.
  let decimalIndex = -1;
  let bestDot = Infinity;
  for (const d of dots) {
    const dcx = d.x + d.width / 2, dcy = d.y + d.height / 2 - band.y0;
    const sx = dcx - x0 + pad + Math.round(s * (dcy - cy)); // into straightened coords
    for (let i = 1; i < main.length; i++) {
      if (sx > main[i - 1].b - typicalW * 0.25 && sx < main[i].a + typicalW * 0.25) {
        const dist = Math.abs(d.y + d.height - (band.y0 + main[i].bottom));
        if (dist < bestDot) { bestDot = dist; decimalIndex = i; }
      }
    }
  }

  const text = digits.map((d, i) => (i === decimalIndex ? '.' : '') + d.char).join('');
  const bx = Math.min(...digits.map((d) => d.box.x));
  const by = Math.min(...digits.map((d) => d.box.y));
  const bx2 = Math.max(...digits.map((d) => d.box.x + d.box.width));
  const by2 = Math.max(...digits.map((d) => d.box.y + d.box.height));
  return {
    text,
    digits,
    decimalIndex,
    box: { x: bx, y: by, width: bx2 - bx, height: by2 - by },
    digitHeight: digitH,
    confidence: digits.reduce((s2, d) => s2 + (d.char === '?' ? 0 : d.score), 0) / digits.length,
  };
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
