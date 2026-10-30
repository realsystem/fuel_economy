export interface RunState {
  total: number;
  done: number;
  currentName: string | null;
}

interface Props {
  run: RunState;
  onCancel: () => void;
}

export function ProcessingStatus({ run, onCancel }: Props) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress__row">
        <span>
          Processing {Math.min(run.done + 1, run.total)} of {run.total}
          {run.currentName ? <span className="muted"> · {run.currentName}</span> : null}
        </span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
      <div className="progress__bar"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
