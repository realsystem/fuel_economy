/**
 * Minimal image primitives used by the detection pipeline.
 *
 * These replace the handful of OpenCV calls the original Python scripts used
 * (cvtColor, resize, adaptiveThreshold, findContours / boundingRect,
 * projections). They operate on plain typed arrays, so the same code runs in a
 * Web Worker, in Node (tests) and could run server-side unchanged.
 */

/** Single-channel 8-bit image. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Binary mask: 1 = ink (foreground), 0 = background. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Component extends Rect {
  /** Number of foreground pixels. */
  area: number;
  /** Label id inside the label map. */
  label: number;
}

/**
 * RGBA → single channel. Uses the max of R,G,B ("value") rather than luma:
 * pump LCD backlights are often strongly coloured (blue, amber), and value
 * keeps the backlight bright while the dark segments stay dark.
 */
export function rgbaToValue(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    out[i] = r > g ? (r > b ? r : b) : g > b ? g : b;
  }
  return { width, height, data: out };
}

/** Bilinear resize (used for both up- and down-scaling at modest factors). */
export function resize(img: GrayImage, width: number, height: number): GrayImage {
  const out = new Uint8Array(width * height);
  const sx = img.width / width;
  const sy = img.height / height;
  // Area-average when shrinking a lot, to avoid aliasing thin LCD strokes.
  if (sx > 1.5 || sy > 1.5) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let sum = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < img.height; yy++) {
          const row = yy * img.width;
          for (let xx = x0; xx < x1 && xx < img.width; xx++) { sum += img.data[row + xx]; n++; }
        }
        out[y * width + x] = n ? Math.round(sum / n) : 0;
      }
    }
    return { width, height, data: out };
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      const a = img.data[y0 * img.width + x0], b = img.data[y0 * img.width + x1];
      const c = img.data[y1 * img.width + x0], d = img.data[y1 * img.width + x1];
      out[y * width + x] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy);
    }
  }
  return { width, height, data: out };
}

export function crop(img: GrayImage, r: Rect): GrayImage {
  const out = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const src = (r.y + y) * img.width + r.x;
    out.set(img.data.subarray(src, src + r.width), y * r.width);
  }
  return { width: r.width, height: r.height, data: out };
}

export function cropMask(m: Mask, r: Rect): Mask {
  return crop(m, r);
}

/** Otsu's threshold over a histogram of the image. */
export function otsuThreshold(img: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  const total = img.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/**
 * Adaptive mean threshold (cv2.ADAPTIVE_THRESH_MEAN_C, as in pump_ocr.py),
 * inverted so that pixels darker than their neighbourhood become ink (1).
 */
export function adaptiveThresholdDark(img: GrayImage, blockSize: number, c: number): Mask {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const half = Math.max(1, Math.floor(blockSize / 2));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const n = (x1 - x0) * (y1 - y0);
      const s = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      out[y * w + x] = data[y * w + x] < s / n - c ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Sauvola local threshold, inverted (dark ink = 1). The threshold follows
 * local contrast as well as local brightness, which helps where a
 * reflection lowers the contrast between segments and backlight.
 *   T = mean * (1 + k * (std / R - 1))
 */
export function sauvolaThresholdDark(img: GrayImage, blockSize: number, k = 0.25, R = 128): Mask {
  const { width: w, height: h, data } = img;
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  const sq = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      rs += v; rq += v * v;
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + rs;
      sq[(y + 1) * W1 + x + 1] = sq[y * W1 + x + 1] + rq;
    }
  }
  const half = Math.max(1, Math.floor(blockSize / 2));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const n = (x1 - x0) * (y1 - y0);
      const s = sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
      const q = sq[y1 * W1 + x1] - sq[y0 * W1 + x1] - sq[y1 * W1 + x0] + sq[y0 * W1 + x0];
      const mean = s / n;
      const std = Math.sqrt(Math.max(0, q / n - mean * mean));
      out[y * w + x] = data[y * w + x] < mean * (1 + k * (std / R - 1)) ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

export function invert(img: GrayImage): GrayImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - img.data[i];
  return { width: img.width, height: img.height, data: out };
}

/** Global threshold: pixels >= t become 1. */
export function thresholdBright(img: GrayImage, t: number): Mask {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] >= t ? 1 : 0;
  return { width: img.width, height: img.height, data: out };
}

/** 8-connected component labelling (two-pass with union-find). */
export function connectedComponents(m: Mask): { labels: Int32Array; components: Component[] } {
  const { width: w, height: h, data } = m;
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!data[i]) continue;
      let l = 0;
      const nb = [
        x > 0 ? labels[i - 1] : 0,
        y > 0 && x > 0 ? labels[i - w - 1] : 0,
        y > 0 ? labels[i - w] : 0,
        y > 0 && x < w - 1 ? labels[i - w + 1] : 0,
      ];
      for (const n of nb) {
        if (!n) continue;
        if (!l) l = n; else if (n !== l) union(l, n);
      }
      if (!l) { l = next++; parent.push(l); }
      labels[i] = l;
    }
  }
  const remap = new Map<number, Component>();
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const root = find(labels[i]);
    labels[i] = root;
    const x = i % w, y = (i - x) / w;
    let c = remap.get(root);
    if (!c) {
      c = { label: root, x, y, width: 1, height: 1, area: 0 };
      remap.set(root, c);
      (c as any)._x1 = x; (c as any)._y1 = y;
    }
    c.area++;
    if (x < c.x) c.x = x;
    if (y < c.y) c.y = y;
    if (x > (c as any)._x1) (c as any)._x1 = x;
    if (y > (c as any)._y1) (c as any)._y1 = y;
  }
  const components: Component[] = [];
  for (const c of remap.values()) {
    c.width = (c as any)._x1 - c.x + 1;
    c.height = (c as any)._y1 - c.y + 1;
    delete (c as any)._x1; delete (c as any)._y1;
    components.push(c);
  }
  return { labels, components };
}

/** Clear the pixels of the given component labels from a mask (in place). */
export function eraseComponents(m: Mask, labels: Int32Array, drop: Set<number>): void {
  if (!drop.size) return;
  for (let i = 0; i < m.data.length; i++) if (drop.has(labels[i])) m.data[i] = 0;
}

/** Morphological close (dilate then erode) with a square kernel; small radii only. */
export function close(m: Mask, radius: number): Mask {
  return erode(dilate(m, radius), radius);
}

export function dilate(m: Mask, radius: number): Mask {
  return morph(m, radius, true);
}

export function erode(m: Mask, radius: number): Mask {
  return morph(m, radius, false);
}

function morph(m: Mask, r: number, isDilate: boolean): Mask {
  if (r <= 0) return { width: m.width, height: m.height, data: m.data.slice() };
  const { width: w, height: h } = m;
  // Separable: horizontal pass then vertical pass.
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const p = xx < 0 || xx >= w ? (isDilate ? 0 : 1) : m.data[y * w + xx];
        if (isDilate ? p : !p) { v = isDilate ? 1 : 0; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const p = yy < 0 || yy >= h ? (isDilate ? 0 : 1) : tmp[yy * w + x];
        if (isDilate ? p : !p) { v = isDilate ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  }
  return { width: w, height: h, data: out };
}

/** Number of ink pixels in each row. */
export function rowProjection(m: Mask): number[] {
  const out = new Array<number>(m.height).fill(0);
  for (let y = 0; y < m.height; y++) {
    let s = 0;
    for (let x = 0; x < m.width; x++) s += m.data[y * m.width + x];
    out[y] = s;
  }
  return out;
}

/**
 * Horizontal shear about the vertical centre: x' = x + shear * (y - cy).
 * Used to straighten italic 7-segment digits before column segmentation.
 */
export function shear(m: Mask, s: number): Mask {
  const { width: w, height: h } = m;
  const cy = (h - 1) / 2;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const off = Math.round(s * (y - cy));
    for (let x = 0; x < w; x++) {
      const sx = x - off;
      if (sx >= 0 && sx < w) out[y * w + x] = m.data[y * w + sx];
    }
  }
  return { width: w, height: h, data: out };
}
