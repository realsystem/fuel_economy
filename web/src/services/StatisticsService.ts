/**
 * Statistics over fuel records. Independent of image processing: it only
 * needs records, so later features (history, multiple vehicles) can reuse it.
 *
 * Totals are reported twice:
 *  - confirmed: only records the user confirmed (the trustworthy figures)
 *  - provisional: confirmed plus detected-but-unconfirmed records
 * Records still needing review are never included in either.
 */
import { effectiveValue, type FuelRecord } from '../models/FuelRecord.ts';

export interface Totals {
  records: number;
  totalVolume: number;
  totalAmount: number;
  /** Volume-weighted: total amount / total volume. Null when there is no volume. */
  averageUnitPrice: number | null;
  averageVolume: number | null;
}

export interface Statistics {
  imagesProcessed: number;
  successfulDetections: number;
  needsReview: number;
  failed: number;
  confirmedCount: number;
  confirmed: Totals;
  provisional: Totals;
}

function usable(r: FuelRecord): { amount: number; volume: number } | null {
  const amount = effectiveValue(r.amount);
  const volume = effectiveValue(r.volume);
  if (amount === null || volume === null || !(amount > 0) || !(volume > 0)) return null;
  return { amount, volume };
}

export function totals(records: FuelRecord[]): Totals {
  let totalVolume = 0, totalAmount = 0, n = 0;
  for (const r of records) {
    const u = usable(r);
    if (!u) continue;
    totalVolume += u.volume;
    totalAmount += u.amount;
    n++;
  }
  return {
    records: n,
    totalVolume,
    totalAmount,
    averageUnitPrice: totalVolume > 0 ? totalAmount / totalVolume : null,
    averageVolume: n > 0 ? totalVolume / n : null,
  };
}

export function computeStatistics(records: FuelRecord[]): Statistics {
  const processed = records.filter((r) => r.result !== null);
  const successful = processed.filter((r) => r.amount.detected !== null && r.volume.detected !== null && r.result?.status !== 'error');
  const confirmed = records.filter((r) => r.status === 'confirmed');
  const provisional = records.filter((r) => r.status === 'confirmed' || r.status === 'detected');
  return {
    imagesProcessed: processed.length,
    successfulDetections: successful.length,
    needsReview: records.filter((r) => r.status === 'review').length,
    failed: records.filter((r) => r.status === 'failed').length,
    confirmedCount: confirmed.length,
    confirmed: totals(confirmed),
    provisional: totals(provisional),
  };
}
