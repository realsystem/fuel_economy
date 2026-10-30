/**
 * Browser image decoding (worker or main thread). Decodes the file, scales it
 * down to at most `maxSide` pixels, and returns RGBA pixels. The full-size
 * bitmap is released straight away.
 */
export interface DecodedImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export async function decodeImage(blob: Blob, maxSide: number): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const ow = bitmap.width, oh = bitmap.height;
    if (!ow || !oh) throw new Error('empty image');
    const scale = Math.min(1, maxSide / Math.max(ow, oh));
    const w = Math.max(1, Math.round(ow * scale)), h = Math.max(1, Math.round(oh * scale));
    const ctx = makeContext(w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return { rgba: data, width: w, height: h, originalWidth: ow, originalHeight: oh };
  } finally {
    bitmap.close();
  }
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeContext(w: number, h: number): Ctx2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (c) return c;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    if (c) return c;
  }
  throw new Error('No 2D canvas available to decode images');
}
