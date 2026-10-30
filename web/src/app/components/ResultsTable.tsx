import { useEffect, useState } from 'react';
import {
  effectiveValue, valueSource, type FieldValue, type FuelField, type FuelRecord, type RecordStatus,
} from '../../models/FuelRecord.ts';
import { canConfirm } from '../../services/RecordService.ts';
import { FIELD_DECIMALS, formatFixed, parseNumber } from '../../utils/numberFormatting.ts';

interface Props {
  records: FuelRecord[];
  urls: Map<string, string>;
  busy: boolean;
  onEdit: (id: string, field: FuelField, value: number | null) => void;
  onConfirm: (id: string, confirmed: boolean) => void;
  onReprocess: (id: string) => void;
  onRemove: (id: string) => void;
  onView: (id: string) => void;
}

const STATUS_LABEL: Record<RecordStatus, string> = {
  queued: 'Waiting',
  processing: 'Processing…',
  review: 'Review',
  detected: 'Detected',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

const COLUMNS: Array<{ field: FuelField; label: string }> = [
  { field: 'volume', label: 'Fuel volume' },
  { field: 'amount', label: 'Total amount' },
  { field: 'unitPrice', label: 'Unit price' },
];

export function ResultsTable(props: Props) {
  const { records, urls, busy } = props;
  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            <th>Image</th>
            {COLUMNS.map((c) => <th key={c.field} className="num">{c.label}</th>)}
            <th>Status</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className={`row row--${r.status}`}>
              <td data-label="Image">
                <button type="button" className="img-cell" onClick={() => props.onView(r.id)} title="Inspect the original photo">
                  <img src={urls.get(r.id)} alt="" loading="lazy" />
                  <span className="img-cell__name">{r.fileName}</span>
                </button>
              </td>
              {COLUMNS.map((c) => (
                <td key={c.field} data-label={c.label} className="num">
                  <FieldCell
                    value={r[c.field]}
                    decimals={FIELD_DECIMALS[c.field]}
                    disabled={r.status === 'processing' || r.status === 'queued'}
                    label={`${c.label} for ${r.fileName}`}
                    onChange={(v) => props.onEdit(r.id, c.field, v)}
                  />
                </td>
              ))}
              <td data-label="Status">
                <span className={`badge badge--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                {r.note ? <div className="note" title={r.note}>{r.note}</div> : null}
              </td>
              <td className="actions">
                {r.status === 'confirmed' ? (
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => props.onConfirm(r.id, false)}>Unconfirm</button>
                ) : (
                  <button type="button" className="btn btn--small" disabled={!canConfirm(r) || r.status === 'processing'}
                    onClick={() => props.onConfirm(r.id, true)}>Confirm</button>
                )}
                <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => props.onReprocess(r.id)}>Reprocess</button>
                <button type="button" className="icon-btn" aria-label={`Remove ${r.fileName}`} disabled={r.status === 'processing'}
                  onClick={() => props.onRemove(r.id)}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function confidenceLevel(f: FieldValue): 'high' | 'medium' | 'low' {
  return f.confidence >= 0.85 ? 'high' : f.confidence >= 0.6 ? 'medium' : 'low';
}

interface CellProps {
  value: FieldValue;
  decimals: number;
  disabled: boolean;
  label: string;
  onChange: (v: number | null) => void;
}

/**
 * Editable number. Shows where the value came from: detected (with a
 * confidence dot), edited by the user, calculated, or missing. Clearing the
 * box returns to the detected value; the detection itself is never lost.
 */
function FieldCell({ value, decimals, disabled, label, onChange }: CellProps) {
  const eff = effectiveValue(value);
  const source = valueSource(value);
  const shown = formatFixed(eff, decimals);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(shown); setInvalid(false); }, [shown]);

  const commit = () => {
    if (draft.trim() === '') {
      // Clearing the box removes the user's correction.
      setInvalid(false);
      if (value.corrected !== null) onChange(null); else setDraft(shown);
      return;
    }
    const n = parseNumber(draft);
    if (n === null) { setInvalid(true); return; }
    setInvalid(false);
    if (formatFixed(n, decimals) !== shown) onChange(n);
    else setDraft(shown);
  };

  const detectedInfo = value.detected !== null
    ? `Detected: ${value.detectedText ?? value.detected} (confidence ${Math.round(value.confidence * 100)}%)`
    : 'Not detected';
  const title = source === 'user' ? `Edited. ${detectedInfo}` : source === 'derived' ? 'Calculated as amount ÷ volume' : detectedInfo;

  return (
    <div className={`field field--${source}${invalid ? ' field--invalid' : ''}`} title={title}>
      {source === 'detected' ? <span className={`dot dot--${confidenceLevel(value)}`} aria-hidden="true" /> : null}
      <input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        value={draft}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {source === 'user' ? <span className="tag tag--user">edited</span> : null}
      {source === 'derived' ? <span className="tag tag--derived">calc</span> : null}
      {source === 'detected' && confidenceLevel(value) !== 'high' ? <span className="tag tag--warn">check</span> : null}
    </div>
  );
}
