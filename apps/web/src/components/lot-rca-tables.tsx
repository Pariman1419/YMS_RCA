'use client';
const n = (v: any) =>
  v === null || v === undefined
    ? 'Unavailable'
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
export default function LotRcaTables({ lot }: { lot: any }) {
  return (
    <>
      <h3>Process route and equipment</h3>
      <p className="muted">
        Showing {lot.processHistory.length} of {lot.processCounts.total} records in operation order. Invalid
        records are excluded from numerical rankings.
      </p>
      <div className="ai-table-wrap">
        <table className="table">
          <thead>
            <tr>
              {[
                'Sequence',
                'Operation',
                'Machine / model',
                'Input',
                'Output',
                'Reject',
                'Yield',
                'Quality',
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lot.processHistory.map((r: any, i: number) => (
              <tr key={i}>
                <td>{n(r.sequence)}</td>
                <td>
                  {r.name}
                  <small className="muted"> / {r.operationCode}</small>
                </td>
                <td>
                  {r.machine}
                  <small className="muted"> / {r.machineModel || 'Model unavailable'}</small>
                </td>
                <td>{n(r.input)}</td>
                <td>{n(r.output)}</td>
                <td>{n(r.reject)}</td>
                <td>{r.yield === null ? 'Unavailable' : `${n(r.yield)}%`}</td>
                <td>{r.qualityStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lot.processHistory.length && <p>Process history has not been imported for this lot.</p>}
      </div>
      <h3>Reject evidence by operation</h3>
      <p className="muted">
        Showing {lot.rejectHistory.length} of {lot.defectTotals.total} records. Whole-lot validated
        reject-detail total: {n(lot.defectTotals.qty)}. This total may overlap assembly reject quantity.
      </p>
      <div className="ai-table-wrap">
        <table className="table">
          <thead>
            <tr>
              {[
                'Sequence',
                'Operation',
                'Defect',
                'Quantity',
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
            {lot.rejectHistory.map((r: any, i: number) => (
              <tr key={i}>
                <td>{n(r.sequence)}</td>
                <td>{r.operation || r.operationCode || 'Unavailable'}</td>
                <td>
                  {r.code} / {r.description}
                </td>
                <td>{n(r.qty)}</td>
                <td>{n(r.rework)}</td>
                <td>{r.machine}</td>
                <td>
                  {r.externalCode || '—'} / {r.externalDescription || '—'}
                </td>
                <td>{r.qualityStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lot.rejectHistory.length && <p>Reject details have not been imported for this lot.</p>}
      </div>
      <h3>Material traceability</h3>
      <p className="muted">
        Showing {lot.materials.length} of {lot.materialCounts.total} material records. A shared material
        reference does not prove a material defect.
      </p>
      <div className="ai-table-wrap">
        <table className="table">
          <thead>
            <tr>
              {['Sequence', 'Group', 'Size / type', 'Item', 'Material lot'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lot.materials.map((r: any, i: number) => (
              <tr key={i}>
                <td>{n(r.sequence)}</td>
                <td>{r.itemGroup || '—'}</td>
                <td>{r.sizeType || '—'}</td>
                <td>{r.itemNo || '—'}</td>
                <td>{r.itemLotNo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lot.materials.length && <p>Material history has not been imported for this lot.</p>}
      </div>
      <h3>ETL coverage</h3>
      <div className="ai-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Lot sync status</th>
              <th>Last checked</th>
              <th>Imported records</th>
            </tr>
          </thead>
          <tbody>
            {lot.sync.map((s: any, i: number) => (
              <tr key={i}>
                <td>{s.job}</td>
                <td>{s.status}</td>
                <td>{new Date(s.processedAt).toLocaleString()}</td>
                <td>{n(s.importedRecords)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lot.sync.length && (
          <p>
            No enrichment checkpoint has been recorded. Run the AEY enrichment jobs before relying on complete
            coverage.
          </p>
        )}
      </div>
    </>
  );
}
