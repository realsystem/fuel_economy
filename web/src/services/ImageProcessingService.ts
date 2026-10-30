/**
 * The boundary between the UI and image processing. The UI only ever talks
 * to this interface, never to the detection code directly.
 *
 * Providers:
 *  - BrowserSegmentProcessor (implemented): runs the detector in a Web Worker.
 *  - RemoteProcessingService (future): would upload the image to a job API,
 *    for example a `fuel_ocr` job type on the realsystem/processor control
 *    plane, poll for completion and return the same ProcessingResult.
 *
 * Contract: processImage never rejects for per-image problems. Failures come
 * back as a ProcessingResult with status 'error' and an `error`, so one bad
 * image never stops a batch.
 */
import type { ProcessingConfig } from '../processor/config.ts';
import type { ProcessingResult } from '../models/ProcessingResult.ts';

export interface ProcessingOptions {
  config?: Partial<ProcessingConfig>;
  /** Abort processing of this image. */
  signal?: AbortSignal;
}

export interface ImageProcessingService {
  /** Identifier of the provider, e.g. "browser-segment". */
  readonly id: string;
  processImage(image: Blob & { name?: string }, options?: ProcessingOptions): Promise<ProcessingResult>;
  /** Release workers and other resources. */
  dispose(): void;
}
