/**
 * In-browser processing provider: runs the 7-segment detector in a Web
 * Worker. Timeouts and cancellation terminate the worker (the only way to stop
 * CPU-bound work); a fresh worker is started for the next image.
 *
 * If a worker cannot be started (old browser, no OffscreenCanvas in workers)
 * it falls back to processing on the main thread, which still works but can
 * make the page stutter while an image is processed.
 */
import type { ImageProcessingService, ProcessingOptions } from './ImageProcessingService.ts';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol.ts';
import { emptyResult, type ProcessingResult } from '../models/ProcessingResult.ts';
import { processingError, type ProcessingErrorCode } from '../models/ProcessingError.ts';
import { resolveConfig } from '../processor/config.ts';
import { PROCESSOR_ID } from '../processor/ImageProcessor.ts';

type Mode = 'unknown' | 'worker' | 'main-thread';

export class BrowserSegmentProcessor implements ImageProcessingService {
  readonly id = 'browser-segment';
  private worker: Worker | null = null;
  private mode: Mode = 'unknown';
  private nextId = 1;

  constructor(private readonly workerUrl: string | URL) {}

  /** 'worker' or 'main-thread' once the first image has been processed. */
  get executionMode(): Mode {
    return this.mode;
  }

  async processImage(image: Blob & { name?: string }, options: ProcessingOptions = {}): Promise<ProcessingResult> {
    const name = image.name ?? 'image';
    const cfg = resolveConfig(options.config);
    if (options.signal?.aborted) return this.failed(name, 'cancelled', 'Processing was cancelled.');

    if (this.mode !== 'main-thread') {
      const worker = await this.getWorker();
      if (worker) return this.runInWorker(worker, image, name, options);
    }
    // Fallback: same code on the main thread.
    const { runOnBlob } = await import('../processor/runOnBlob.ts');
    const result = await runOnBlob(image, name, cfg);
    result.warnings.push('Processed on the main thread because a background worker was not available.');
    return result;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private async getWorker(): Promise<Worker | null> {
    if (this.worker) return this.worker;
    try {
      const w = new Worker(this.workerUrl, { type: 'module' });
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 5000);
        w.onmessage = (e: MessageEvent<WorkerResponse>) => {
          if (e.data.type === 'pong') { clearTimeout(t); resolve(e.data.ok); }
        };
        w.onerror = () => { clearTimeout(t); resolve(false); };
        w.postMessage({ type: 'ping', id: 0 } satisfies WorkerRequest);
      });
      if (!ok) { w.terminate(); this.mode = 'main-thread'; return null; }
      this.worker = w;
      this.mode = 'worker';
      return w;
    } catch {
      this.mode = 'main-thread';
      return null;
    }
  }

  private runInWorker(worker: Worker, blob: Blob, name: string, options: ProcessingOptions): Promise<ProcessingResult> {
    const id = this.nextId++;
    const cfg = resolveConfig(options.config);
    return new Promise<ProcessingResult>((resolve) => {
      let settled = false;
      const finish = (r: ProcessingResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve(r);
      };
      const kill = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'result' && e.data.id === id) finish(e.data.result);
      };
      const onError = () => { kill(); finish(this.failed(name, 'internal', `${name}: the processor stopped unexpectedly.`)); };
      const onAbort = () => { kill(); finish(this.failed(name, 'cancelled', 'Processing was cancelled.')); };
      const timer = setTimeout(() => {
        kill();
        finish(this.failed(name, 'timeout', `${name}: processing took longer than ${Math.round(cfg.timeoutMs / 1000)} s and was stopped.`));
      }, cfg.timeoutMs);

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      options.signal?.addEventListener('abort', onAbort);
      worker.postMessage({ type: 'process', id, blob, name, config: options.config } satisfies WorkerRequest);
    });
  }

  private failed(name: string, code: ProcessingErrorCode, message: string): ProcessingResult {
    const r = emptyResult(name, PROCESSOR_ID);
    r.error = processingError(code, message);
    return r;
  }
}
