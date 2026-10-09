'use client';
import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';

const qty = (n: any) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
export default function LotYieldVerification({ lot, target }: { lot: any; target: number }) {
  const [operation, setOperation] = useState('');
  const a = lot.assembly;
  const input = Number(a?.inputQty || 0),
    output = Number(a?.outputQty || 0);
  const calculated = input > 0 ? (output / input) * 100 : null;
  const recorded = a?.yieldPercentage == null ? null : Number(a.yieldPercentage);
  const rows = lot.processHistory || [];
  const selected = rows.find((h: any) => h.id === operation);
  const evidence = selected
    ? (lot.defects || []).filter(
        (d: any) =>
          d.operationSequence != null &&
          selected.operationSequence != null &&
          Number(d.operationSequence) === Number(selected.operationSequence),
      )
    : [];
  const chart = rows
    .filter((h: any) => h.qualityStatus === 'valid' && h.yieldPercentage != null)
    .map((h: any) => ({
      name: `${h.operationSequence ?? '—'} · ${h.process.name}`,
      yield: Number(h.yieldPercentage),
    }));
  return (
    <section
      aria-label="Lot yield verification"
      style={{
        margin: '24px 0',
        padding: 20,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--panel)',
      }}
    >
      <div className="eyebrow">VERIFY → TRACE PROCESS → REVIEW REJECT EVIDENCE</div>
      <h2>Verify assembly yield</h2>
      <p style={{ color: recorded !== null && recorded < target ? 'var(--warning)' : 'var(--text)' }}>
        {recorded === null
          ? 'Yield unavailable'
          : recorded < target
            ? 'Below investigation target'
            : 'Meets investigation target'}{' '}
        · target {target.toFixed(2)}% · source {a?.source} · latest completion{' '}
        {a?.transactionDate ? new Date(a.transactionDate).toLocaleString() : '—'}
      </p>
      <div className="statline">
        <span>
          Calculated yield<strong>{calculated === null ? '—' : calculated.toFixed(2) + '%'}</strong>
        </span>
        <span>
          Recorded yield<strong>{recorded === null ? '—' : recorded.toFixed(2) + '%'}</strong>
        </span>
        <span>
          Gap to target
          <strong>{calculated === null ? '—' : Math.max(0, target - calculated).toFixed(2) + ' pp'}</strong>
        </span>
        <span>
          Input − output<strong>{qty(input - output)} units</strong>
        </span>
      </div>
      <p className="muted">
        Calculation: {qty(output)} output ÷ {qty(input)} input × 100. Investigation target is user-selected,
        not a product specification.
      </p>
      {calculated !== null && recorded !== null && Math.abs(calculated - recorded) > 0.01 && (
        <p role="status">Check source data: recorded and calculated yield differ.</p>
      )}
      {input - output !== Number(a?.rejectQty) && (
        <p role="status">
          Quantity check: input − output differs from recorded rejects ({qty(a?.rejectQty)}). Verify
          dispositions and rework before attributing loss.
        </p>
      )}
      <h2>Trace yield by operation</h2>
      <p className="muted">
        Measured operation yields in route order. Each operation has its own denominator; these percentages
        are not cumulative lot yield. Showing {rows.length} of {lot.processTotal} process records; use history
        pagination for more.
      </p>
      {chart.length ? (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <XAxis dataKey="name" hide />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)' }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  borderColor: 'var(--line)',
                }}
                formatter={(v: any) => `${Number(v).toFixed(2)}%`}
              />
              <ReferenceLine y={target} stroke="var(--warning)" strokeDasharray="4 4" />
              <Bar dataKey="yield" fill="var(--cyan)" name="Operation yield" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="empty">No validated operation yield measurements available.</p>
      )}
      <label>
        Drill into an operation{' '}
        <select
          aria-label="Drill into an operation"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
          style={{ maxWidth: '100%', margin: '12px 0' }}
        >
          <option value="">Select operation to inspect machine and reject evidence</option>
          {rows.map((h: any) => (
            <option key={h.id} value={h.id}>
              {h.operationSequence ?? '—'} · {h.process.name} · yield{' '}
              {h.yieldPercentage == null ? 'unavailable' : Number(h.yieldPercentage).toFixed(2) + '%'} ·{' '}
              {qty(h.rejectQty)} rejects
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <div>
          <h3>
            {selected.process.name} · {selected.machine.name}
          </h3>
          <p>
            Input {qty(selected.inputQty)} → output {qty(selected.outputQty)} · reject{' '}
            {qty(selected.rejectQty)} · data quality: {selected.qualityStatus}
          </p>
          <p className="muted">
            Reject evidence matched by operation sequence. A match identifies the recorded operation, not a
            confirmed root cause. Inspection and reliability-test removals need disposition verification.
          </p>
          {evidence.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {['Operation', 'Reject code', 'Description', 'Reject qty', 'Rework qty', 'Quality'].map(
                      (h) => (
                        <th key={h}>{h}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((d: any) => (
                    <tr key={d.id}>
                      <td>{d.wipOperation || d.operationCode || '—'}</td>
                      <td>{d.code}</td>
                      <td>{d.description}</td>
                      <td>{qty(d.qty)}</td>
                      <td>{qty(d.reworkQty)}</td>
                      <td>{d.qualityStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              No matching reject evidence in the loaded details. Check the full defect history and ETL
              coverage.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
