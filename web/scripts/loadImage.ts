/** Node-only helper: decode an image file to RGBA with sharp (tests and scripts). */
import sharp from 'sharp';

export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}
