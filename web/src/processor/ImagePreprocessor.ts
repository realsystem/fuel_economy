/**
 * Image loading normalisation and display localisation.
 *
 * Mirrors the first half of the original pump_ocr.py pipeline:
 *   grayscale → locate the LCD "screen" → crop → adaptive threshold
 * The original located the screen as the largest Canny contour; here the
 * screen is located as the largest bright, rectangular-ish region, which is
 * scale independent and does not need Canny tuning.
 */
import type { ProcessingConfig } from './config.ts';
import {
  adaptiveThresholdDark, connectedComponents, crop, eraseComponents, invert, otsuThreshold, sauvolaThresholdDark,
  resize, rgbaToValue, thresholdBright, type GrayImage, type Mask, type Rect,
} from './image.ts';

export interface NormalizedImage {
  gray: GrayImage;
  /** Factor from working coordinates back to original image coordinates. */
  scaleToOriginal: number;
}

export function normalize(
  rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, cfg: ProcessingConfig,
): NormalizedImage {
  const gray = rgbaToValue(rgba, width, height);
  const scale = cfg.workingSize / Math.max(width, height);
  if (Math.abs(scale - 1) < 0.05) return { gray, scaleToOriginal: 1 };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { gray: resize(gray, w, h), scaleToOriginal: 1 / scale };
}

export interface DisplayRegion {
  rect: Rect;
  /** True when a distinct display was found; false means the whole frame is used. */
  found: boolean;
}

/**
 * Find the backlit display: the largest bright connected region whose
 * bounding box is reasonably filled and not a thin strip.
 */
export function findDisplay(gray: GrayImage): DisplayRegion {
  const whole: Rect = { x: 0, y: 0, width: gray.width, height: gray.height };
  const t = otsuThreshold(gray);
  // Otsu splits into <= t and > t.
  const bright = thresholdBright(gray, t + 1);
  const { components } = connectedComponents(bright);
  const imgArea = gray.width * gray.height;
  let best: Rect | null = null;
  let bestScore = 0;
  for (const c of components) {
    const boxArea = c.width * c.height;
    if (boxArea < imgArea * 0.04) continue;
    const aspect = c.width / c.height;
    if (aspect < 0.6 || aspect > 6) continue;
    const fill = c.area / boxArea;
    if (fill < 0.35) continue;
    const score = boxArea * fill;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return { rect: whole, found: false };
  return { rect: { x: best.x, y: best.y, width: best.width, height: best.height }, found: true };
}

/**
 * How to separate digits from the backlight:
 *  - 'mean': adaptive mean threshold, as in pump_ocr.py (default)
 *  - 'sauvola': contrast-aware threshold, better under reflections and glare
 *  - '*-light': the same, for light digits on a dark display
 */
export type BinarizeMethod = 'mean' | 'sauvola' | 'mean-light' | 'sauvola-light';
export const FALLBACK_METHODS: readonly BinarizeMethod[] = ['sauvola', 'mean-light', 'sauvola-light'];

/**
 * Binarise the display so the digit segments become ink (1), then remove
 * blobs that cannot be part of a digit: anything touching the display edge
 * (bezel, glare borders) or spanning most of its width or height (frame
 * lines, the coloured strip some pumps have at the side of the LCD).
 */
export function binarizeDisplay(display: GrayImage, cfg: ProcessingConfig, method: BinarizeMethod = 'mean'): Mask {
  const block = Math.max(15, Math.round(display.height * cfg.thresholdBlockFraction)) | 1;
  // Light-on-dark displays: invert so the digits become the dark ink.
  const src = method.endsWith('-light') ? invert(display) : display;
  const mask = method.startsWith('sauvola')
    ? sauvolaThresholdDark(src, block)
    : adaptiveThresholdDark(src, block, cfg.thresholdOffset);
  const { labels, components } = connectedComponents(mask);
  const drop = new Set<number>();
  const W = display.width, H = display.height;
  for (const c of components) {
    const touches = c.x <= 1 || c.y <= 1 || c.x + c.width >= W - 1 || c.y + c.height >= H - 1;
    const spans = c.height > H * 0.55 || c.width > W * 0.7;
    const speck = c.area < Math.max(4, (W * H) * 0.00004);
    // Frame lines and glare streaks: long, thin and sparse compared with a digit segment.
    const longSide = Math.max(c.width, c.height), shortSide = Math.min(c.width, c.height);
    const frameLine = longSide / shortSide > 8 && (c.height > H * 0.3 || c.width > W * 0.3);
    const sparseFrame = c.area / (c.width * c.height) < 0.08 && (c.height > H * 0.3 || c.width > W * 0.3);
    if (touches || spans || speck || frameLine || sparseFrame) drop.add(c.label);
  }
  eraseComponents(mask, labels, drop);
  return mask;
}

/**
 * Candidate display regions, best guess first. A pump bezel is often light
 * grey, so the first bright region can be "bezel + LCD"; searching again
 * inside it isolates the LCD. The whole frame is the last resort. The image
 * processor reads every candidate and keeps the most convincing result.
 */
export function displayCandidates(gray: GrayImage): DisplayRegion[] {
  const out: DisplayRegion[] = [];
  const outer = findDisplay(gray);
  out.push(outer);
  if (outer.found) {
    const inner = findDisplay(crop(gray, outer.rect));
    const ratio = (inner.rect.width * inner.rect.height) / (outer.rect.width * outer.rect.height);
    if (inner.found && ratio > 0.2 && ratio < 0.92) {
      out.push({
        found: true,
        rect: { x: outer.rect.x + inner.rect.x, y: outer.rect.y + inner.rect.y, width: inner.rect.width, height: inner.rect.height },
      });
    }
    out.push({ found: false, rect: { x: 0, y: 0, width: gray.width, height: gray.height } });
  }
  return out;
}

export function cropDisplay(gray: GrayImage, region: DisplayRegion): GrayImage {
  return region.found ? crop(gray, region.rect) : gray;
}
