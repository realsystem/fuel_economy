/**
 * Tunable processing parameters. Everything the pipeline uses that is not a
 * pure geometric ratio lives here, so it can be adjusted without touching the
 * algorithm code (and so tests can exercise alternatives).
 */
export interface ProcessingConfig {
  /** Images are scaled so their longer side is this many pixels before analysis. */
  workingSize: number;
  /** Adaptive threshold block size, as a fraction of the display height. */
  thresholdBlockFraction: number;
  /** Adaptive threshold offset (grey levels below local mean to count as ink). */
  thresholdOffset: number;
  /** A text line must be at least this fraction of the display height. */
  minLineHeightFraction: number;
  /** Maximum number of numeric lines to read from one display. */
  maxLines: number;
  /** Shear search range for italic digits (|shear| <= this). */
  maxShear: number;
  /** Digit candidates whose decode score is below this are reported as unknown. */
  minDigitScore: number;
  /** Plausible unit-price range used only to judge confidence, never to change values. */
  plausibleUnitPrice: { min: number; max: number };
  /** Per-image processing timeout in milliseconds (enforced by the service). */
  timeoutMs: number;
}

export const DEFAULT_CONFIG: ProcessingConfig = {
  workingSize: 900,
  thresholdBlockFraction: 0.25,
  thresholdOffset: 12,
  minLineHeightFraction: 0.12,
  maxLines: 3,
  maxShear: 0.35,
  minDigitScore: 0.6,
  plausibleUnitPrice: { min: 0.5, max: 15 },
  timeoutMs: 20000,
};

export function resolveConfig(partial?: Partial<ProcessingConfig>): ProcessingConfig {
  return { ...DEFAULT_CONFIG, ...(partial ?? {}) };
}
