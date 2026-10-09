'use client';
import { useEffect, useState } from 'react';
import { Sparkles, ArrowUpRight, Settings2 } from 'lucide-react';
import { api, request } from '../lib/api';
import { Button } from './ui/button';
import AssistanceAnswer from './assistance-answer';
const suggestions = [
  'Show top contributors affecting yield.',
  'Compare customer yield this month versus last month.',
  'Which machine has the highest reject quantity?',
  'What process has the highest yield loss?',
];
export default function AiAssistance({
  admin,
  filters,
  initialLot = '',
  initialSource = '1',
}: {
  admin: boolean;
  filters: Record<string, string>;
  initialLot?: string;
  initialSource?: string;
}) {
  const [settings, setSettings] = useState<any>(null),
    [models, setModels] = useState<any[]>([]),
    [question, setQuestion] = useState(
      initialLot ? `Investigate root cause candidates for low yield lot ${initialLot}.` : suggestions[0],
    ),
    [mode, setMode] = useState(initialLot || filters.lot ? 'lot' : 'dashboard'),
    [lotNo, setLotNo] = useState(initialLot || filters.lot || ''),
    [source, setSource] = useState(initialSource),
    [targetYield, setTargetYield] = useState(98),
    [useExternalKnowledge, setUseExternalKnowledge] = useState(false),
    [answer, setAnswer] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [message, setMessage] = useState(''),
    [showSettings, setShowSettings] = useState(false);
  async function refresh() {
    try {
      setSettings(await api(admin ? '/ai-assistance/settings' : '/ai-assistance/status'));
      if (admin) setModels(await api('/ai-assistance/models'));
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [admin]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    await act(async () => {
      setAnalyzing(true);
      try {
        const r = await (
          await request('/ai-assistance', {
            method: 'POST',
            body: JSON.stringify({
              question,
              filters,
              consent: true,
              lotNo: mode === 'lot' ? lotNo.trim() : undefined,
              source,
              targetYield,
              useExternalKnowledge,
            }),
            signal: AbortSignal.timeout(240000),
          })
        ).json();
        const completed = { ...r, question: question.trim() };
        setAnswer(completed);
        setHistory((h) => [completed, ...h].slice(0, 5));
      } finally {
        setAnalyzing(false);
      }
    });
  }
  return (
    <div className="ai-workspace">
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="ai-eyebrow">
              <Sparkles size={14} /> YOUR YIELD INVESTIGATION PARTNER
            </span>
            <h2>YMS AI Assistance</h2>
            <p className="muted">Local AI / Manufacturing evidence / {settings?.model || 'Loading model'}</p>
          </div>
        </div>
        <div className="ai-composer">
          <div className="ai-tabs" role="group" aria-label="Analysis scope">
            <button disabled={busy} aria-pressed={mode === 'dashboard'} onClick={() => setMode('dashboard')}>
              Dashboard analysis
            </button>
            <button
              disabled={busy}
              aria-pressed={mode === 'lot'}
              onClick={() => {
                setMode('lot');
                setQuestion(
                  'Investigate root cause candidates for this lot and recommend verification steps.',
                );
              }}
            >
              Lot root cause analysis
            </button>
          </div>
          {mode === 'lot' && (
            <div className="ai-lot-controls">
              <label>
                Lot number
                <input
                  aria-label="AI lot number"
                  placeholder="Exact lot number"
                  value={lotNo}
                  disabled={busy}
                  onChange={(e) => setLotNo(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label>
                Assembly source
                <select
                  aria-label="AI assembly source"
                  value={source}
                  disabled={busy}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="1">Source 1 / ACTL</option>
                  <option value="2">Source 2 / BSM</option>
                </select>
              </label>
              <label>
                Investigation target (%)
                <input
                  aria-label="Lot investigation target"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={targetYield}
                  disabled={busy}
                  onChange={(e) => setTargetYield(Number(e.target.value))}
                />
              </label>
              <p className="muted">
                Uses the full stored lot history regardless of dashboard dates. The target is for this
                investigation; it does not replace the product specification.
              </p>
            </div>
          )}
          <label className="ai-knowledge-toggle">
            <input
              type="checkbox"
              aria-label="Include external assembly knowledge"
              checked={useExternalKnowledge}
              disabled={busy || !settings?.externalKnowledgeEnabled}
              onChange={(e) => setUseExternalKnowledge(e.target.checked)}
            />{' '}
            Include external assembly knowledge (optional)
          </label>
          <p className="muted">
            Retrieves approved public technical references. Lot numbers, questions and manufacturing data stay
            inside YMS.{' '}
            {settings && !settings.externalKnowledgeEnabled
              ? 'External references are disabled by the administrator.'
              : ''}
          </p>
          <div className="ai-filter-tags" aria-label="Current analysis scope">
            {Object.entries(mode === 'lot' ? { lot: lotNo, source } : filters)
              .filter(([k, v]) => v && !['page', 'limit', 'bucket'].includes(k))
              .map(([k, v]) => (
                <span className="badge" key={k}>
                  {k}: {v}
                </span>
              ))}
          </div>
          <p className="muted">
            Explore yield trends, defects, machines and customer comparisons. Investigation candidates are
            hypotheses.
          </p>
          <div className="ai-suggestions">
            {(mode === 'lot'
              ? [
                  'Which operations and defects contribute most to this lot’s losses?',
                  'Review machine and material traceability for this lot.',
                  'Compare this lot with other lots of the same product.',
                ]
              : suggestions
            ).map((q) => (
              <button key={q} disabled={busy} onClick={() => setQuestion(q)}>
                <ArrowUpRight size={14} />
                {q}
              </button>
            ))}
          </div>
          <label className="ai-question-label" htmlFor="ai-question">
            What would you like to investigate?
          </label>
          <textarea
            id="ai-question"
            aria-label="AI Assistance question"
            disabled={busy}
            style={{ width: '100%', minHeight: 100 }}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            disabled={
              busy ||
              !settings?.enabled ||
              question.trim().length < 5 ||
              (mode === 'lot' && !lotNo.trim()) ||
              !Number.isFinite(targetYield) ||
              targetYield < 0 ||
              targetYield > 100
            }
            onClick={() => void analyze()}
          >
            {analyzing ? 'Analyzing manufacturing evidence…' : 'Analyze yield'}
          </Button>
          <p className="muted">
            {mode === 'lot' ? 'Uses the full stored lot history.' : 'Uses the selected dashboard filters.'}{' '}
            Explore the answer as an overview, charts, evidence tables or investigation map.
          </p>
          {settings && !settings.enabled && (
            <p role="status">AI Assistance is disabled. An administrator can enable it in settings.</p>
          )}
          {analyzing && (
            <div className="ai-loading" role="status">
              <span className="ai-pulse" />
              Reviewing warehouse evidence and preparing your analysis. Local models may take a few minutes.
            </div>
          )}
        </div>
      </section>
      {message && (
        <p className="ai-message" role="status">
          {message}
        </p>
      )}
      {history.length > 1 && (
        <div className="ai-history">
          <span className="muted">Recent analyses / this session</span>
          {history.map((h, i) => (
            <button key={i} disabled={busy} aria-pressed={answer === h} onClick={() => setAnswer(h)}>
              {h.question}
            </button>
          ))}
        </div>
      )}
      {answer ? (
        <AssistanceAnswer key={answer.generatedAt} result={answer} />
      ) : (
        !analyzing && (
          <div className="ai-empty">
            <Sparkles size={28} />
            <h3>Turn manufacturing evidence into your next action</h3>
            <p>
              Choose a suggested question or ask your own. Your analysis stays here while you explore its
              charts and tables.
            </p>
          </div>
        )
      )}
      {admin && settings && (
        <Button variant="outline" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          <Settings2 size={16} />
          {showSettings ? 'Hide administrator settings' : 'Administrator settings'}
        </Button>
      )}
      {admin && settings && showSettings && (
        <section className="panel">
          <div className="panel-head">
            <h2>Administrator settings</h2>
            <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
              Refresh installed models
            </Button>
          </div>
          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <label>
              Installed LLM
              <select
                aria-label="Installed LLM"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              >
                {!models.some((m) => m.name === settings.model) && (
                  <option value={settings.model}>{settings.model} (unavailable)</option>
                )}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} / {m.parameters}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />{' '}
              Enable AI Assistance
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="Allow external knowledge"
                checked={settings.externalKnowledgeEnabled}
                onChange={(e) => {
                  setSettings({ ...settings, externalKnowledgeEnabled: e.target.checked });
                  if (!e.target.checked) setUseExternalKnowledge(false);
                }}
              />{' '}
              Allow users to include approved external knowledge
            </label>
            <label>
              System prompt
              <textarea
                aria-label="System prompt"
                style={{ width: '100%', minHeight: 180 }}
                value={settings.systemPrompt}
                onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
              />
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  setSettings(
                    await api(
                      '/ai-assistance/settings',
                      {
                        enabled: settings.enabled,
                        model: settings.model,
                        systemPrompt: settings.systemPrompt,
                        version: settings.version,
                        externalKnowledgeEnabled: settings.externalKnowledgeEnabled,
                      },
                      'PUT',
                    ),
                  );
                  setMessage('AI Assistance settings saved.');
                })
              }
            >
              Save AI settings
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
