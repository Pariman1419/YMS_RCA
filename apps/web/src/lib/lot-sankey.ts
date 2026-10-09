export type RejectPath = {
  sequence: number | null;
  operation: string;
  machine: string;
  machineModel?: string | null;
  code: string;
  description: string;
  qty: number;
};
export function buildLotSankey(lotNo: string, paths: RejectPath[]) {
  const nodes: { name: string; kind: string; key: string }[] = [];
  const index = new Map<string, number>();
  const edges = new Map<string, { source: number; target: number; value: number }>();
  const node = (key: string, name: string, kind: string) => {
    if (!index.has(key)) {
      index.set(key, nodes.length);
      nodes.push({ key, name, kind });
    }
    return index.get(key)!;
  };
  const root = node('lot', lotNo, 'lot');
  const records = paths
    .filter((p) => Number.isFinite(Number(p.qty)) && Number(p.qty) > 0)
    .map((p) => {
      const opKey = JSON.stringify([p.sequence, p.operation]);
      const machineKey = JSON.stringify([opKey, p.machine, p.machineModel]);
      const route = [
        root,
        node('op:' + opKey, `${p.sequence ?? '?'} · ${p.operation}`, 'operation'),
        node('machine:' + machineKey, p.machine || 'Machine unavailable', 'machine'),
        node('code:' + JSON.stringify([p.code, p.description]), `${p.code} · ${p.description}`, 'reject'),
      ];
      for (let i = 0; i < route.length - 1; i++) {
        const key = `${route[i]}:${route[i + 1]}`;
        const edge = edges.get(key) || { source: route[i], target: route[i + 1], value: 0 };
        edge.value += Number(p.qty);
        edges.set(key, edge);
      }
      return { ...p, nodeKeys: route.map((i) => nodes[i].key) };
    });
  return {
    nodes,
    links: [...edges.values()],
    records,
    total: records.reduce((s, p) => s + Number(p.qty), 0),
  };
}
