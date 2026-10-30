/**
 * CSV export of the current records. Exports values only: no images, no
 * image metadata, no bounding boxes.
 */
import { effectiveValue, isCorrected, valueSource, type FuelRecord } from '../models/FuelRecord.ts';
import { FIELD_DECIMALS, formatFixed } from '../utils/numberFormatting.ts';

export const CSV_COLUMNS = [
  'file_name',
  'fuel_volume',
  'amount',
  'unit_price',
  'unit_price_source',
  'detection_status',
  'record_status',
  'user_corrected',
  'processed_at',
] as const;

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function recordsToCsv(records: FuelRecord[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    rows.push([
      r.fileName,
      formatFixed(effectiveValue(r.volume), FIELD_DECIMALS.volume),
      formatFixed(effectiveValue(r.amount), FIELD_DECIMALS.amount),
      formatFixed(effectiveValue(r.unitPrice), FIELD_DECIMALS.unitPrice),
      valueSource(r.unitPrice),
      r.result?.status ?? 'not_processed',
      r.status,
      isCorrected(r) ? 'yes' : 'no',
      r.processedAt ?? '',
    ].map(csvCell).join(','));
  }
  // CRLF per RFC 4180; opens cleanly in spreadsheet apps.
  return rows.join('\r\n') + '\r\n';
}

export function csvFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `fuel-records-${d}.csv`;
}
