'use client';
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  Factory,
  FileChartColumn,
  Layers,
  LayoutDashboard,
  LogIn,
  Menu,
  Play,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import LotDefectHistory from '../components/lot-defect-history';
import LotYieldVerification from '../components/lot-yield-verification';
import LocalLogin from '../components/local-login';
import ThemeToggle from '../components/theme-toggle';
import AiAssistance from '../components/ai-assistance';
import DefectFilters from '../components/defect-filters';
import UserManagement from '../components/user-management';
import { api, download, login, localAuth, request } from '../lib/api';
const Trend = dynamic(() => import('../components/charts').then((m) => m.Trend), { ssr: false });
const OperationRejectChart = dynamic(
  () => import('../components/charts').then((m) => m.OperationRejectChart),
  { ssr: false },
);
const Pareto = dynamic(() => import('../components/charts').then((m) => m.Pareto), { ssr: false });
const DefectVisual = dynamic(() => import('../components/charts').then((m) => m.DefectVisual), {
  ssr: false,
});
const LotGrid = dynamic(() => import('../components/lot-grid'), { ssr: false });
const menu = [
  ['Overview', LayoutDashboard],
  ['Yield analytics', ChartNoAxesCombined],
  ['Lot explorer', Layers],
  ['Process analysis', ScanLine],
  ['Equipment', Factory],
  ['Defect analysis', Activity],
  ['SPC monitor', ShieldCheck],
  ['Alerts', Bell],
  ['Reports', FileChartColumn],
  ['ETL control', Database],
  ['YMS AI Assistance', Sparkles],
  ['User management', ShieldCheck],
] as const;
const drill = ['customer', 'product', 'package', 'bom', 'lot', 'process', 'machine'];
const fmt = (v: any, d = 0) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: any) => fmt(v, 2) + '%';
const date = (v: any) => (v ? new Date(v).toLocaleString() : 'Never');
function Panel({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metrics({ summary: s }: { summary: any }) {
  return (
    <div className="kpi-grid">
      {[
        [
          s.grain === 'process' ? 'Process yield' : 'Assembly yield',
          pct(s.yield),
          s.grain === 'process'
            ? 'Weighted valid, completed processes'
            : 'Assembly completion output / input',
          'cyan',
        ],
        ['First pass yield', '—', 'Awaiting first-pass / rework tracking', 'green'],
        [
          'Final yield',
          s.grain === 'process' ? '—' : pct(s.finalYield),
          s.grain === 'process' ? 'See assembly completion summary' : 'Assembly completion output / input',
          'cyan',
        ],
        ['Scrap rate', pct(s.scrapRate), 'Reject / input quantity', 'amber'],
        ['Rework rate', '—', 'Awaiting rework data', 'amber'],
        ['Cost of poor quality', fmt(s.copq, 2), 'Reject cost · source currency', ''],
        ['Lots processed', fmt(s.lots), `${fmt(s.input)} input units`, ''],
        ['Products running', fmt(s.products), `${fmt(s.customers)} active customers`, ''],
        ...(s.topLoss
          ? [
              ['Customers running', fmt(s.customers), 'Customers with selected activity', ''],
              ['Top yield loss', s.topLoss, 'Machine ranked by reject quantity', 'amber'],
              ['Top reject process', s.topRejectProcess, 'Process ranked by reject quantity', 'amber'],
              ['Top defect', s.topDefect, 'Failure mode ranked by quantity', 'amber'],
            ]
          : []),
      ].map(([label, value, foot, color]) => (
        <div className="kpi" key={label}>
          <div className="kpi-label">
            {label}
            <Activity size={15} />
          </div>
          <div
            className={'kpi-value ' + color}
            style={{ fontSize: label.startsWith('Top') ? 18 : undefined }}
          >
            {value}
          </div>
          <div className="kpi-foot">{foot}</div>
        </div>
      ))}
    </div>
  );
}
function Breakdown({ rows, onClick }: { rows: any[]; onClick?: (name: string) => void }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Contributor</th>
            <th>Input</th>
            <th>Output</th>
            <th>Reject</th>
            <th>Yield</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                <button className="link" onClick={() => onClick?.(r.name)}>
                  {r.name}
                </button>
              </td>
              <td>{fmt(r.input)}</td>
              <td>{fmt(r.output)}</td>
              <td className="amber">{fmt(r.reject)}</td>
              <td>
                <span className={r.yield < 95 ? 'amber' : 'green'}>{pct(r.yield)}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: Math.min(100, r.yield) + '%' }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">No records match these filters.</div>}
    </div>
  );
}
export default function Page() {
  const [view, setView] = useState('Overview'),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({
      from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    }),
    [options, setOptions] = useState<Record<string, string[]>>({}),
    [advanced, setAdvanced] = useState(false),
    [bucket, setBucket] = useState('day'),
    [dimension, setDimension] = useState('process');
  const [summary, setSummary] = useState<any>({}),
    [coverage, setCoverage] = useState<any>({}),
    [trend, setTrend] = useState<any[]>([]),
    [breakdown, setBreakdown] = useState<any[]>([]),
    [machines, setMachines] = useState<any[]>([]),
    [defects, setDefects] = useState<any[]>([]),
    [operationRejects, setOperationRejects] = useState<any[]>([]),
    [scraps, setScraps] = useState<any[]>([]),
    [lots, setLots] = useState<any>({ rows: [], total: 0 }),
    [page, setPage] = useState(1),
    [lowYieldOnly, setLowYieldOnly] = useState(true),
    [lotTarget, setLotTarget] = useState(98),
    [alerts, setAlerts] = useState<any[]>([]),
    [queries, setQueries] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [dependencies, setDependencies] = useState<any[]>([]),
    [streams, setStreams] = useState<any[]>([]),
    [schedules, setSchedules] = useState<any[]>([]),
    [me, setMe] = useState<any>(null);
  const [lot, setLot] = useState<any>(null),
    [selectedLot, setSelectedLot] = useState(''),
    [aiLot, setAiLot] = useState(''),
    [aiSource, setAiSource] = useState('1'),
    [comment, setComment] = useState(''),
    [edit, setEdit] = useState<any>(null),
    [visual, setVisual] = useState('pareto'),
    [trail, setTrail] = useState<{ dimension: string; value: string }[]>([]),
    [reportName, setReportName] = useState('Daily yield summary'),
    [reportFormat, setReportFormat] = useState('xlsx'),
    [reportFrequency, setReportFrequency] = useState('daily'),
    [spcKind, setSpcKind] = useState('xbar'),
    [spcResult, setSpcResult] = useState<any[]>([]);
  const [spcInput, setSpcInput] = useState(''),
    [baseline, setBaseline] = useState('6.2'),
    [baselineSigma, setBaselineSigma] = useState('0.2'),
    [alertRules, setAlertRules] = useState<any[]>([]);
  const can = (...roles: string[]) => me?.roles?.some((r: string) => roles.includes(r));
  const grain =
    ['Process analysis', 'Equipment'].includes(view) ||
    (view === 'Yield analytics' &&
      ['process', 'machine', 'line', 'shift', 'operator', 'equipmentType'].includes(dimension))
      ? 'process'
      : 'assembly';
  const qs = new URLSearchParams({
    ...filters,
    grain,
    bucket,
    dimension,
    page: String(page),
    ...(view === 'Lot explorer'
      ? {
          lowYieldOnly: String(lowYieldOnly),
          targetYield: String(lotTarget),
          lotSort: lowYieldOnly ? 'yield' : 'date',
        }
      : {}),
  }).toString();
  const action = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = useCallback(async () => {
    if (localAuth) {
      try {
        setMe(await api('/me'));
      } catch {
        setMe(null);
        setBusy(false);
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const [s, t, b, a, o, user, coverageResult] = await Promise.all([
        api('/analytics/summary?' + qs),
        api('/analytics/trend?' + qs),
        dimension === 'lot' ? Promise.resolve([]) : api('/analytics/breakdown?' + qs),
        api('/alerts'),
        api('/filters'),
        api('/me'),
        api('/analytics/coverage?' + qs),
      ]);
      setSummary({ ...s, grain });
      setCoverage(coverageResult);
      setTrend(t);
      setBreakdown(b);
      setAlerts(a);
      setOptions(o);
      setMe(user);
      if (['Overview', 'Equipment'].includes(view)) setMachines(await api('/analytics/equipment?' + qs));
      if (['Overview', 'Defect analysis'].includes(view)) {
        setDefects(await api('/analytics/defects?' + qs));
        if (view === 'Defect analysis')
          setOperationRejects(await api('/analytics/defects-by-operation?' + qs));
        setScraps(await api('/analytics/scraps?' + qs));
      }
      if (['Lot explorer', 'Reports'].includes(view) || (view === 'Yield analytics' && dimension === 'lot'))
        setLots(await api('/lots?' + qs));
      if (view === 'ETL control') {
        const [q, j, d] = await Promise.all([
          api('/etl/queries'),
          api('/etl/jobs'),
          api('/etl/dependencies'),
        ]);
        setDependencies(d);
        setQueries(q);
        setJobs(j);
      }
      if (view === 'SPC monitor') setStreams(await api('/spc?' + qs));
      if (view === 'Reports') setSchedules(await api('/reports/schedules'));
      if (view === 'Alerts' && user.roles.includes('Administrator'))
        setAlertRules(await api('/alerts/rules'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [qs, view, dimension]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (view === 'ETL control') void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [view, refresh]);
  const changeFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const navigate = (name: string) => {
    setView(name);
    setMobile(false);
    if (name === 'Process analysis') setDimension('process');
    if (name === 'Equipment') setDimension('machine');
  };
  const openLot = (name: string, source = '1') =>
    void action(async () => {
      setLot(await api('/lots/' + encodeURIComponent(name) + '?source=' + encodeURIComponent(source)));
      setSelectedLot(name);
    });
  const drillInto = (name: string) => {
    if (dimension === 'lot') {
      openLot(name);
      return;
    }
    const i = drill.indexOf(dimension);
    if (i < 0 || i === drill.length - 1) {
      changeFilter(dimension, name);
      return;
    }
    setTrail((t) => [...t, { dimension, value: name }]);
    changeFilter(dimension, name);
    setDimension(drill[i + 1]);
    setView('Yield analytics');
  };
  const defectGroups = Object.values(
    defects.reduce((acc: any, r: any) => {
      acc[r.code] ??= { name: r.name, code: r.code, qty: 0 };
      acc[r.code].qty += Number(r.qty);
      return acc;
    }, {}),
  ).sort((a: any, b: any) => b.qty - a.qty) as any[];
  const defectEvidence = Object.values(
    defects.reduce((acc: any, r: any) => {
      const key = JSON.stringify([r.code, r.wipOperation ?? null]);
      acc[key] ??= { key, name: r.name, code: r.code, operation: r.wipOperation, qty: 0 };
      acc[key].qty += Number(r.qty);
      return acc;
    }, {}),
  ).sort((a: any, b: any) => b.qty - a.qty) as any[];
  const activeAlerts = alerts.filter((a) => a.status === 'open');
  const newQuery = () =>
    setEdit({
      queryName: '',
      oracleSource: '1',
      targetTable: 'FACT_YIELD',
      schedule: '15m',
      enabled: false,
      loadMode: 'incremental',
      dependsOnQueryId: null,
      lotScope: 'all',
      anchorSource: '1',
      lotBatchSize: 100,
      sqlText:
        'SELECT TRANSACTION_ID AS SOURCE_KEY, LOT_NO, CUSTOMER, PRODUCT, PACKAGE,\n       PROCESS_NAME, MACHINE_ID, INPUT_QTY, OUTPUT_QTY, REJECT_QTY,\n       TRANSACTION_DATE\nFROM LOT_HISTORY\nWHERE LAST_UPDATE_DATE >= :LAST_SYNC_TIME\n  AND LAST_UPDATE_DATE < :SYNC_END_TIME',
    });
  if (localAuth && !me) return <LocalLogin onLogin={refresh} />;
  return (
    <div className="shell">
      {busy && <div className="loading" />}
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <div className="brand">
          <div className="brand-icon">
            <Layers size={23} />
          </div>
          <div>
            UTL-NEXUS<small>YIELD INTELLIGENCE</small>
          </div>
        </div>
        <div className="nav-label">MANUFACTURING WORKSPACE</div>
        {menu.slice(0, 8).map(([name, Icon]) => (
          <button
            key={name}
            className={'nav-button ' + (view === name ? 'active' : '')}
            onClick={() => navigate(name)}
          >
            <Icon size={17} />
            {name}
            {name === 'Alerts' && activeAlerts.length > 0 && (
              <span className="tag warning">{activeAlerts.length}</span>
            )}
          </button>
        ))}
        <div className="nav-label">PLATFORM</div>
        {menu
          .slice(8)
          .filter(
            ([name]) =>
              (name !== 'ETL control' || can('Administrator', 'Yield Engineer')) &&
              (name !== 'User management' || can('Administrator')),
          )
          .map(([name, Icon]) => (
            <button
              key={name}
              className={'nav-button ' + (view === name ? 'active' : '')}
              onClick={() => navigate(name)}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        <div className="sidebar-bottom">
          <div>
            <span className="dot" />
            PostgreSQL analytics
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 10 }}>
            Oracle ACTL + BSM · ETL sources
          </p>
          <p className="muted" style={{ marginTop: 20, fontSize: 10 }}>
            UTL-NEXUS YMS / v1.0
          </p>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <button
            className="mobile-menu link"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={22} />
          </button>
          <div className="context">
            <Factory size={17} />
            <span>Semiconductor Manufacturing</span>
            <ChevronRight size={13} />
            <span className="current-view">{view}</span>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            <span className="tag">
              <span className="dot" />
              {localAuth ? 'LOCAL ACCOUNT' : 'ENTRA SSO'}
            </span>
            <button className="link" aria-label="View alerts" onClick={() => navigate('Alerts')}>
              <Bell size={18} />
            </button>
            <button
              className="avatar"
              onClick={() =>
                void action(async () => {
                  if (localAuth) {
                    await api('/auth/logout', {});
                    setMe(null);
                  } else await login();
                  await refresh();
                })
              }
              aria-label={localAuth ? 'Sign out' : 'Microsoft sign in'}
              title={localAuth ? 'Sign out' : 'Sign in'}
            >
              {me ? (
                String(me.name || me.id)
                  .split(' ')
                  .map((s: string) => s[0])
                  .slice(0, 2)
                  .join('')
              ) : (
                <LogIn size={16} />
              )}
            </button>
          </div>
        </header>
        <main className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">OPERATIONS / YIELD INTELLIGENCE</div>
              <h1>{view === 'Overview' ? 'Manufacturing overview' : view}</h1>
              <p>
                {view === 'Overview'
                  ? 'Every lot. Every process. A clearer path to better yield.'
                  : 'Explore manufacturing evidence from the YMS data warehouse.'}
              </p>
            </div>
            <div className="toolbar">
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
                <RefreshCw size={14} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  void action(() => download('/reports/export?' + qs + '&format=xlsx', 'yms-yield.xlsx'))
                }
              >
                <Download size={14} />
                Export report
              </Button>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}{' '}
              <button
                className="link"
                onClick={() =>
                  void action(async () => {
                    if (localAuth) {
                      await api('/auth/logout', {});
                      setMe(null);
                    } else await login();
                    await refresh();
                  })
                }
              >
                Sign in
              </button>
            </div>
          )}
          {notice && (
            <div className="alert-banner" role="status">
              <CheckCircle2 size={16} />
              {notice}
            </div>
          )}
          {view === 'User management' && can('Administrator') && <UserManagement />}
          {!['ETL control', 'YMS AI Assistance', 'Alerts', 'User management'].includes(view) && (
            <div className="filters">
              {(advanced
                ? [
                    'factory',
                    'customer',
                    'product',
                    'package',
                    'device',
                    'bom',
                    'process',
                    'machine',
                    'line',
                    'shift',
                  ]
                : ['factory', 'customer', 'product', 'process']
              ).map((key) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{key}</label>
                  <select
                    id={key}
                    value={filters[key] || ''}
                    onChange={(e) => changeFilter(key, e.target.value)}
                  >
                    <option value="">
                      All {key === 'factory' ? 'factories' : key === 'process' ? 'processes' : key + 's'}
                    </option>
                    {options[key]?.map((v) => (
                      <option key={v} value={v}>
                        {key === 'factory'
                          ? ({ '120': 'UTL1', '130': 'UTL2A', '140': 'UTL3A' } as Record<string, string>)[
                              v
                            ] || v
                          : v}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {advanced && (
                <div className="field">
                  <label htmlFor="lot-filter">Lot number</label>
                  <input
                    id="lot-filter"
                    value={filters.lot || ''}
                    onChange={(e) => changeFilter('lot', e.target.value)}
                    placeholder="Exact lot number"
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="from">From</label>
                <input
                  id="from"
                  type="date"
                  value={filters.from}
                  onChange={(e) => changeFilter('from', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="to">To</label>
                <input
                  id="to"
                  type="date"
                  value={filters.to}
                  onChange={(e) => changeFilter('to', e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="More filters"
                onClick={() => setAdvanced(!advanced)}
              >
                <SlidersHorizontal size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters({ from: filters.from, to: filters.to });
                  setTrail([]);
                  setPage(1);
                }}
              >
                Reset
              </Button>
            </div>
          )}
          {view === 'Overview' && (
            <>
              {activeAlerts.length > 0 && (
                <div className="alert-banner">
                  <Activity size={16} />
                  <span>{activeAlerts[0].title}</span>
                  <button className="link" style={{ marginLeft: 'auto' }} onClick={() => navigate('Alerts')}>
                    Review alerts <ArrowUpRight size={12} style={{ display: 'inline' }} />
                  </button>
                </div>
              )}
              <Panel
                title="Assembly → process → defect traceability"
                sub="Assembly summaries come from source 1. Detailed process history comes from source 2; TEST area is excluded."
              >
                <div className="statline">
                  <span>
                    Assembly lots<strong>{fmt(coverage.assemblyLots)}</strong>
                  </span>
                  <span>
                    Lots with process history
                    <strong>
                      {fmt(coverage.processLots)} · {pct(coverage.coveragePercentage)}
                    </strong>
                  </span>
                  <span>
                    Process records<strong>{fmt(coverage.processRecords)}</strong>
                  </span>
                  <span>
                    Quality review<strong className="amber">{fmt(coverage.reviewRecords)}</strong>
                  </span>
                  <span>
                    Defect records<strong>{fmt(coverage.defectRecords)}</strong>
                  </span>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  Missing process history is shown as unavailable. Defect details will appear after the defect
                  extraction query is configured.
                </p>
              </Panel>
              <Metrics
                summary={{
                  ...summary,
                  topLoss: machines[0]?.name || '—',
                  topRejectProcess: breakdown[0]?.name || '—',
                  topDefect: defectGroups[0]?.name || '—',
                }}
              />
              <div className="charts">
                <Panel
                  title="Assembly yield performance"
                  sub="Assembly completion yield across your selected period"
                  action={
                    <div className="tabs">
                      {['day', 'week', 'month', 'quarter', 'year'].map((b) => (
                        <button key={b} className={bucket === b ? 'active' : ''} onClick={() => setBucket(b)}>
                          {b}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <Trend data={trend} />
                  <div className="statline">
                    <span>
                      Input units<strong>{fmt(summary.input)}</strong>
                    </span>
                    <span>
                      Good units<strong>{fmt(summary.output)}</strong>
                    </span>
                    <span>
                      Rejected units<strong className="amber">{fmt(summary.reject)}</strong>
                    </span>
                    <span>
                      Target<strong>98.00%</strong>
                    </span>
                  </div>
                </Panel>
                <Panel
                  title="Yield loss contributors"
                  sub="Reject quantity by process · cumulative contribution"
                  action={<span className="tag">PARETO</span>}
                >
                  <Pareto data={breakdown} />
                  <div className="statline">
                    <span>
                      Top reject process<strong>{breakdown[0]?.name || '—'}</strong>
                    </span>
                    <span>
                      Top defect<strong>{defectGroups[0]?.name || '—'}</strong>
                    </span>
                  </div>
                </Panel>
              </div>
              <div className="charts">
                <Panel
                  title="Process performance"
                  sub="Click a process to investigate its equipment"
                  action={
                    <button className="link" onClick={() => navigate('Process analysis')}>
                      Explore <ArrowUpRight size={13} style={{ display: 'inline' }} />
                    </button>
                  }
                >
                  <Breakdown
                    rows={breakdown.slice(0, 7)}
                    onClick={(name) => {
                      setDimension('process');
                      changeFilter('process', name);
                      setDimension('machine');
                      setView('Yield analytics');
                    }}
                  />
                </Panel>
                <Panel title="Equipment watchlist" sub="Machines ranked by yield loss">
                  <Breakdown
                    rows={machines.slice(0, 5)}
                    onClick={(name) => {
                      changeFilter('machine', name);
                      navigate('Equipment');
                    }}
                  />
                </Panel>
              </div>
            </>
          )}
          {['Yield analytics', 'Process analysis'].includes(view) && (
            <>
              <div className="toolbar" style={{ marginBottom: 18 }}>
                <span className="muted">Analyze by</span>
                <select
                  aria-label="Analytics dimension"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                >
                  {[
                    'customer',
                    'product',
                    'package',
                    'bom',
                    'lot',
                    'process',
                    'machine',
                    'factory',
                    'line',
                    'shift',
                    'operator',
                  ].map((x) => (
                    <option key={x} value={x}>
                      {x === 'equipmentType' ? 'Equipment type' : x}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Trend interval"
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                >
                  {['day', 'week', 'month', 'quarter', 'year'].map((x) => (
                    <option key={x} value={x}>
                      {x === 'equipmentType' ? 'Equipment type' : x}
                    </option>
                  ))}
                </select>
              </div>
              <div className="breadcrumb">
                <button
                  onClick={() => {
                    setFilters({ from: filters.from, to: filters.to });
                    setDimension('customer');
                    setTrail([]);
                  }}
                >
                  All manufacturing
                </button>
                {trail.map((t, i) => (
                  <span key={i}>
                    <ChevronRight size={13} style={{ display: 'inline' }} />
                    <button
                      onClick={() => {
                        const f = { ...filters };
                        trail.slice(i).forEach((x) => delete f[x.dimension]);
                        setFilters(f);
                        setTrail(trail.slice(0, i));
                        setDimension(t.dimension);
                      }}
                    >
                      {t.value}
                    </button>
                  </span>
                ))}
              </div>
              {dimension === 'lot' ? (
                <Panel title="Lots in selection">
                  <LotGrid
                    rows={lots.rows}
                    onLot={(name) => {
                      changeFilter('lot', name);
                      setTrail((t) => [...t, { dimension: 'lot', value: name }]);
                      setDimension('process');
                    }}
                  />
                </Panel>
              ) : (
                <>
                  <div className="charts">
                    <Panel title="Yield trend">
                      <Trend data={trend} />
                    </Panel>
                    <Panel title="Loss Pareto">
                      <Pareto data={breakdown} />
                    </Panel>
                  </div>
                  <Panel title={'Yield by ' + dimension} sub="Select a tile to drill into the next level">
                    <div className="heatmap">
                      {breakdown.map((r) => (
                        <button
                          className="heat-cell"
                          key={r.name}
                          onClick={() => drillInto(r.name)}
                          style={{
                            background:
                              r.yield >= 98
                                ? 'var(--heat-good)'
                                : r.yield >= 95
                                  ? 'var(--heat-normal)'
                                  : 'var(--heat-low)',
                          }}
                        >
                          <span>{r.name}</span>
                          <strong className={r.yield >= 95 ? 'cyan' : 'amber'}>{pct(r.yield)}</strong>
                          <small>{fmt(r.reject)} rejects</small>
                        </button>
                      ))}
                    </div>
                  </Panel>
                  <div style={{ height: 20 }} />
                  <Panel title="Detailed performance">
                    <Breakdown rows={breakdown} onClick={drillInto} />
                  </Panel>
                </>
              )}
            </>
          )}
          {view === 'Lot explorer' && (
            <Panel
              title="Lot yield investigation"
              sub={`${fmt(lots.total)} lots in selection · ${lowYieldOnly ? 'lowest yield first' : 'latest completion first'} · select a lot to verify quantities and trace process evidence`}
            >
              <div className="toolbar" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={lowYieldOnly}
                    onChange={(e) => {
                      setLowYieldOnly(e.target.checked);
                      setPage(1);
                    }}
                  />{' '}
                  Below target only
                </label>
                <label>
                  Investigation target (%){' '}
                  <input
                    aria-label="Lot investigation target"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={lotTarget}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0 && n <= 100) {
                        setLotTarget(n);
                        setPage(1);
                      }
                    }}
                    style={{ width: 90 }}
                  />
                </label>
                <span className="muted">
                  Uses latest assembly completion within selected dates. Target is for investigation.
                </span>
              </div>
              <LotGrid rows={lots.rows} onLot={openLot} target={lotTarget} />
              {!lots.rows.length && (
                <p className="empty">
                  No lots match this target and filter selection. Adjust the target, date range, or turn off
                  Below target only.
                </p>
              )}
              <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 15 }}>
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="muted">Page {page}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * 50 >= lots.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </Panel>
          )}
          {view === 'Equipment' && (
            <>
              <Metrics summary={summary} />
              <div className="charts">
                <Panel title="Machine yield loss">
                  <Pareto data={machines} />
                </Panel>
                <Panel title="Equipment yield trend">
                  <Trend data={trend} />
                </Panel>
              </div>
              <Panel
                title="Equipment reliability"
                sub="MTBF and MTTR in minutes · calculated from recorded downtime events"
              >
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        {['Machine', 'Input', 'Reject', 'Yield', 'MTBF', 'MTTR'].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {machines.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td>{fmt(r.input)}</td>
                          <td>{fmt(r.reject)}</td>
                          <td className="cyan">{pct(r.yield)}</td>
                          <td>{r.mtbf === null ? 'No events' : fmt(r.mtbf, 1)}</td>
                          <td>{r.mttr === null ? 'No events' : fmt(r.mttr, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {view === 'Defect analysis' && (
            <>
              <DefectFilters
                filters={filters}
                onChange={setFilters}
                admin={me?.roles?.includes('Administrator')}
              />
              <div className="charts">
                <Panel
                  title="Defect distribution"
                  sub="Reject code and failure mode contribution"
                  action={
                    <select
                      aria-label="Defect visualization"
                      value={visual}
                      onChange={(e) => setVisual(e.target.value)}
                    >
                      {['pareto', 'treemap', 'bubble', 'heatmap', 'trend'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  }
                >
                  {visual === 'heatmap' ? (
                    <div className="heatmap">
                      {defectGroups.map((r) => (
                        <div key={r.code} className="heat-cell" style={{ background: 'var(--heat-normal)' }}>
                          {r.name}
                          <strong className="cyan">{fmt(r.qty)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : visual === 'trend' ? (
                    <Trend
                      spc
                      data={Object.values(
                        defects.reduce((a: any, r) => {
                          const key = r.date.slice(0, 10);
                          a[key] ??= { label: key, value: 0 };
                          a[key].value += Number(r.qty);
                          return a;
                        }, {}),
                      ).sort((a: any, b: any) => a.label.localeCompare(b.label))}
                    />
                  ) : (
                    <DefectVisual data={defectGroups} kind={visual} />
                  )}
                </Panel>
                <Panel title="Scrap causes" sub="Discarded quantity by reason">
                  <Pareto data={scraps} />
                </Panel>
              </div>
              <Panel
                title="Defects by operation"
                sub="Reject quantity ranked highest to lowest · WIP_OPTN_CODE · current filters"
              >
                <OperationRejectChart data={operationRejects} />
              </Panel>
              <Panel title="Defect evidence">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Failure mode</th>
                        <th title="Oracle WIP_OPTN_CODE">Operation</th>
                        <th>Quantity</th>
                        <th>Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {defectEvidence.map((r) => (
                        <tr key={r.key}>
                          <td className="cyan">{r.code}</td>
                          <td>{r.name}</td>
                          <td>{r.operation || '—'}</td>
                          <td>{fmt(r.qty)}</td>
                          <td>
                            {pct(
                              (r.qty /
                                Math.max(
                                  1,
                                  defectGroups.reduce((s, x) => s + x.qty, 0),
                                )) *
                                100,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {view === 'SPC monitor' && (
            <>
              <Panel
                title="Control chart calculator"
                sub="X-bar and R use measured subgroup ranges; P, NP and U use counts and sample sizes"
              >
                <div className="toolbar">
                  <select
                    aria-label="Control chart type"
                    value={spcKind}
                    onChange={(e) => setSpcKind(e.target.value)}
                  >
                    {['xbar', 'r', 'p', 'np', 'u', 'cusum'].map((x) => (
                      <option key={x} value={x}>
                        {x === 'equipmentType' ? 'Equipment type' : x}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void action(async () => {
                        if (spcInput.trim()) {
                          let samples: unknown;
                          try {
                            samples = JSON.parse(spcInput);
                          } catch {
                            throw new Error('Enter a valid JSON array of value, n and range samples');
                          }
                          setSpcResult(
                            await api('/spc/calculate', {
                              kind: spcKind,
                              samples,
                              target: Number(baseline),
                              sigma: Number(baselineSigma),
                            }),
                          );
                          return;
                        }
                        const points = streams[0]?.points || [];
                        if (points.length < 2) throw new Error('Select a stream with at least two readings');
                        const groups = Object.values(
                          points.reduce((a: any, p: any) => {
                            a[p.subgroup] ??= [];
                            a[p.subgroup].push(p);
                            return a;
                          }, {}),
                        ) as any[][];
                        const samples = groups
                          .filter((g) => !['xbar', 'r'].includes(spcKind) || g.length === g[0].sampleSize)
                          .map((g) => ({
                            value: ['p', 'np', 'u'].includes(spcKind)
                              ? g.reduce((s, p) => s + p.value, 0)
                              : g.reduce((s, p) => s + p.value, 0) / g.length,
                            n: g[0].sampleSize,
                            range: Math.max(...g.map((p) => p.value)) - Math.min(...g.map((p) => p.value)),
                          }));
                        setSpcResult(
                          await api('/spc/calculate', {
                            kind: spcKind,
                            samples,
                            target: points[0].target,
                            sigma: (points[0].ucl - points[0].lcl) / 6,
                          }),
                        );
                      })
                    }
                  >
                    Calculate control chart
                  </Button>
                </div>
                <div className="toolbar" style={{ marginTop: 14 }}>
                  <div className="field">
                    <label htmlFor="baseline">CUSUM baseline target</label>
                    <input
                      id="baseline"
                      type="number"
                      step="any"
                      value={baseline}
                      onChange={(e) => setBaseline(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="baseline-sigma">CUSUM baseline sigma</label>
                    <input
                      id="baseline-sigma"
                      type="number"
                      step="any"
                      value={baselineSigma}
                      onChange={(e) => setBaselineSigma(e.target.value)}
                    />
                  </div>
                </div>
                <textarea
                  aria-label="Custom control chart samples"
                  value={spcInput}
                  onChange={(e) => setSpcInput(e.target.value)}
                  placeholder={
                    'Optional custom samples: [{"value":10,"n":100,"range":0},{"value":12,"n":100,"range":0}]\nLeave blank to use complete subgroups from the first stream.'
                  }
                  style={{ width: '100%', marginTop: 14, minHeight: 80 }}
                />
                {spcResult.length > 0 && (
                  <Trend spc data={spcResult.map((p, i) => ({ ...p, label: String(i + 1) }))} />
                )}
              </Panel>
              <div style={{ height: 20 }} />
              {streams.map((s) => (
                <div key={s.key} style={{ marginBottom: 20 }}>
                  <Panel
                    title={s.label}
                    sub="Individual observations · configured control limits · Western Electric rules"
                  >
                    <Trend spc data={s.points.map((p: any, i: number) => ({ ...p, label: String(i + 1) }))} />
                    <div className="statline">
                      <span>
                        Readings<strong>{s.points.length}</strong>
                      </span>
                      <span>
                        Rule violations
                        <strong className="amber">
                          {s.points.filter((p: any) => p.rules.length).length}
                        </strong>
                      </span>
                      <span>
                        Latest rule<strong>{s.points.at(-1)?.rules.join(', ') || 'Within control'}</strong>
                      </span>
                    </div>
                  </Panel>
                </div>
              ))}
              {!streams.length && <div className="empty">No SPC measurements in this selection.</div>}
            </>
          )}
          {view === 'Alerts' && (
            <>
              <Panel title="Manufacturing alerts" sub="Yield, scrap, machine, defect spike and SPC events">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Alert</th>
                        <th>Type</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <span className={'tag ' + a.severity}>{a.severity}</span>
                          </td>
                          <td>{a.title}</td>
                          <td>{a.type}</td>
                          <td>{date(a.createdAt)}</td>
                          <td>{a.status}</td>
                          <td>
                            {a.status === 'open' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void action(async () => {
                                    await api('/alerts/' + a.id + '/acknowledge', {});
                                    await refresh();
                                  })
                                }
                              >
                                Acknowledge
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!alerts.length && <div className="empty">No alerts have been generated.</div>}
              </Panel>
              {can('Administrator') && (
                <div style={{ marginTop: 20 }}>
                  <Panel
                    title="Alert rules"
                    sub="Approve process thresholds before enabling automatic alerts"
                  >
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Rule</th>
                          <th>Threshold</th>
                          <th>Enabled</th>
                          <th>Save</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertRules.map((r, i) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                aria-label={r.name + ' threshold'}
                                value={r.threshold}
                                onChange={(e) =>
                                  setAlertRules((old) =>
                                    old.map((x, j) =>
                                      j === i ? { ...x, threshold: Number(e.target.value) } : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={r.name + ' enabled'}
                                checked={r.enabled}
                                onChange={(e) =>
                                  setAlertRules((old) =>
                                    old.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <Button
                                size="sm"
                                onClick={() =>
                                  void action(async () => {
                                    await api(
                                      '/alerts/rules/' + r.id,
                                      { threshold: r.threshold, enabled: r.enabled },
                                      'PUT',
                                    );
                                    setNotice('Alert rule saved');
                                  })
                                }
                              >
                                Save
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Panel>
                </div>
              )}
            </>
          )}
          {view === 'ETL control' && (
            <>
              <div className="kpi-grid">
                {[
                  ['Oracle sources', '2', 'ACTL / BSM'],
                  ['Enabled queries', queries.filter((q) => q.enabled).length, 'Scheduled ingestion'],
                  [
                    'Last completed import',
                    jobs.find((j) => ['success', 'partial'].includes(j.status))
                      ? date(jobs.find((j) => ['success', 'partial'].includes(j.status)).endTime)
                      : 'Never',
                    'Includes partial imports; checkpoint advances only on success',
                  ],
                  ['Failed records', jobs.reduce((s, j) => s + j.failedRecords, 0), 'Recent 100 jobs'],
                ].map(([label, value, foot]) => (
                  <div className="kpi" key={label}>
                    <div className="kpi-label">{label}</div>
                    <div
                      className="kpi-value"
                      style={{ fontSize: label === 'Last completed import' ? 17 : 30 }}
                    >
                      {value}
                    </div>
                    <div className="kpi-foot">{foot}</div>
                  </div>
                ))}
              </div>
              <Panel
                title="Extraction query master"
                sub="Source SQL runs only in the isolated ETL service"
                action={
                  <Button size="sm" onClick={newQuery}>
                    <Plus size={14} />
                    New query
                  </Button>
                }
              >
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Query</th>
                        <th>Source</th>
                        <th>Target</th>
                        <th>Schedule</th>
                        <th>Mode</th>
                        <th>Last sync</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queries.map((q) => (
                        <tr key={q.id}>
                          <td>
                            <button className="link" onClick={() => setEdit(q)}>
                              {q.queryName}
                            </button>
                          </td>
                          <td>{q.oracleSource === '1' ? 'ACTL' : 'BSM'}</td>
                          <td>{q.targetTable}</td>
                          <td>
                            {q.dependsOnQueryId
                              ? 'After ' +
                                (queries.find((parent) => parent.id === q.dependsOnQueryId)?.queryName ||
                                  'assembly job')
                              : q.schedule}{' '}
                            · {q.enabled ? 'On' : 'Off'}
                          </td>
                          <td>{q.loadMode}</td>
                          <td>{date(q.lastSyncTime)}</td>
                          <td>
                            <div className="toolbar">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void action(async () => {
                                    const r = await api('/etl/queries/' + q.id + '/run', { test: true });
                                    setNotice('SQL test queued: ' + r.jobId);
                                  })
                                }
                              >
                                Test
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  void action(async () => {
                                    const r = await api('/etl/queries/' + q.id + '/run', {});
                                    setNotice(
                                      `ETL run ${r.jobId} queued · ${r.loadMode} · configuration v${r.queryVersion}`,
                                    );
                                  })
                                }
                              >
                                <Play size={12} />
                                Run
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <div style={{ height: 20 }} />
              <Panel
                title="Automatic follow-up jobs"
                sub="Assembly import → source-2 process / defect refresh. Pending follow-ups wait for any active import of the same job to finish."
              >
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        {[
                          'Assembly job',
                          'Following job',
                          'Assembly result',
                          'Follow-up',
                          'Process result',
                          'Requested',
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dependencies.map((d) => (
                        <tr key={d.id}>
                          <td>
                            {d.parentJobName}
                            <small style={{ display: 'block' }}>Run {d.parentJobId.slice(0, 8)}</small>
                          </td>
                          <td>{d.childQueryName}</td>
                          <td>{d.parentStatus}</td>
                          <td>{d.status}</td>
                          <td>
                            {d.executionStatus || 'Waiting'}
                            {d.phase ? ' · ' + d.phase : ''}
                          </td>
                          <td>{date(d.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!dependencies.length && (
                    <div className="empty">
                      No follow-up requested yet. The next AEY completion will queue its linked process job.
                    </div>
                  )}
                </div>
              </Panel>
              <Panel
                title="Synchronization log"
                sub="Live phases, counts, and cohort progress · refreshes every 5 seconds"
              >
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Started</th>
                        <th>Status</th>
                        <th>Imported</th>
                        <th>Failed</th>
                        <th>Duration</th>
                        <th>Mode / version</th>
                        <th>Execution progress</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.id}>
                          <td>{j.jobName}</td>
                          <td>{date(j.startTime)}</td>
                          <td>
                            <span
                              className={
                                'tag ' +
                                (j.status === 'failed' ? 'critical' : j.status === 'partial' ? 'warning' : '')
                              }
                            >
                              {j.status}
                            </span>
                          </td>
                          <td>{fmt(j.rowsProcessed)}</td>
                          <td className="amber">{fmt(j.failedRecords)}</td>
                          <td>
                            {j.endTime
                              ? fmt((+new Date(j.endTime) - +new Date(j.startTime)) / 1000, 1) + 's'
                              : 'Running'}
                          </td>
                          <td>
                            {j.loadMode || 'Historical'}
                            {j.queryVersion ? ` · v${j.queryVersion}` : ''}
                          </td>
                          <td style={{ minWidth: 210 }}>
                            <div>
                              {j.phase || j.status}
                              {j.progressPercent !== null && j.progressPercent !== undefined
                                ? ` · ${fmt(j.progressPercent, 0)}%`
                                : ''}
                            </div>
                            {j.progressPercent !== null && j.progressPercent !== undefined && (
                              <progress
                                max={100}
                                value={j.progressPercent}
                                style={{ width: '100%', accentColor: '#20d4e5' }}
                              />
                            )}
                            <small>
                              {fmt(j.rowsRead || j.rowsProcessed)} rows read · {fmt(j.batchesProcessed || 0)}{' '}
                              batches
                              {j.totalLots !== null && j.totalLots !== undefined
                                ? ` · ${fmt(j.processedLots)} / ${fmt(j.totalLots)} lots`
                                : ''}
                            </small>
                          </td>
                          <td style={{ maxWidth: 360, whiteSpace: 'normal' }}>
                            {(j.errors || [])
                              .map(
                                (e: any) =>
                                  e.message ||
                                  (e.duplicateRecords ? `${e.duplicateRecords} duplicate records` : ''),
                              )
                              .filter(Boolean)
                              .join('; ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {view === 'Reports' && (
            <>
              <Panel
                title="Export yield analysis"
                sub="Reports use the current filters and selected dimension"
              >
                <div className="toolbar">
                  {['xlsx', 'csv', 'pdf', 'pptx'].map((format) => (
                    <Button
                      key={format}
                      variant="outline"
                      onClick={() =>
                        void action(() =>
                          download('/reports/export?' + qs + '&format=' + format, 'yms-yield.' + format),
                        )
                      }
                    >
                      <Download size={15} />
                      {format.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </Panel>
              <div style={{ height: 20 }} />
              <Panel
                title="Scheduled reports"
                sub="Background generation · downloads available after the next worker cycle"
              >
                <div className="toolbar" style={{ marginBottom: 20 }}>
                  <input
                    aria-label="Report name"
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                  />
                  <select
                    aria-label="Report format"
                    value={reportFormat}
                    onChange={(e) => setReportFormat(e.target.value)}
                  >
                    {['xlsx', 'csv', 'pdf', 'pptx'].map((x) => (
                      <option key={x} value={x}>
                        {x === 'equipmentType' ? 'Equipment type' : x}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Report frequency"
                    value={reportFrequency}
                    onChange={(e) => setReportFrequency(e.target.value)}
                  >
                    {['15m', '30m', 'hourly', 'daily'].map((x) => (
                      <option key={x} value={x}>
                        {x === 'equipmentType' ? 'Equipment type' : x}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() =>
                      void action(async () => {
                        await api('/reports/schedules', {
                          name: reportName,
                          format: reportFormat,
                          schedule: reportFrequency,
                          filters: { ...filters, dimension },
                        });
                        await refresh();
                      })
                    }
                  >
                    Create schedule
                  </Button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Frequency</th>
                      <th>Format</th>
                      <th>Latest runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.schedule}</td>
                        <td>{s.format}</td>
                        <td>
                          {s.runs.map((r: any) => (
                            <div key={r.id}>
                              {r.status === 'success' ? (
                                <button
                                  className="link"
                                  onClick={() =>
                                    void action(() =>
                                      download('/reports/runs/' + r.id, 'yms-report.' + s.format),
                                    )
                                  }
                                >
                                  {date(r.createdAt)} · Download
                                </button>
                              ) : (
                                r.status
                              )}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </>
          )}
          {view === 'YMS AI Assistance' && (
            <AiAssistance
              admin={me?.roles?.includes('Administrator')}
              filters={filters}
              initialLot={aiLot}
              initialSource={aiSource}
            />
          )}
          <footer className="footer">
            <span>YMS DATA WAREHOUSE / PostgreSQL · Oracle sources isolated through ETL</span>
            <span>{busy ? 'Updating…' : `Selected period: ${filters.from} – ${filters.to}`}</span>
          </footer>
        </main>
      </div>
      {edit && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Extraction query editor">
            <div className="panel-head">
              <h2>{edit.id ? 'Edit extraction query' : 'New extraction query'}</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close query editor"
                onClick={() => setEdit(null)}
              >
                <X size={20} />
              </Button>
            </div>
            <form
              className="query-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const {
                    id,
                    queryName,
                    oracleSource,
                    targetTable,
                    sqlText,
                    schedule,
                    enabled,
                    loadMode,
                    lotScope,
                    anchorSource,
                    lotBatchSize,
                    dependsOnQueryId,
                    version,
                  } = edit;
                  if (
                    loadMode !== 'full' &&
                    (!/:LAST_SYNC_TIME\b/i.test(sqlText) || !/:SYNC_END_TIME\b/i.test(sqlText))
                  )
                    throw new Error(
                      'Cannot save this mode: incremental and delta SQL require :LAST_SYNC_TIME and :SYNC_END_TIME. Full mode loads all rows returned by your SQL.',
                    );
                  const saved = await api(
                    '/etl/queries' + (id ? '/' + id : ''),
                    {
                      queryName,
                      oracleSource,
                      targetTable,
                      sqlText,
                      schedule,
                      enabled,
                      loadMode,
                      lotScope,
                      anchorSource,
                      lotBatchSize,
                      dependsOnQueryId,
                      version,
                    },
                    id ? 'PUT' : 'POST',
                  );
                  setEdit(null);
                  setNotice(
                    `Saved ${saved.loadMode} mode (version ${saved.version}). Newly queued jobs use this configuration; running jobs keep their original mode.`,
                  );
                  await refresh();
                });
              }}
            >
              <input
                aria-label="Query name"
                required
                placeholder="Query name"
                value={edit.queryName}
                onChange={(e) => setEdit({ ...edit, queryName: e.target.value })}
              />
              <div className="toolbar">
                {[
                  ['oracleSource', ['1', '2']],
                  [
                    'targetTable',
                    [
                      'FACT_YIELD',
                      'FACT_LOT_MATERIAL',
                      'FACT_LOT_PROCESS',
                      'FACT_LOT_DEFECT',
                      'FACT_DEFECT',
                      'FACT_SCRAP',
                      'FACT_SPC',
                    ],
                  ],
                  ['schedule', ['15m', '30m', 'hourly', 'daily']],
                  ['loadMode', ['incremental', 'delta', 'full']],
                  ['lotScope', ['all', 'assembly_lots']],
                  ['anchorSource', ['1', '2']],
                ].map(([key, values]) => (
                  <div className="field" key={key as string}>
                    <label>{key}</label>
                    <select
                      aria-label={key as string}
                      disabled={key === 'schedule' && !!edit.dependsOnQueryId}
                      value={edit[key as string]}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          [key as string]: e.target.value,
                          ...(key === 'targetTable' && e.target.value.startsWith('FACT_LOT_')
                            ? { lotScope: 'assembly_lots', oracleSource: '2' }
                            : {}),
                        })
                      }
                    >
                      {(values as string[]).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {edit.lotScope === 'assembly_lots' && (
                <label>
                  Run automatically after assembly job
                  <select
                    aria-label="Run after assembly job"
                    value={edit.dependsOnQueryId || ''}
                    onChange={(e) => setEdit({ ...edit, dependsOnQueryId: e.target.value || null })}
                  >
                    <option value="">Use independent schedule</option>
                    {queries
                      .filter(
                        (q) =>
                          q.targetTable === 'FACT_YIELD' &&
                          q.id !== edit.id &&
                          q.oracleSource === edit.anchorSource,
                      )
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.queryName}
                        </option>
                      ))}
                  </select>
                  <small>
                    With automatic execution enabled, every successful or partial assembly import queues this
                    job. Existing lots are rechecked with full mode. Failed imports and SQL tests do not
                    trigger it.
                  </small>
                </label>
              )}
              <div className="alert-banner">
                {edit.loadMode === 'full'
                  ? 'Full: upsert all rows returned by SQL. Source WHERE limits still apply.'
                  : edit.loadMode === 'incremental'
                    ? 'Incremental: upsert new and corrected rows between the two synchronization timestamp binds.'
                    : 'Delta: insert new source keys only; existing keys are preserved.'}
              </div>
              {edit.lotScope === 'assembly_lots' && (
                <>
                  <label>
                    Lots per source query
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={edit.lotBatchSize || 100}
                      onChange={(e) => setEdit({ ...edit, lotBatchSize: Number(e.target.value) })}
                    />
                  </label>
                  <small>
                    Uses existing assembly lot numbers from PostgreSQL. SQL must filter on IN (:LOT_LIST) and
                    return canonical LOT_NO plus a unique SOURCE_KEY for each process or defect record.
                  </small>
                </>
              )}
              <textarea
                aria-label="Oracle SELECT query"
                value={edit.sqlText}
                onChange={(e) => setEdit({ ...edit, sqlText: e.target.value })}
              />
              <small>
                Use stable SOURCE_KEY and immutable TRANSACTION_DATE. Incremental queries require
                LAST_SYNC_TIME and SYNC_END_TIME binds against the source update timestamp.
              </small>
              <label>
                <input
                  type="checkbox"
                  checked={edit.enabled}
                  onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
                />{' '}
                Enable automatic execution
              </label>
              <Button disabled={busy} type="submit">
                Save query
              </Button>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
            </form>
          </section>
        </div>
      )}
      {lot && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Lot detail">
            <div className="panel-head">
              <div>
                <div className="eyebrow">LOT TRACEABILITY</div>
                <h1>{selectedLot}</h1>
                <p className="muted">
                  {lot.history[0]?.customer.name} / {lot.history[0]?.product.name} /{' '}
                  {lot.history[0]?.product.package} / {lot.history[0]?.product.device} /{' '}
                  {lot.history[0]?.bom.name} / {lot.history[0]?.factory}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close lot detail" onClick={() => setLot(null)}>
                <X size={20} />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setAiLot(selectedLot);
                setAiSource(lot.assembly?.source || '1');
                setLot(null);
                setView('YMS AI Assistance');
              }}
            >
              Investigate this lot with AI
            </Button>
            <div className="statline" style={{ marginBottom: 20 }}>
              <span>
                Assembly input<strong>{fmt(lot.assembly?.inputQty)}</strong>
              </span>
              <span>
                Assembly output<strong>{fmt(lot.assembly?.outputQty)}</strong>
              </span>
              <span>
                Assembly reject<strong>{fmt(lot.assembly?.rejectQty)}</strong>
              </span>
              <span>
                Assembly yield
                <strong className="cyan">{pct(lot.assembly?.yieldPercentage)}</strong>
              </span>
            </div>
            <LotYieldVerification
              key={selectedLot + ':' + (lot.assembly?.source || '1')}
              lot={lot}
              target={lotTarget}
            />
            <Trend
              data={(lot.processHistory || [])
                .filter((h: any) => h.completedAt && h.yieldPercentage !== null)
                .map((h: any) => ({
                  date: h.completedAt,
                  yield: Number(h.yieldPercentage),
                }))}
            />
            <h2>Process and machine history · {fmt(lot.processTotal)} records</h2>
            <p className="muted">Source 2 · ordered by operation sequence · TEST area excluded</p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {[
                      'Sequence',
                      'Process',
                      'Machine',
                      'Input',
                      'Output',
                      'Reject',
                      'Yield',
                      'Completed',
                      'Quality',
                      'Source data',
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(lot.processHistory || []).map((h: any) => (
                    <tr key={h.id}>
                      <td>{h.operationSequence ?? '—'}</td>
                      <td>{h.process.name}</td>
                      <td>{h.machine.name}</td>
                      <td>{h.inputQty === null ? '—' : fmt(h.inputQty)}</td>
                      <td>{h.outputQty === null ? '—' : fmt(h.outputQty)}</td>
                      <td>{h.rejectQty === null ? '—' : fmt(h.rejectQty)}</td>
                      <td className="cyan">{h.yieldPercentage === null ? '—' : pct(h.yieldPercentage)}</td>
                      <td>{h.completedAt ? date(h.completedAt) : 'Pending'}</td>
                      <td title={JSON.stringify(h.qualityErrors)}>{h.qualityStatus}</td>
                      <td>
                        <details>
                          <summary className="link">View fields</summary>
                          <pre style={{ maxWidth: 380, maxHeight: 240, overflow: 'auto', fontSize: 11 }}>
                            {JSON.stringify(h.rawPayload, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!lot.processTotal && (
              <div className="empty">Process history has not been imported for this lot yet.</div>
            )}
            {lot.processTotal > lot.processLimit && (
              <div className="toolbar">
                <Button
                  disabled={lot.processPage <= 1}
                  onClick={() =>
                    void action(async () =>
                      setLot(
                        await api(
                          '/lots/' +
                            encodeURIComponent(selectedLot) +
                            '?source=' +
                            encodeURIComponent(lot.assembly?.source || '1') +
                            '&processPage=' +
                            (lot.processPage - 1),
                        ),
                      ),
                    )
                  }
                >
                  Previous processes
                </Button>
                <span>Page {lot.processPage}</span>
                <Button
                  disabled={lot.processPage * lot.processLimit >= lot.processTotal}
                  onClick={() =>
                    void action(async () =>
                      setLot(
                        await api(
                          '/lots/' +
                            encodeURIComponent(selectedLot) +
                            '?source=' +
                            encodeURIComponent(lot.assembly?.source || '1') +
                            '&processPage=' +
                            (lot.processPage + 1),
                        ),
                      ),
                    )
                  }
                >
                  Next processes
                </Button>
              </div>
            )}
            <h2 style={{ marginTop: 20 }}>Materials · {fmt(lot.materialTotal)} records</h2>
            <p className="muted">Source 2 · ordered by material sequence · refreshed after AEY</p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {['Sequence', 'Item group', 'Size / type', 'Item number', 'Material lot'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(lot.materials || []).map((m: any) => (
                    <tr key={m.id}>
                      <td>{m.sequenceNo}</td>
                      <td>{m.itemGroup ?? '—'}</td>
                      <td>{m.sizeType ?? '—'}</td>
                      <td>{m.itemNo ?? '—'}</td>
                      <td>{m.itemLotNo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!lot.materialTotal && (
              <div className="empty">Material history has not been imported for this lot yet.</div>
            )}
            {lot.materialTotal > 100 && (
              <div className="toolbar">
                <Button
                  disabled={lot.materialPage <= 1}
                  onClick={() =>
                    void action(async () =>
                      setLot(
                        await api(
                          '/lots/' +
                            encodeURIComponent(selectedLot) +
                            '?source=' +
                            encodeURIComponent(lot.assembly?.source || '1') +
                            '&materialPage=' +
                            (lot.materialPage - 1),
                        ),
                      ),
                    )
                  }
                >
                  Previous materials
                </Button>
                <span>Page {lot.materialPage}</span>
                <Button
                  disabled={lot.materialPage * 100 >= lot.materialTotal}
                  onClick={() =>
                    void action(async () =>
                      setLot(
                        await api(
                          '/lots/' +
                            encodeURIComponent(selectedLot) +
                            '?source=' +
                            encodeURIComponent(lot.assembly?.source || '1') +
                            '&materialPage=' +
                            (lot.materialPage + 1),
                        ),
                      ),
                    )
                  }
                >
                  Next materials
                </Button>
              </div>
            )}
            <LotDefectHistory key={selectedLot} defects={lot.defects} />
            <h2 style={{ marginTop: 20 }}>Engineering comments</h2>
            {lot.comments.map((c: any) => (
              <p key={c.id} style={{ marginTop: 12 }}>
                {c.body}
                <small style={{ display: 'block' }}>
                  {c.author} · {date(c.createdAt)}
                </small>
              </p>
            ))}
            <div className="toolbar" style={{ marginTop: 14 }}>
              <input
                aria-label="Lot comment"
                style={{ flex: 1 }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an engineering observation…"
              />
              <Button
                disabled={!comment.trim()}
                onClick={() =>
                  void action(async () => {
                    await api('/lots/' + encodeURIComponent(selectedLot) + '/comments', { text: comment });
                    setComment('');
                    setLot(await api('/lots/' + encodeURIComponent(selectedLot)));
                  })
                }
              >
                Add comment
              </Button>
            </div>
            <h2 style={{ marginTop: 20 }}>Attachments</h2>
            <div className="toolbar" style={{ marginTop: 12 }}>
              {lot.attachments.map((f: any) => (
                <button
                  className="link"
                  key={f.id}
                  onClick={() => void action(() => download('/attachments/' + f.id, f.name))}
                >
                  {f.name}
                </button>
              ))}
              <input
                aria-label="Upload lot attachment"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void action(async () => {
                      const data = new FormData();
                      data.append('file', file);
                      await request('/lots/' + encodeURIComponent(selectedLot) + '/attachments', {
                        method: 'POST',
                        body: data,
                      });
                      setLot(await api('/lots/' + encodeURIComponent(selectedLot)));
                    });
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
