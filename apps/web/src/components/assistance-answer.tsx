'use client';
import { useState } from 'react';
import LotRcaTables from './lot-rca-tables';
import LotRcaSankey from './lot-rca-sankey';
import { OperationRejectChart } from './charts';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LabelList,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
const number = (v: any, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? 'Unavailable'
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
export default function AssistanceAnswer({ result }: { result: any }) {
  const [view, setView] = useState('Overview');
  const [ranking, setRanking] = useState('processes');
  const e = result.evidence,
    a = result.analysis;
  const rows = e?.[ranking] || [];
  const trend = (
    e?.lot ? e.lot.processHistory.filter((r: any) => r.qualityStatus === 'valid') : e?.trend || []
  ).filter((r: any) => Number(r.input) > 0 && r.yield !== null);
  const values = trend.map((r: any) => Number(r.yield));
  const yieldDomain = values.length
    ? [
        Math.max(0, Math.floor((Math.min(...values) - 0.2) * 10) / 10),
        Math.min(100, Math.ceil((Math.max(...values) + 0.2) * 10) / 10),
      ]
    : [0, 100];
  const tip = { background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--text)' };
  const yieldValue = (s: any) => (Number(s?.input) > 0 ? `${number(s.yield, 2)}%` : 'No measurements');
  return (
    <section className="panel ai-result" aria-label="AI analysis result">
      <div className="panel-head">
        <div>
          <span className="ai-eyebrow">ANALYSIS BRIEF</span>
          <h2>
            {e?.lot ? `${e.lot.lotNo} / ` : ''}
            {result.question}
          </h2>
          <p className="muted">
            {result.model} · {new Date(result.generatedAt).toLocaleString()} ·{' '}
            {e?.lot
              ? `Lot history / assembly source ${e.lot.source}`
              : `${e?.filters?.from || 'Last 30 days'} to ${e?.filters?.to || 'today'}`}
          </p>
        </div>
      </div>
      <div className="ai-tabs" role="group" aria-label="Answer format">
        {['Overview', 'Charts', 'Tables', 'Investigation map', ...(e?.lot ? ['Sankey map'] : [])].map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="ai-result-body">
        {view === 'Sankey map' && e?.lot && <LotRcaSankey lot={e.lot} />}
        {view === 'Overview' && (
          <>
            <h3>Executive summary</h3>
            <p className="ai-prose">{a?.summary || result.answer}</p>
            {e && (
              <div className="ai-metrics">
                {[
                  ['Current yield', yieldValue(e.summary)],
                  [e.lot ? 'Peer cohort yield' : 'Previous yield', yieldValue(e.previousSummary)],
                  ['Reject quantity', number(e.summary?.reject)],
                  ['Lots measured', number(e.summary?.lots)],
                ].map(([label, value]) => (
                  <div className="ai-metric" key={label}>
                    <span className="muted">{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="ai-two-column">
              <div>
                <h3>Evidence findings</h3>
                {a?.findings?.length ? (
                  <ul>
                    {a.findings.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Review the evidence charts and tables for the selected scope.</p>
                )}
              </div>
              <div>
                <h3>Recommended actions</h3>
                {a?.actions?.map((s: any, i: number) => (
                  <div className="ai-action" key={i}>
                    <span className="badge">{s.priority}</span>
                    <p>{s.action}</p>
                    <small className="muted">Suggested owner: {s.owner}</small>
                  </div>
                ))}
              </div>
            </div>
            <h3>Evidence limits</h3>
            <ul>
              {a?.limitations?.map((s: string, i: number) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {view === 'Charts' && (
          <div className="ai-two-column">
            <div>
              <h3>{e?.lot ? 'Process yield along the lot route' : 'Yield over time'}</h3>
              <p className="muted">
                {e?.lot
                  ? 'Measured operation yields / sequence order / up to 120 records'
                  : e?.summary?.definitions?.yield + ' / latest 90 buckets'}{' '}
                / axis follows the measured range
              </p>
              {trend.length ? (
                <div role="img" aria-label="Measured yield trend">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trend}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis
                        dataKey={e?.lot ? 'sequence' : 'date'}
                        tickFormatter={(v) => (e?.lot ? String(v) : String(v).slice(5, 10))}
                        tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      />
                      <YAxis
                        domain={yieldDomain}
                        tickFormatter={(v) => `${number(v, 2)}%`}
                        tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={tip}
                        labelFormatter={(v) => (e?.lot ? `Operation sequence ${v}` : String(v).slice(0, 10))}
                        formatter={(v: any) => [`${number(v, 2)}%`, 'Yield']}
                      />
                      <Area
                        type="monotone"
                        dataKey="yield"
                        stroke="var(--cyan)"
                        fill="var(--cyan)"
                        fillOpacity={0.15}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p>No measured trend in this scope.</p>
              )}
            </div>
            <div>
              <h3>Reject contributors</h3>
              <label>
                Group by{' '}
                <select
                  aria-label="AI chart grouping"
                  value={ranking}
                  onChange={(ev) => setRanking(ev.target.value)}
                >
                  <option value="processes">Process</option>
                  <option value="machines">Machine</option>
                  {!e?.lot && <option value="customers">Customer</option>}
                </select>
              </label>
              <p className="muted">Top 10 measured groups · quantity, not defect rate</p>
              {rows.length ? (
                <div role="img" aria-label="Reject contributor ranking">
                  <ResponsiveContainer width="100%" height={Math.max(300, rows.length * 38)}>
                    <BarChart layout="vertical" data={rows} margin={{ right: 65 }}>
                      <CartesianGrid stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={{ fill: 'var(--muted)', fontSize: 11 }}
                        tickFormatter={(v) => String(v).slice(0, 23)}
                      />
                      <Tooltip contentStyle={tip} formatter={(v: any) => [number(v), 'Reject quantity']} />
                      <Bar
                        dataKey="reject"
                        fill="var(--cyan)"
                        radius={[0, 4, 4, 0]}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey="reject"
                          position="right"
                          fill="var(--text)"
                          fontSize={10}
                          formatter={(v: any) => number(v)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p>No contributor measurements in this scope.</p>
              )}
            </div>
          </div>
        )}
        {view === 'Tables' && (
          <>
            <h3>{e?.lot ? 'Lot compared with product peers' : 'Period comparison'}</h3>
            <p className="muted">
              {e?.lot
                ? e.lot.peerScope
                : `Prior period: ${e?.previousPeriod?.from} to ${e?.previousPeriod?.to}`}
            </p>
            <div className="ai-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th>{e?.lot ? 'This lot' : 'Current'}</th>
                    <th>{e?.lot ? 'Peer cohort' : 'Previous'}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Yield', yieldValue(e?.summary), yieldValue(e?.previousSummary)],
                    ...['input', 'output', 'reject', 'rework', 'lots'].map((k) => [
                      k,
                      number(e?.summary?.[k]),
                      number(e?.previousSummary?.[k]),
                    ]),
                  ].map((r) => (
                    <tr key={r[0]}>
                      {r.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {e?.lot && <LotRcaTables lot={e.lot} />}
            <h3>Contributor evidence</h3>
            <label>
              Group by{' '}
              <select
                aria-label="AI table grouping"
                value={ranking}
                onChange={(ev) => setRanking(ev.target.value)}
              >
                <option value="processes">Process</option>
                <option value="machines">Machine</option>
                {!e?.lot && <option value="customers">Customer</option>}
              </select>
            </label>
            <div className="ai-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Reject</th>
                    <th>Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, i: number) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{number(r.input)}</td>
                      <td>{number(r.output)}</td>
                      <td>{number(r.reject)}</td>
                      <td>{Number(r.input) > 0 ? `${number(r.yield, 2)}%` : 'Unavailable'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p>No measurements.</p>}
            </div>
          </>
        )}
        {view === 'Investigation map' && (
          <>
            <h3>From observation to verification</h3>
            <p className="muted">
              Investigation workflow. Connections describe checks to perform, not proven causal relationships.
            </p>
            <div className="ai-map">
              <div className="ai-map-start">
                <span className="ai-eyebrow">OBSERVED SCOPE</span>
                <strong>
                  {e?.lot
                    ? `Lot ${e.lot.lotNo}`
                    : e?.filters?.grain === 'process'
                      ? 'Measured process history'
                      : 'Assembly completion data'}
                </strong>
                <p>
                  {yieldValue(e?.summary)} yield · {number(e?.summary?.reject)} rejects
                </p>
              </div>
              <div className="ai-map-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="ai-map-branches">
                {a?.hypotheses?.length ? (
                  a.hypotheses.map((h: any, i: number) => (
                    <div className="ai-map-node" key={i}>
                      <span className="badge">Unconfirmed candidate {i + 1}</span>
                      <h4>{h.candidate}</h4>
                      <div className="ai-map-arrow" aria-hidden="true">
                        ↓
                      </div>
                      <strong>Verification</strong>
                      <p>{h.verification}</p>
                    </div>
                  ))
                ) : (
                  <p>No supported investigation candidates were identified. Review the evidence limits.</p>
                )}
              </div>
            </div>
          </>
        )}
        {e?.lot && view === 'Charts' && (
          <div style={{ marginTop: 24 }}>
            <h3>Lot rejects by operation / top 30</h3>
            <OperationRejectChart data={e.lot.operations} rankingLabel="AI lot operation ranking" />
          </div>
        )}
        {e?.knowledge?.enabled && (
          <section className="ai-evidence-note" aria-label="External assembly references">
            <h3>External assembly references</h3>
            <p>
              Retrieval status: {e.knowledge.status}. References were provided to the local model for general
              process knowledge; they do not prove the root cause of this lot.
            </p>
            <div className="ai-reference-list">
              {e.knowledge.sources.map((s: any) => (
                <article key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                  <p>
                    Reference [{s.id}] / {s.publisher} / Retrieved {new Date(s.retrievedAt).toLocaleString()}
                  </p>
                </article>
              ))}
            </div>
            {e.knowledge.limitations.map((s: string, i: number) => (
              <p key={i}>{s}</p>
            ))}
          </section>
        )}
        <div className="ai-evidence-note">
          <strong>Warehouse evidence</strong>
          <p>{e?.evidenceScope || 'Evidence is unavailable for this response.'}</p>
          <p>{e?.summary?.definitions?.yield}. AI interpretation requires engineering review.</p>
          <details>
            <summary>Applied filters</summary>
            <div className="ai-filter-tags">
              {Object.entries(e?.filters || {})
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <span className="badge" key={k}>
                    {k}: {String(v)}
                  </span>
                ))}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
