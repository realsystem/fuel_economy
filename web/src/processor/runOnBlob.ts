/**
 * Decode a Blob and run the detector on it. Shared by the worker and by the
 * main-thread fallback. Always resolves to a ProcessingResult.
 */
import { decodeImage } from './decode.ts';
import { processRgba, PROCESSOR_ID } from './ImageProcessor.ts';
import { resolveConfig, type ProcessingConfig } from './config.ts';
import { emptyResult, type ProcessingResult } from '../models/ProcessingResult.ts';
import { processingError } from '../models/ProcessingError.ts';

/** Decode at a bit more than the working size so the resize inside the pipeline stays high quality. */
const DECODE_OVERSAMPLE = 1.6;

export async function runOnBlob(blob: Blob, name: string, options?: Partial<ProcessingConfig>): Promise<ProcessingResult> {
  const cfg = resolveConfig(options);
  const started = Date.now();
  let decoded;
  try {
    decoded = await decodeImage(blob, Math.round(cfg.workingSize * DECODE_OVERSAMPLE));
  } catch {
    const r = emptyResult(name, PROCESSOR_ID);
    r.error = processingError('decode_failed', `${name}: the image could not be opened. It may be corrupt or in an unsupported format.`);
    r.durationMs = Date.now() - started;
    return r;
  }
  try {
    const result = processRgba(decoded.rgba, decoded.width, decoded.height, name, cfg);
    // Report geometry in original-image pixels.
    const k = decoded.originalWidth / decoded.width;
    if (k !== 1) {
      for (const v of result.values) {
        if (v.box) v.box = { x: Math.round(v.box.x * k), y: Math.round(v.box.y * k), width: Math.round(v.box.width * k), height: Math.round(v.box.height * k) };
      }
    }
    result.imageSize = { width: decoded.originalWidth, height: decoded.originalHeight };
    result.durationMs = Date.now() - started;
    return result;
  } catch (e) {
    const r = emptyResult(name, PROCESSOR_ID);
    r.error = processingError('internal', `${name}: ${e instanceof Error ? e.message : 'processing failed'}`);
    r.durationMs = Date.now() - started;
    return r;
  }
}
