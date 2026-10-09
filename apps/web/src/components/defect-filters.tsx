'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
export default function DefectFilters({
  filters,
  onChange,
  admin,
}: {
  filters: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  admin: boolean;
}) {
  const [options, setOptions] = useState<any>({}),
    [machine, setMachine] = useState(''),
    [model, setModel] = useState(''),
    [message, setMessage] = useState('');
  async function refresh() {
    try {
      setOptions(await api('/analytics/defect-filters'));
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="panel defect-filters" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <h2>Defect filters</h2>
      </div>
      <div className="toolbar" style={{ padding: 20 }}>
        {(['operation', 'machineModel', 'machine'] as const).map((key, i) => (
          <label key={key}>
            {['Operation', 'Machine model', 'Machine number'][i]}
            <select
              aria-label={['Operation', 'Machine model', 'Machine number'][i]}
              value={filters[key] || ''}
              onChange={(e) => onChange({ ...filters, [key]: e.target.value })}
            >
              <option value="">All</option>
              {(options[key] || []).map((v: string) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ))}
        <Button
          variant="outline"
          onClick={() => onChange({ ...filters, operation: '', machineModel: '', machine: '' })}
        >
          Clear defect filters
        </Button>
      </div>
      {admin && (
        <details style={{ padding: '0 20px 20px' }}>
          <summary>Configure machine models</summary>
          <p className="muted">
            Map machine numbers to their confirmed model. Unmapped equipment stays labeled Unmapped.
          </p>
          <div className="toolbar">
            <select
              aria-label="Machine to configure"
              value={machine}
              onChange={(e) => {
                setMachine(e.target.value);
                setModel(
                  options.machines
                    ?.find((m: any) => String(m.id) === e.target.value)
                    ?.model?.replace(/^Unmapped$/, '') || '',
                );
              }}
            >
              <option value="">Select machine</option>
              {options.machines?.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Confirmed machine model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Confirmed model"
              maxLength={100}
            />
            <Button
              disabled={!machine}
              onClick={() =>
                void (async () => {
                  try {
                    await api(`/analytics/machines/${machine}/model`, { model }, 'PUT');
                    await refresh();
                    setMessage('Machine model saved. Analytics refresh within one minute.');
                  } catch (e: any) {
                    setMessage(e.message);
                  }
                })()
              }
            >
              Save model mapping
            </Button>
          </div>
        </details>
      )}
      {message && (
        <p role="status" style={{ padding: 20 }}>
          {message}
        </p>
      )}
    </section>
  );
}
