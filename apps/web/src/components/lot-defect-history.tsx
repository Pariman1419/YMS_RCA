'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
const Ranking = dynamic(() => import('./charts').then((m) => m.OperationRejectChart), { ssr: false });
const fmt = (v: number | null) => (v === null ? 'Unavailable' : Number(v).toLocaleString());
export default function LotDefectHistory({ defects }: { defects: any[] }) {
  const [operation, setOperation] = useState(''),
    [search, setSearch] = useState('');
  const op = (d: any) =>
    d.wipOperation || d.rawPayload?.WIP_OPTN_CODE || d.operationCode || 'Unknown operation';
  const operations = useMemo(() => [...new Set(defects.map(op))].sort(), [defects]);
  const rows = defects.filter(
    (d) =>
      (!operation || op(d) === operation) &&
      (!search ||
        [d.code, d.description, d.externalRejectCode, d.externalRejectDescription, d.machine?.name, op(d)]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const valid = rows.filter((d) => d.qualityStatus === 'valid' && d.qty !== null);
  const grouped = (key: (d: any) => string) =>
    Object.values(
      valid.reduce((a: any, d: any) => {
        const name = key(d);
        a[name] ??= { name, qty: 0 };
        a[name].qty += Number(d.qty);
        return a;
      }, {}),
    ) as { name: string; qty: number }[];
  const byOperation = grouped(op),
    byDefect = grouped((d) => `${d.code} · ${d.description}`);
  const rejects = valid.reduce((s, d) => s + Number(d.qty), 0),
    rework = valid.reduce((s, d) => s + Number(d.reworkQty || 0), 0);
  return (
    <section className="lot-defect-history" style={{ marginTop: 24 }}>
      <h2>Defect history</h2>
      <p className="muted" style={{ margin: '8px 0 16px' }}>
        Source 2 reject details · operation names from WIP_OPTN_CODE · charts include validated records
      </p>
      {!defects.length ? (
        <div className="empty">
          No defect details imported for this lot yet. Reject details refresh after AEY.
        </div>
      ) : (
        <>
          <div className="lot-defect-kpis">
            {[
              ['Reject quantity', fmt(rejects)],
              ['Rework quantity', fmt(rework)],
              ['Operations affected', String(byOperation.filter((x) => x.qty > 0).length)],
              ['Defect records', String(rows.length)],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <span className="muted">{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="toolbar" style={{ margin: '16px 0' }}>
            <label>
              Operation{' '}
              <select
                aria-label="Lot defect operation"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                <option value="">All operations</option>
                {operations.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="Search lot defect history"
              placeholder="Search defect, machine or external code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <button
              className="link"
              onClick={() => {
                setSearch('');
                setOperation('');
              }}
            >
              Clear filters
            </button>
          </div>
          <div className="lot-defect-charts">
            <section className="panel">
              <div className="panel-head">
                <h3>Rejects by operation</h3>
              </div>
              <Ranking data={byOperation} rankingLabel="Lot operation ranking size" />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h3>Top defects</h3>
              </div>
              <Ranking data={byDefect} rankingLabel="Lot defect ranking size" entityLabel="defect types" />
            </section>
          </div>
          {rows.some((d) => d.qualityStatus !== 'valid' || d.qty === null) && (
            <p className="muted">
              Records with invalid or unavailable quantities remain visible below and are excluded from chart
              totals.
            </p>
          )}
          {defects.length >= 1000 && (
            <p className="muted">
              Showing up to 1,000 imported defect records. Chart totals cover these displayed records.
            </p>
          )}
          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  {[
                    'Sequence',
                    'Operation',
                    'Area',
                    'Defect / failure mode',
                    'Rejects',
                    'Rework',
                    'Machine',
                    'External reject',
                    'Quality',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{d.operationSequence ?? '—'}</td>
                    <td>
                      <strong>{op(d)}</strong>
                      <small style={{ display: 'block' }} className="muted">
                        {d.operationCode || '—'}
                      </small>
                    </td>
                    <td>{d.processArea || '—'}</td>
                    <td>
                      <strong className="cyan">{d.code}</strong>
                      <div>{d.description}</div>
                    </td>
                    <td>{fmt(d.qty)}</td>
                    <td>{fmt(d.reworkQty)}</td>
                    <td>{d.machine?.name || '—'}</td>
                    <td>
                      {d.externalRejectCode || '—'}
                      <small style={{ display: 'block' }}>{d.externalRejectDescription}</small>
                    </td>
                    <td>{d.qualityStatus || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="empty">No defect records match these filters.</p>}
        </>
      )}
    </section>
  );
}
