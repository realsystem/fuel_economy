import type { ProcessingError } from '../models/ProcessingError.ts';
import { processingError } from '../models/ProcessingError.ts';

export interface ValidationOptions {
  maxBytes: number;
}

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Minimal shape of a File, so this can be unit-tested without a browser. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/**
 * Validate a file before processing. Corrupt files that pass this check are
 * caught later, when decoding fails.
 */
export function validateImageFile(file: FileLike, opts: ValidationOptions = { maxBytes: DEFAULT_MAX_BYTES }): ProcessingError | null {
  const name = file.name.toLowerCase();
  const typeOk = (ACCEPTED_TYPES as readonly string[]).includes(file.type);
  // Some browsers report an empty type; fall back to the extension then.
  const extOk = ACCEPTED_EXTENSIONS.some((e) => name.endsWith(e));
  if (!(typeOk || (!file.type && extOk))) {
    return processingError('unsupported_type', `${file.name}: unsupported file type. Use JPEG, PNG or WebP.`);
  }
  if (file.size === 0) {
    return processingError('decode_failed', `${file.name}: the file is empty.`);
  }
  if (file.size > opts.maxBytes) {
    return processingError('too_large', `${file.name}: ${formatBytes(file.size)} is larger than the ${formatBytes(opts.maxBytes)} limit.`);
  }
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
