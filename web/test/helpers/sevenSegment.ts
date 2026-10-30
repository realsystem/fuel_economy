/**
 * Renders synthetic 7-segment displays (dark segments on a light panel inside a
 * darker bezel) as RGBA, so the detector can be tested on numbers that are not
 * in the photo set.
 */
import { DIGIT_PATTERNS } from '../../src/processor/NumberDetector.ts';

export interface RenderOptions {
  /** Lines of text, e.g. ["45.67", "12.345"]. */
  lines: string[];
  /** Digit height per line in pixels. */
  heights?: number[];
  width?: number;
  height?: number;
  /** Italic slant: x offset per pixel of height (positive leans right). */
  slant?: number;
  panel?: [number, number, number];
}

export function renderDisplay(o: RenderOptions): { data: Uint8Array; width: number; height: number } {
  const W = o.width ?? 640, H = o.height ?? 400;
  const panel = o.panel ?? [235, 225, 170];
  const data = new Uint8Array(W * H * 4);
  // Bezel
  for (let i = 0; i < W * H; i++) { data[i * 4] = 60; data[i * 4 + 1] = 62; data[i * 4 + 2] = 66; data[i * 4 + 3] = 255; }
  const px = Math.round(W * 0.08), py = Math.round(H * 0.1), pw = W - px * 2, ph = H - py * 2;
  const fill = (x0: number, y0: number, w: number, h: number, c: [number, number, number]) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y0 + h)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x0 + w)); x++) {
        const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
      }
  };
  fill(px, py, pw, ph, panel);

  const slant = o.slant ?? 0;
  const ink: [number, number, number] = [25, 25, 25];
  const gapY = ph * 0.08;
  const heights = o.heights ?? o.lines.map((_, i) => (i === 0 ? ph * 0.38 : ph * 0.28));
  let y = py + ph * 0.1;
  for (let li = 0; li < o.lines.length; li++) {
    const dh = heights[li];
    const dw = dh * 0.55, t = Math.max(2, dh * 0.12), pitch = dw * 1.3;
    const chars = o.lines[li];
    const nDigits = chars.replace('.', '').length;
    let x = px + pw - pw * 0.06 - nDigits * pitch; // right-aligned
    for (const ch of chars) {
      if (ch === '.') {
        // Centred in the gap between digits, on the baseline.
        drawRect(fill, x - (pitch - dw) / 2 - t / 2, y + dh - t, t, t, slant, y, dh, ink);
        continue;
      }
      const pat = DIGIT_PATTERNS.find((p) => p.digit === ch)!.on;
      // Like real LCD glyphs, vertical segments reach the corners (mitred joins),
      // so digits without a top or bottom bar (1, 4, 7) still span the full height.
      const g = Math.max(1, t * 0.25); // hairline gap between segments
      const segs: Array<[number, number, number, number]> = [
        [t + g, 0, dw - 2 * t - 2 * g, t],                 // top
        [0, 0, t, dh / 2 - g],                             // top-left
        [dw - t, 0, t, dh / 2 - g],                        // top-right
        [t + g, dh / 2 - t / 2, dw - 2 * t - 2 * g, t],    // middle
        [0, dh / 2 + g, t, dh / 2 - g],                    // bottom-left
        [dw - t, dh / 2 + g, t, dh / 2 - g],               // bottom-right
        [t + g, dh - t, dw - 2 * t - 2 * g, t],            // bottom
      ];
      segs.forEach((s, i) => { if (pat[i]) drawRect(fill, x + s[0], y + s[1], s[2], s[3], slant, y, dh, ink); });
      x += pitch;
    }
    y += dh + gapY;
  }
  return { data, width: W, height: H };
}

/** Draw a rectangle row by row, shifting rows to produce an italic slant. */
function drawRect(
  fill: (x: number, y: number, w: number, h: number, c: [number, number, number]) => void,
  x: number, y: number, w: number, h: number, slant: number, lineTop: number, lineH: number, c: [number, number, number],
) {
  for (let yy = Math.floor(y); yy < y + h; yy++) {
    const off = slant * (lineTop + lineH / 2 - yy);
    fill(x + off, yy, w, 1, c);
  }
}
