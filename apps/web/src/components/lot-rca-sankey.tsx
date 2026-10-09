'use client';
import { useState } from 'react';
import { ResponsiveContainer, Sankey } from 'recharts';
import { buildLotSankey, type RejectPath } from '../lib/lot-sankey';
const n = (v: number) => Number(v || 0).toLocaleString();
const colors: Record<string, string> = {
  lot: 'var(--cyan)',
  operation: '#6366f1',
  machine: '#0891b2',
  reject: '#d97706',
};
export default function LotRcaSankey({ lot }: { lot: any }) {
  const [limit, setLimit] = useState(20);
  const [focus, setFocus] = useState('');
  const paths: RejectPath[] = lot.sankeyPaths || [];
  const graph = buildLotSankey(lot.lotNo, paths.slice(0, limit));
  const focused = graph.records.filter((p) => !focus || p.nodeKeys.includes(focus));
  const whole = Number(lot.defectTotals?.qty || 0);
  const omitted = Math.max(0, whole - graph.total);
  const active = graph.nodes.find((p) => p.key === focus);
  return (
    <section aria-label="Lot factor Sankey investigation map">
      <h3>Lot factor Sankey</h3>
      <p className="muted">
        Selected lot → recorded operation → recorded machine → reject code. Band width represents recorded
        reject quantity, not correlation strength or confirmed root cause.
      </p>
      <div className="toolbar" style={{ flexWrap: 'wrap', margin: '16px 0' }}>
        <label>
          Show{' '}
          <select
            aria-label="Sankey evidence paths"
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setFocus('');
            }}
          >
            {[10, 20, 30].map((v) => (
              <option key={v} value={v}>
                Top {v} evidence paths
              </option>
            ))}
          </select>
        </label>
        {focus && (
          <button className="link" onClick={() => setFocus('')}>
            Clear selected factor
          </button>
        )}
        <span>
          {n(graph.total)} displayed reject units · {whole ? ((100 * graph.total) / whole).toFixed(1) : '0.0'}
          % of validated lot reject details
        </span>
      </div>
      {omitted > 0 && (
        <p className="muted">
          {n(omitted)} reject units are outside the displayed paths. The warehouse provides up to 60 ranked
          paths; the diagram shows the selected top {limit}.
        </p>
      )}
      {!graph.links.length ? (
        <p className="empty">
          No validated positive reject paths available. Refresh the lot analysis after its reject ETL
          completes.
        </p>
      ) : (
        <>
          <p className="muted">
            Select a colored node to inspect its supporting records below. Machine nodes are kept separate per
            operation to preserve traceability.
          </p>
          <div className="table-scroll">
            <div
              style={{
                minWidth: 900,
                height: Math.max(
                  420,
                  Math.max(
                    ...['operation', 'machine', 'reject'].map(
                      (kind) => graph.nodes.filter((p) => p.kind === kind).length,
                    ),
                  ) * 46,
                ),
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={{ nodes: graph.nodes, links: graph.links }}
                  nodeWidth={14}
                  nodePadding={24}
                  iterations={48}
                  margin={{ top: 20, bottom: 20, left: 50, right: 220 }}
                  node={(props: any) => {
                    const { x, y, width, height, payload } = props;
                    const last = payload.kind === 'reject';
                    const label = payload.name.length > 25 ? payload.name.slice(0, 24) + '…' : payload.name;
                    return (
                      <g
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect ${payload.kind}: ${payload.name}`}
                        onClick={() => setFocus(payload.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFocus(payload.key);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <title>
                          {payload.name} ·{' '}
                          {n(
                            graph.links
                              .filter((link) => graph.nodes[link.source].key === payload.key)
                              .reduce((sum, link) => sum + link.value, 0) ||
                              graph.links
                                .filter((link) => graph.nodes[link.target].key === payload.key)
                                .reduce((sum, link) => sum + link.value, 0),
                          )}{' '}
                          recorded reject units
                        </title>
                        <rect
                          x={x}
                          y={y}
                          width={width}
                          height={height}
                          fill={colors[payload.kind]}
                          stroke={focus === payload.key ? 'var(--text)' : 'none'}
                          strokeWidth={2}
                        />
                        <text
                          x={last ? x + width + 8 : x - 8}
                          y={y + height / 2}
                          textAnchor={last ? 'start' : 'end'}
                          dominantBaseline="middle"
                          fill="var(--text)"
                          fontSize={11}
                        >
                          {payload.kind === 'lot' ? 'Lot' : label}
                        </text>
                      </g>
                    );
                  }}
                  link={{ stroke: 'var(--cyan)', strokeOpacity: 0.22 }}
                ></Sankey>
              </ResponsiveContainer>
            </div>
          </div>
          <h4>{active ? `Supporting evidence: ${active.name}` : 'Supporting evidence paths'}</h4>
          <div className="ai-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {[
                    'Sequence',
                    'Operation',
                    'Machine / model',
                    'Reject code',
                    'Description',
                    'Reject qty',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {focused.map((p, i) => (
                  <tr key={i}>
                    <td>{p.sequence ?? '—'}</td>
                    <td>{p.operation}</td>
                    <td>
                      {p.machine}
                      <small className="muted"> / {p.machineModel || 'Model unavailable'}</small>
                    </td>
                    <td>{p.code}</td>
                    <td>{p.description}</td>
                    <td>{n(p.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted">
        Only validated reject records contribute. UNKNOWN, MANUAL or UNMAPPED machine labels require identity
        verification. Repeated measurements and planned sampling removals may be included; these quantities
        must not be added to assembly rejects as unique losses. Materials remain available in Tables; no
        material-to-defect relationship is inferred without evidence.
      </p>
    </section>
  );
}
