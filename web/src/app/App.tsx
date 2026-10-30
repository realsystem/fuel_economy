import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_CONFIG } from './appConfig.ts';
import { UploadForm } from './components/UploadForm.tsx';
import { ImagePreviewGrid, ImageViewer } from './components/ImagePreview.tsx';
import { ProcessingStatus, type RunState } from './components/ProcessingStatus.tsx';
import { ResultsTable } from './components/ResultsTable.tsx';
import { StatisticsPanel } from './components/StatisticsPanel.tsx';
import type { FuelField, FuelRecord } from '../models/FuelRecord.ts';
import type { ImageProcessingService } from '../services/ImageProcessingService.ts';
import { BrowserSegmentProcessor } from '../services/BrowserSegmentProcessor.ts';
import {
  applyResult, confirmRecord, correctField, newRecord, unconfirmRecord,
} from '../services/RecordService.ts';
import { computeStatistics } from '../services/StatisticsService.ts';
import { csvFileName, recordsToCsv } from '../services/ExportService.ts';
import { formatBytes, validateImageFile } from '../utils/imageValidation.ts';

let idCounter = 0;
const newId = () => `r${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function App() {
  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  // Files and preview URLs live outside React state: they are large and never rendered directly.
  const files = useRef(new Map<string, File>());
  const [urls, setUrls] = useState(new Map<string, string>());
  const service = useRef<ImageProcessingService | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    service.current = new BrowserSegmentProcessor(new URL('worker.js', document.baseURI));
    return () => service.current?.dispose();
  }, []);

  // Release object URLs on unmount.
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = useCallback((id: string, fn: (r: FuelRecord) => FuelRecord) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const addFiles = (incoming: File[]) => {
    const errors: string[] = [];
    const added: FuelRecord[] = [];
    const nextUrls = new Map(urls);
    for (const f of incoming) {
      if (records.length + added.length >= APP_CONFIG.maxImages) {
        errors.push(`Only ${APP_CONFIG.maxImages} images can be handled at once; ${f.name} was skipped.`);
        continue;
      }
      const err = validateImageFile(f, { maxBytes: APP_CONFIG.maxBytes });
      if (err) { errors.push(err.message); continue; }
      const id = newId();
      files.current.set(id, f);
      nextUrls.set(id, URL.createObjectURL(f));
      added.push(newRecord(id, f.name, f.size));
    }
    setRejected(errors);
    setUrls(nextUrls);
    setRecords((rs) => [...rs, ...added]);
  };

  const remove = (id: string) => {
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    files.current.delete(id);
    setUrls((m) => { const n = new Map(m); n.delete(id); return n; });
    setRecords((rs) => rs.filter((r) => r.id !== id));
    if (viewing === id) setViewing(null);
  };

  const clearAll = () => {
    if (!window.confirm('Remove all images and results? This cannot be undone.')) return;
    urls.forEach((u) => URL.revokeObjectURL(u));
    files.current.clear();
    setUrls(new Map());
    setRecords([]);
    setRejected([]);
  };

  /** Process the given records one at a time (controlled concurrency of 1). */
  const processIds = async (ids: string[]) => {
    const svc = service.current;
    if (!svc || !ids.length) return;
    const ac = new AbortController();
    abort.current = ac;
    setRun({ total: ids.length, done: 0, currentName: null });
    for (let i = 0; i < ids.length; i++) {
      if (ac.signal.aborted) break;
      const id = ids[i];
      const file = files.current.get(id);
      if (!file) continue;
      setRun({ total: ids.length, done: i, currentName: file.name });
      update(id, (r) => ({ ...r, status: 'processing', note: null }));
      const result = await svc.processImage(file, { signal: ac.signal, config: APP_CONFIG.processing });
      if (result.error?.code === 'cancelled') {
        update(id, (r) => ({ ...r, status: r.result ? applyResult(r, r.result).status : 'queued' }));
        break;
      }
      update(id, (r) => applyResult(r, result));
    }
    // Anything left mid-run goes back to waiting.
    setRecords((rs) => rs.map((r) => (r.status === 'processing' ? { ...r, status: 'queued' } : r)));
    abort.current = null;
    setRun(null);
  };

  const processQueued = () => processIds(records.filter((r) => r.status === 'queued').map((r) => r.id));

  const reprocess = (id: string) => {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    const hasEdits = r.amount.corrected !== null || r.volume.corrected !== null || r.unitPrice.corrected !== null;
    if (hasEdits && !window.confirm('Reprocessing replaces your corrections for this image. Continue?')) return;
    processIds([id]);
  };

  const confirmAllDetected = () => setRecords((rs) => rs.map((r) => (r.status === 'detected' ? confirmRecord(r) : r)));

  const exportCsv = () => {
    const blob = new Blob([recordsToCsv(records.filter((r) => r.result || r.status === 'confirmed'))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = csvFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const queued = records.filter((r) => r.status === 'queued');
  const results = records.filter((r) => r.status !== 'queued' || r.result);
  const stats = useMemo(() => computeStatistics(records), [records]);
  const detectedCount = records.filter((r) => r.status === 'detected').length;
  const busy = run !== null;
  const viewed = viewing ? records.find((r) => r.id === viewing) : undefined;

  return (
    <div className="page">
      <header className="masthead">
        <h1>Fuel Photo Log</h1>
        <p className="muted">Read fuel pump displays from photos. Everything runs in your browser; photos are never uploaded.</p>
      </header>

      <section className="card" aria-labelledby="upload-h">
        <h2 id="upload-h">Upload your fuel pump photographs</h2>
        <UploadForm onFiles={addFiles} disabled={busy} maxSizeLabel={formatBytes(APP_CONFIG.maxBytes)} />
        {rejected.length ? (
          <ul className="errors" role="alert">{rejected.map((e, i) => <li key={i}>{e}</li>)}</ul>
        ) : null}
        {queued.length ? (
          <>
            <p className="selected">Selected images: {queued.length}</p>
            <ImagePreviewGrid records={queued} urls={urls} onRemove={remove} disabled={busy} />
          </>
        ) : null}
        <div className="row-actions">
          <button type="button" className="btn btn--primary" disabled={!queued.length || busy} onClick={processQueued}>
            Process {queued.length > 1 ? `${queued.length} images` : 'images'}
          </button>
          {records.length ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={clearAll}>Clear all</button> : null}
        </div>
        {run ? <ProcessingStatus run={run} onCancel={() => abort.current?.abort()} /> : null}
      </section>

      {results.length ? (
        <section className="card" aria-labelledby="results-h">
          <div className="card__head">
            <h2 id="results-h">Processing results</h2>
            {detectedCount ? (
              <button type="button" className="btn btn--small" onClick={confirmAllDetected}>Confirm {detectedCount} detected</button>
            ) : null}
          </div>
          <p className="muted small legend">
            <span className="dot dot--high" /> confident <span className="dot dot--medium" /> check <span className="dot dot--low" /> unsure
            · <span className="tag tag--user">edited</span> your value <span className="tag tag--derived">calc</span> amount ÷ volume.
            Click a photo to inspect what was read.
          </p>
          <ResultsTable
            records={results}
            urls={urls}
            busy={busy}
            onEdit={(id, field: FuelField, v) => update(id, (r) => correctField(r, field, v))}
            onConfirm={(id, c) => update(id, (r) => (c ? confirmRecord(r) : unconfirmRecord(r)))}
            onReprocess={reprocess}
            onRemove={remove}
            onView={setViewing}
          />
        </section>
      ) : null}

      {results.length ? (
        <section className="card" aria-labelledby="stats-h">
          <h2 id="stats-h">Statistics</h2>
          <StatisticsPanel stats={stats} onExport={exportCsv} canExport={results.some((r) => r.result)} />
        </section>
      ) : null}

      <footer className="support">
        <p>If this tool was useful, consider supporting it.</p>
        {APP_CONFIG.supportUrl ? (
          <a className="btn" href={APP_CONFIG.supportUrl} target="_blank" rel="noopener noreferrer">Support this tool</a>
        ) : (
          <button type="button" className="btn" disabled title="Coming soon">Support this tool</button>
        )}
      </footer>

      {viewed && urls.get(viewed.id) ? (
        <ImageViewer record={viewed} url={urls.get(viewed.id)!} onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}
