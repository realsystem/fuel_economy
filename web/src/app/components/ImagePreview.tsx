import { useEffect } from 'react';
import type { FuelRecord } from '../../models/FuelRecord.ts';
import { formatBytes } from '../../utils/imageValidation.ts';

interface GridProps {
  records: FuelRecord[];
  urls: Map<string, string>;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

/** Thumbnails of images selected but not yet processed. */
export function ImagePreviewGrid({ records, urls, onRemove, disabled }: GridProps) {
  return (
    <ul className="thumbs">
      {records.map((r) => (
        <li key={r.id} className="thumb">
          <img src={urls.get(r.id)} alt="" loading="lazy" />
          <div className="thumb__meta">
            <span className="thumb__name" title={r.fileName}>{r.fileName}</span>
            <span className="muted">{formatBytes(r.fileSize)}</span>
          </div>
          <button type="button" className="icon-btn" aria-label={`Remove ${r.fileName}`} disabled={disabled} onClick={() => onRemove(r.id)}>×</button>
        </li>
      ))}
    </ul>
  );
}

interface ViewerProps {
  record: FuelRecord;
  url: string;
  onClose: () => void;
}

const FIELD_LABEL: Record<string, string> = { amount: 'Amount', volume: 'Volume', unitPrice: 'Unit price', unknown: 'Unclassified' };

/** Full-size view of the original photo with the detected numbers outlined. */
export function ImageViewer({ record, url, onClose }: ViewerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const size = record.result?.imageSize;
  const values = record.result?.values ?? [];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={record.fileName} onClick={onClose}>
      <div className="modal__body" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <strong title={record.fileName}>{record.fileName}</strong>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {size ? (
          <svg className="viewer" viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label="Photo with detected numbers outlined">
            <image href={url} width={size.width} height={size.height} />
            {values.filter((v) => v.box).map((v) => (
              <g key={v.id}>
                <rect x={v.box!.x - 6} y={v.box!.y - 6} width={v.box!.width + 12} height={v.box!.height + 12}
                  className={`box box--${v.field === 'unknown' ? 'unknown' : 'known'}`} vectorEffect="non-scaling-stroke" />
                <text x={v.box!.x - 6} y={Math.max(14, v.box!.y - 12)} className="box__label"
                  style={{ fontSize: Math.max(12, size.height / 28) }}>
                  {FIELD_LABEL[v.field] ?? v.field}: {v.text}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <img className="viewer" src={url} alt={record.fileName} />
        )}
        {record.result?.warnings.length ? (
          <ul className="warnings">{record.result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        ) : null}
      </div>
    </div>
  );
}
