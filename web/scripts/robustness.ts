/**
 * Robustness check: re-run the regression photos under simple distortions
 * (scale, small rotation, blur, darkening, heavy JPEG compression).
 * The detector was tuned on the original 8 photos, so this is a rough guard
 * against over-fitting, not a substitute for new real photos.
 * Usage: npm run robustness
 */
import sharp, { type Sharp } from 'sharp';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processRgba } from '../src/processor/ImageProcessor.ts';

const here = new URL('.', import.meta.url).pathname;
const IMAGES = join(here, '../../images');
const expected = JSON.parse(readFileSync(join(here, '../test/fixtures/expected.json'), 'utf8'));

type Variant = { name: string; apply: (s: Sharp, w: number) => Sharp };
const variants: Variant[] = [
  { name: 'original', apply: (s) => s },
  { name: 'half size', apply: (s, w) => s.resize(Math.round(w / 2)) },
  { name: 'double size', apply: (s, w) => s.resize(w * 2) },
  { name: 'rotate +3°', apply: (s) => s.rotate(3, { background: '#444' }) },
  { name: 'rotate -3°', apply: (s) => s.rotate(-3, { background: '#444' }) },
  { name: 'blur', apply: (s) => s.blur(1.5) },
  { name: 'darker', apply: (s) => s.modulate({ brightness: 0.6 }) },
  { name: 'jpeg q30', apply: (s) => s.jpeg({ quality: 30 }) },
];

let total = 0, correct = 0, wrongUnflagged = 0;
const lines: string[] = [];
for (const v of variants) {
  let ok = 0, n = 0, bad = 0;
  for (const f of readdirSync(IMAGES).sort()) {
    if (!expected[f]) continue;
    const meta = await sharp(join(IMAGES, f)).metadata();
    const buf = await v.apply(sharp(join(IMAGES, f)), meta.width!).toBuffer();
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = processRgba(new Uint8Array(data), info.width, info.height, f);
    const val = (id?: string) => r.values.find((x) => x.id === id)?.value ?? null;
    const good = val(r.fields.amount) === expected[f].amount && val(r.fields.volume) === expected[f].volume;
    n++; if (good) ok++;
    if (!good && r.status === 'ok') bad++;
  }
  total += n; correct += ok; wrongUnflagged += bad;
  lines.push(`${v.name.padEnd(12)} ${ok}/${n} correct, ${bad} wrong without a review flag`);
}
console.log(lines.join('\n'));
console.log(`\noverall: ${correct}/${total} correct, ${wrongUnflagged} wrong without a review flag`);
