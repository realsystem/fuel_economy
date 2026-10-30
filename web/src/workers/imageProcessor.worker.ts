/// <reference lib="webworker" />
/**
 * Web Worker hosting the detector so the page stays responsive.
 * Holds no state between messages.
 */
import { runOnBlob } from '../processor/runOnBlob.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'ping') {
    const ok = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
    ctx.postMessage({ type: 'pong', id: msg.id, ok } satisfies WorkerResponse);
    return;
  }
  if (msg.type === 'process') {
    const result = await runOnBlob(msg.blob, msg.name, msg.config);
    ctx.postMessage({ type: 'result', id: msg.id, result } satisfies WorkerResponse);
  }
};
