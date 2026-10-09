'use client';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LabelList,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
const palette = ['var(--cyan)', 'var(--chart-2)', 'var(--chart-3)', '#d9ab6d', '#668aa9', '#4c7995'];
const tooltip = {
  background: 'var(--tooltip-bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--text)',
};
export function Trend({ data, spc = false }: { data: any[]; spc?: boolean }) {
  const cusum = data[0]?.positive !== undefined;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="yieldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cyan)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--cyan)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 5" />
        <XAxis
          dataKey={spc ? 'label' : 'date'}
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={30}
          tickFormatter={(s) =>
            spc ? s : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }
        />
        <YAxis
          domain={spc ? ['auto', 'auto'] : [85, 100]}
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (spc ? v : `${v}%`)}
        />
        <Tooltip contentStyle={tooltip} />
        {!spc && (
          <ReferenceLine
            y={98}
            stroke="var(--chart-target)"
            strokeDasharray="5 5"
            label={{
              value: 'Target 98%',
              fill: 'var(--chart-target)',
              fontSize: 10,
              position: 'insideTopRight',
            }}
          />
        )}
        <Area
          type="monotone"
          dataKey={cusum ? 'positive' : spc ? 'value' : 'yield'}
          stroke="var(--cyan)"
          strokeWidth={2.5}
          fill="url(#yieldFill)"
        />
        {cusum && <Area dataKey="negative" stroke="var(--chart-warning)" strokeWidth={2} fill="none" />}
        {spc && (
          <>
            <Area dataKey="ucl" stroke="var(--chart-danger)" fill="none" strokeDasharray="4 4" />
            <Area dataKey="lcl" stroke="var(--chart-danger)" fill="none" strokeDasharray="4 4" />
            <Area dataKey="target" stroke="var(--chart-target)" fill="none" strokeDasharray="4 4" />
          </>
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
export function Pareto({ data }: { data: any[] }) {
  const total = data.reduce((s, r) => s + Number(r.qty ?? r.reject ?? 0), 0);
  let running = 0;
  const rows = data.slice(0, 8).map((r) => {
    running += Number(r.qty ?? r.reject ?? 0);
    return { ...r, loss: Number(r.qty ?? r.reject ?? 0), cumulative: total ? (running / total) * 100 : 0 };
  });
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ left: -20, right: -15, top: 8, bottom: 30 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 5" />
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-18}
          textAnchor="end"
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          tickFormatter={(v) => `${v}%`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltip} />
        <Bar yAxisId="left" dataKey="loss" radius={[4, 4, 0, 0]} maxBarSize={38}>
          {rows.map((_, i) => (
            <Cell key={i} fill={palette[i % palette.length]} />
          ))}
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulative"
          stroke="var(--chart-warning)"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
export function DefectVisual({ data, kind }: { data: any[]; kind: string }) {
  if (kind === 'treemap')
    return (
      <ResponsiveContainer width="100%" height={300}>
        <Treemap data={data} dataKey="qty" nameKey="name" stroke="#101e30" fill="#247b91" />
      </ResponsiveContainer>
    );
  if (kind === 'bubble')
    return (
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart>
          <CartesianGrid stroke="var(--line)" />
          <XAxis dataKey="index" name="Defect rank" tick={{ fill: 'var(--muted)' }} />
          <YAxis dataKey="qty" name="Defect quantity" tick={{ fill: 'var(--muted)' }} />
          <ZAxis dataKey="qty" range={[60, 600]} />
          <Tooltip contentStyle={tooltip} />
          <Scatter data={data.map((r, i) => ({ ...r, index: i + 1 }))} fill="var(--cyan)" />
        </ScatterChart>
      </ResponsiveContainer>
    );
  return <Pareto data={data} />;
}

export function OperationRejectChart({
  data,
  rankingLabel = 'Operation chart ranking size',
  entityLabel = 'operations',
}: {
  data: { name: string; qty: number }[];
  rankingLabel?: string;
  entityLabel?: string;
}) {
  const [limit, setLimit] = useState('15');
  const total = data.reduce((sum, r) => sum + Number(r.qty), 0);
  const ranked = [...data].sort((a, b) => Number(b.qty) - Number(a.qty) || a.name.localeCompare(b.name));
  const rows = limit === 'all' ? ranked : ranked.slice(0, Number(limit));
  return (
    <div>
      <div className="toolbar" style={{ padding: '0 20px 16px', justifyContent: 'space-between' }}>
        <span className="muted">
          {total.toLocaleString()} rejects across {data.length.toLocaleString()} {entityLabel}
        </span>
        <label>
          Show{' '}
          <select aria-label={rankingLabel} value={limit} onChange={(e) => setLimit(e.target.value)}>
            <option value="15">Top 15</option>
            <option value="30">Top 30</option>
            <option value="all">All operations</option>
          </select>
        </label>
      </div>
      {rows.length ? (
        <div
          style={{ maxHeight: 650, overflowY: 'auto', paddingRight: 10 }}
          role="img"
          aria-label={`Reject quantity by ${entityLabel}, highest to lowest`}
        >
          <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 38)}>
            <BarChart layout="vertical" data={rows} margin={{ left: 10, right: 85, top: 10, bottom: 20 }}>
              <CartesianGrid stroke="var(--line)" horizontal={false} strokeDasharray="3 5" />
              <XAxis
                type="number"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickFormatter={(v) => Number(v).toLocaleString()}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={190}
                interval={0}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
                tickFormatter={(v) => (v.length > 28 ? v.slice(0, 27) + '…' : v)}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltip}
                cursor={{ fill: 'var(--line)' }}
                formatter={(v: any) => [
                  `${Number(v).toLocaleString()} (${total ? ((Number(v) / total) * 100).toFixed(2) : '0'}%)`,
                  'Reject quantity',
                ]}
              />
              <Bar
                dataKey="qty"
                fill="var(--cyan)"
                radius={[0, 4, 4, 0]}
                barSize={22}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="qty"
                  position="right"
                  fill="var(--text)"
                  fontSize={11}
                  formatter={(v: any) => Number(v).toLocaleString()}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted" style={{ padding: 20 }}>
          No reject data for the selected filters.
        </p>
      )}
    </div>
  );
}
