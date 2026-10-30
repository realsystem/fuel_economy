import type { Statistics, Totals } from '../../services/StatisticsService.ts';
import { formatFixed } from '../../utils/numberFormatting.ts';

interface Props {
  stats: Statistics;
  onExport: () => void;
  canExport: boolean;
}

export function StatisticsPanel({ stats, onExport, canExport }: Props) {
  const showProvisional = stats.provisional.records > stats.confirmed.records;
  return (
    <div className="stats">
      <dl className="stats__counts">
        <Stat label="Images processed" value={stats.imagesProcessed} />
        <Stat label="Successful detections" value={stats.successfulDetections} />
        <Stat label="Needs review" value={stats.needsReview} />
        <Stat label="Confirmed" value={stats.confirmedCount} />
        {stats.failed ? <Stat label="Failed" value={stats.failed} /> : null}
      </dl>

      <table className="stats__totals">
        <thead>
          <tr>
            <th />
            <th className="num">Confirmed</th>
            {showProvisional ? <th className="num">Incl. unconfirmed</th> : null}
          </tr>
        </thead>
        <tbody>
          <TotalsRow label="Records" pick={(t) => String(t.records)} stats={stats} provisional={showProvisional} />
          <TotalsRow label="Total fuel" pick={(t) => (t.records ? formatFixed(t.totalVolume, 3) : '—')} stats={stats} provisional={showProvisional} />
          <TotalsRow label="Total amount" pick={(t) => (t.records ? formatFixed(t.totalAmount, 2) : '—')} stats={stats} provisional={showProvisional} />
          <TotalsRow label="Average unit price" pick={(t) => formatFixed(t.averageUnitPrice, 3) || '—'} stats={stats} provisional={showProvisional} />
          <TotalsRow label="Average fuel per fill" pick={(t) => formatFixed(t.averageVolume, 3) || '—'} stats={stats} provisional={showProvisional} />
        </tbody>
      </table>
      <p className="muted small">
        Only confirmed records count as final. {showProvisional ? '“Incl. unconfirmed” adds detected values you have not confirmed yet. ' : ''}
        Records marked Review or Failed are left out. Average unit price is total amount ÷ total fuel.
      </p>
      <button type="button" className="btn" onClick={onExport} disabled={!canExport}>Export CSV</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TotalsRow({ label, pick, stats, provisional }: { label: string; pick: (t: Totals) => string; stats: Statistics; provisional: boolean }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{pick(stats.confirmed)}</td>
      {provisional ? <td className="num muted">{pick(stats.provisional)}</td> : null}
    </tr>
  );
}
