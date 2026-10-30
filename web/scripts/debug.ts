/**
 * Development aid: dump intermediate pipeline images for each test photo.
 * Usage: tsx scripts/debug.ts <outDir> [image ...]
 */
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadRgba } from './loadImage.ts';
import { DEFAULT_CONFIG } from '../src/processor/config.ts';
import { binarizeDisplay, cropDisplay, findDisplay, normalize } from '../src/processor/ImagePreprocessor.ts';

const out = process.argv[2];
const files = process.argv.length > 3
  ? process.argv.slice(3)
  : readdirSync('../images').map((f) => join('../images', f));

for (const f of files) {
  const img = await loadRgba(f);
  const { gray } = normalize(img.data, img.width, img.height, DEFAULT_CONFIG);
  const region = findDisplay(gray);
  const disp = cropDisplay(gray, region);
  const mask = binarizeDisplay(disp, DEFAULT_CONFIG);
  const vis = Buffer.alloc(mask.data.length);
  for (let i = 0; i < vis.length; i++) vis[i] = mask.data[i] ? 0 : 255;
  const name = basename(f).replace(/\.\w+$/, '');
  await sharp(Buffer.from(disp.data), { raw: { width: disp.width, height: disp.height, channels: 1 } }).png().toFile(join(out, `${name}_disp.png`));
  await sharp(vis, { raw: { width: mask.width, height: mask.height, channels: 1 } }).png().toFile(join(out, `${name}_mask.png`));
  console.log(name, region.found, region.rect);
}
