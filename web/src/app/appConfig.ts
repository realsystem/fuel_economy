import { DEFAULT_MAX_BYTES } from '../utils/imageValidation.ts';
import type { ProcessingConfig } from '../processor/config.ts';

/** Application-level settings. Change here rather than in components. */
export const APP_CONFIG = {
  /** Maximum accepted file size per image. */
  maxBytes: DEFAULT_MAX_BYTES,
  /** Maximum number of images in one session (keeps memory bounded on phones). */
  maxImages: 50,
  /** Overrides passed to the processor; empty means use processor defaults. */
  processing: {} as Partial<ProcessingConfig>,
  /** Where the Support button will point once a provider is chosen; null shows a placeholder. */
  supportUrl: null as string | null,
};
