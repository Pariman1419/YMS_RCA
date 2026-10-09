'use client';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
ModuleRegistry.registerModules([AllCommunityModule]);
const theme = themeQuartz.withParams({
  backgroundColor: 'var(--panel)',
  foregroundColor: 'var(--text)',
  headerBackgroundColor: 'var(--grid-header)',
  headerTextColor: 'var(--muted)',
  borderColor: 'var(--line)',
  rowHoverColor: 'var(--hover)',
  accentColor: 'var(--cyan)',
  fontSize: 12,
});
export default function LotGrid({
  rows,
  onLot,
  target = 98,
}: {
  rows: any[];
  onLot: (lot: string, source?: string) => void;
  target?: number;
}) {
  return (
    <div style={{ height: 410 }}>
      <AgGridReact
        theme={theme}
        rowData={rows}
        defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 110 }}
        columnDefs={[
          {
            field: 'lotNo',
            headerName: 'Lot number',
            cellStyle: { color: 'var(--cyan)', cursor: 'pointer' },
            cellRenderer: (p: any) => (
              <button
                className="link"
                onClick={() => onLot(p.data.lotNo, p.data.assemblySource)}
                aria-label={`Verify yield for lot ${p.value}`}
              >
                {p.value}
              </button>
            ),
          },
          {
            field: 'processRecords',
            headerName: 'Process records',
            valueFormatter: (p) => (p.value ? Number(p.value).toLocaleString() : 'Awaiting import'),
          },
          { field: 'customer' },
          { field: 'product' },
          { field: 'package' },
          { field: 'factory' },
          { field: 'input', valueFormatter: (p) => Number(p.value).toLocaleString() },
          { field: 'output', valueFormatter: (p) => Number(p.value).toLocaleString() },
          { field: 'reject' },
          {
            field: 'yield',
            headerName: 'Yield %',
            valueFormatter: (p) => Number(p.value).toFixed(2) + '%',
            cellStyle: (p) => ({ color: p.value < target ? 'var(--warning)' : 'var(--success)' }),
          },
          {
            headerName: 'Verify',
            minWidth: 140,
            cellRenderer: (p: any) => (
              <button className="link" onClick={() => onLot(p.data.lotNo, p.data.assemblySource)}>
                View lot details →
              </button>
            ),
          },
        ]}
        rowHeight={45}
        headerHeight={40}
      />
    </div>
  );
}
