import type { ProcessingConfig } from '../processor/config.ts';
import type { ProcessingResult } from '../models/ProcessingResult.ts';

export type WorkerRequest =
  | { type: 'ping'; id: number }
  | { type: 'process'; id: number; blob: Blob; name: string; config?: Partial<ProcessingConfig> };

export type WorkerResponse =
  | { type: 'pong'; id: number; ok: boolean }
  | { type: 'result'; id: number; result: ProcessingResult };
