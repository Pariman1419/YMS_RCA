import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
export const db = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});
redis.on('error', () => {});
const dimensions: Record<string, Prisma.Sql> = {
  customer: Prisma.sql`c.customer_name`,
  product: Prisma.sql`p.product_name`,
  package: Prisma.sql`p.package`,
  device: Prisma.sql`p.device`,
  bom: Prisma.sql`b.bom_name`,
  process: Prisma.sql`pr.process_name`,
  machine: Prisma.sql`m.machine_name`,
  factory: Prisma.sql`f.factory`,
  line: Prisma.sql`m.production_line`,
  shift: Prisma.sql`f.shift`,
  operator: Prisma.sql`f.operator`,
  equipmentType: Prisma.sql`m.machine_type`,
};
export function where(q: Record<string, string>, alias = 'f') {
  const col = (n: string) => Prisma.raw(`${alias}.${n}`);
  const clauses: Prisma.Sql[] = [];
  if (q.includeSample !== 'true') clauses.push(Prisma.sql`${col('source')} <> 'sample'`);
  const end = q.to ? new Date(q.to) : new Date();
  const start = q.from ? new Date(q.from) : new Date(end.getTime() - 30 * 86400000);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end)
    throw new BadRequestException('Invalid date range');
  if (q.to && q.to.length === 10) end.setUTCDate(end.getUTCDate() + 1);
  clauses.push(Prisma.sql`${col('transaction_date')} >= ${start} AND ${col('transaction_date')} < ${end}`);
  for (const [key, value] of Object.entries(q)) {
    if (!value || value === 'all') continue;
    if (
      q.grain !== 'process' &&
      ['process', 'machine', 'line', 'shift', 'operator', 'equipmentType'].includes(key)
    )
      continue;
    if (dimensions[key]) clauses.push(Prisma.sql`${dimensions[key]} = ${value}`);
    else if (key === 'lot') clauses.push(Prisma.sql`${col('lot_no')} = ${value}`);
  }
  return Prisma.join(clauses, ' AND ');
}
const mart = (q: Record<string, string>) =>
  Prisma.raw(q.grain === 'process' ? 'mv_process_yield_daily' : 'mv_yield_daily');
const joins = Prisma.sql`JOIN dim_customer c ON c.customer_id=f.customer_id JOIN dim_product p ON p.product_id=f.product_id JOIN dim_bom b ON b.bom_id=f.bom_id JOIN dim_process pr ON pr.process_id=f.process_id JOIN dim_machine m ON m.machine_id=f.machine_id`;
const numberize = (rows: any[]): any[] =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? Number(v) : v,
      ]),
    ),
  );
@Injectable()
export class AnalyticsService {
  async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let generation = '0';
    try {
      generation = (await redis.get('analytics:generation')) || '0';
    } catch {}
    const hash = 'yms:' + generation + ':' + createHash('sha256').update(key).digest('hex');
    try {
      const old = await redis.get(hash);
      if (old) return JSON.parse(old);
    } catch {}
    const result = await fn();
    try {
      await redis.set(hash, JSON.stringify(result), 'EX', 60);
    } catch {}
    return result;
  }
  async summary(q: Record<string, string>) {
    return this.cached('summary' + JSON.stringify(q), async () => {
      const rows = numberize(
        await db.$queryRaw<any[]>(
          Prisma.sql`SELECT sum(f.input_qty) input, sum(f.output_qty) output, sum(f.reject_qty) reject, sum(f.rework_qty) rework, sum(f.reject_qty*f.unit_cost) copq, count(distinct f.lot_no) lots, count(distinct f.product_id) products, count(distinct f.customer_id) customers FROM ${mart(q)} f ${joins} WHERE ${where(q)}`,
        ),
      );
      const v = rows[0];
      const input = Number(v.input) || 0,
        output = Number(v.output) || 0,
        rework = Number(v.rework) || 0;
      const first = input,
        last = output;
      return {
        ...v,
        yield: input ? (output / input) * 100 : 0,
        firstPassYield: input ? (Math.max(0, output - rework) / input) * 100 : 0,
        finalYield: first ? (last / first) * 100 : 0,
        scrapRate: input ? (Number(v.reject) / input) * 100 : 0,
        reworkRate: input ? (rework / input) * 100 : 0,
        definitions: {
          yield:
            q.grain === 'process' ? 'Weighted measured process yield' : 'Assembly completion output / input',
          firstPassYield: 'Proxy: (output − rework) / input; requires first-pass flags for exact FPY',
          finalYield:
            q.grain === 'process'
              ? 'Operation throughput ratio; assembly final yield is shown separately'
              : 'Assembly completion output / input',
          copq: 'Reject quantity × unit cost; excludes labor, rework and warranty cost',
        },
      };
    });
  }
  async trend(q: Record<string, string>) {
    const bucket = ['day', 'week', 'month', 'quarter', 'year'].includes(q.bucket) ? q.bucket : 'day';
    return this.cached('trend' + JSON.stringify(q), async () =>
      numberize(
        await db.$queryRaw<any[]>(
          Prisma.sql`SELECT date_trunc(${bucket},f.transaction_date) date, round(100.0*sum(f.output_qty)/nullif(sum(f.input_qty),0),2) yield, sum(f.input_qty) input, sum(f.reject_qty) reject FROM ${mart(q)} f ${joins} WHERE ${where(q)} GROUP BY 1 ORDER BY 1`,
        ),
      ),
    );
  }
  async breakdown(q: Record<string, string>) {
    if (
      ['process', 'machine', 'line', 'shift', 'operator', 'equipmentType'].includes(q.dimension || 'process')
    )
      q = { ...q, grain: 'process' };
    const dim = dimensions[q.dimension || 'process'];
    if (!dim) throw new BadRequestException('Unsupported dimension');
    return this.cached('breakdown' + JSON.stringify(q), async () =>
      numberize(
        await db.$queryRaw<any[]>(
          Prisma.sql`SELECT ${dim} name,sum(f.input_qty) input,sum(f.output_qty) output,sum(f.reject_qty) reject,sum(f.rework_qty) rework, round(100.0*sum(f.output_qty)/nullif(sum(f.input_qty),0),2) yield FROM ${mart(q)} f ${joins} WHERE ${where(q)} GROUP BY 1 ORDER BY reject DESC LIMIT 100`,
        ),
      ),
    );
  }
  async lots(q: Record<string, string>) {
    q = { ...q, grain: 'assembly' };
    const target = Number(q.targetYield ?? 98);
    if (!Number.isFinite(target) || target < 0 || target > 100)
      throw new BadRequestException('Yield target must be between 0 and 100');
    const selected = Prisma.sql`SELECT DISTINCT ON(f.source,f.lot_no) f.source AS "assemblySource",f.lot_no AS "lotNo",c.customer_name customer,p.product_name product,p.package,b.bom_name bom,f.factory,f.transaction_date date,f.input_qty input,f.output_qty output,f.reject_qty reject,f.yield_percentage yield
      FROM fact_yield f ${joins} WHERE ${where(q)} ORDER BY f.source,f.lot_no,f.transaction_date DESC,f.yield_id DESC`;
    const selection = q.lowYieldOnly === 'true' ? Prisma.sql`yield < ${target}` : Prisma.sql`TRUE`;
    const order =
      q.lotSort === 'yield'
        ? Prisma.sql`yield ASC NULLS LAST,date DESC,"lotNo","assemblySource"`
        : Prisma.sql`date DESC,"lotNo","assemblySource"`;
    const page = Math.max(1, Math.min(10000, Number(q.page) || 1)),
      limit = Math.max(1, Math.min(100, Number(q.limit) || 50));
    const [count] = await db.$queryRaw<any[]>(
      Prisma.sql`WITH selected AS (${selected}) SELECT count(*)::int total FROM selected WHERE ${selection}`,
    );
    const rows = numberize(
      await db.$queryRaw<
        any[]
      >(Prisma.sql`WITH selected AS (${selected}),page AS (SELECT * FROM selected WHERE ${selection} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit})
    SELECT page.*,(SELECT count(*)::int FROM fact_lot_process h WHERE h.assembly_source=page."assemblySource" AND h.lot_no=page."lotNo") "processRecords" FROM page ORDER BY ${order}`),
    );
    return { rows, total: count.total, page, limit };
  }
  async filters() {
    return this.cached('filters', async () => {
      const [customers, products, boms, processes, machines, factories, shifts] = await Promise.all([
        db.$queryRaw<
          any[]
        >`SELECT DISTINCT c.customer_name name FROM dim_customer c JOIN lot_registry r USING(customer_id) ORDER BY 1`,
        db.$queryRaw<
          any[]
        >`SELECT DISTINCT p.product_name name,p.package,p.device FROM dim_product p JOIN lot_registry r USING(product_id) ORDER BY 1`,
        db.$queryRaw<
          any[]
        >`SELECT DISTINCT b.bom_name name FROM dim_bom b JOIN lot_registry r USING(bom_id) ORDER BY 1`,
        db.$queryRaw<
          any[]
        >`SELECT p.process_name name FROM dim_process p WHERE EXISTS(SELECT 1 FROM fact_lot_process h WHERE h.process_id=p.process_id) ORDER BY 1`,
        db.$queryRaw<
          any[]
        >`SELECT m.machine_name name,m.production_line line FROM dim_machine m WHERE EXISTS(SELECT 1 FROM fact_lot_process h WHERE h.machine_id=m.machine_id) ORDER BY 1`,
        db.$queryRaw<any[]>`SELECT DISTINCT factory FROM lot_registry LIMIT 100`,
        db.$queryRaw<any[]>`SELECT DISTINCT shift FROM mv_process_yield_daily LIMIT 100`,
      ]);
      return {
        customer: customers.map((c) => c.name),
        product: products.map((p) => p.name),
        package: [...new Set(products.map((p) => p.package))],
        device: [...new Set(products.map((p) => p.device))],
        bom: boms.map((b) => b.name),
        process: processes.map((p) => p.name),
        machine: machines.map((m) => m.name),
        line: [...new Set(machines.map((m) => m.line))],
        factory: factories.map((f) => f.factory),
        shift: shifts.map((s) => s.shift),
      };
    });
  }
  async defectFilters() {
    const [operations, machines] = await Promise.all([
      db.$queryRaw<
        any[]
      >`SELECT DISTINCT raw_payload->>'OPERATION_CODE' name FROM fact_lot_defect WHERE raw_payload->>'OPERATION_CODE' IS NOT NULL ORDER BY 1`,
      db.$queryRaw<
        any[]
      >`SELECT machine_id id,machine_name name,coalesce(machine_model,'Unmapped') model FROM dim_machine ORDER BY machine_name`,
    ]);
    return {
      operation: operations.map((x) => x.name),
      machine: machines.map((x) => x.name),
      machineModel: [...new Set(machines.map((x) => x.model))],
      machines,
    };
  }
  async defects(q: Record<string, string>) {
    return this.cached('lot-defects' + JSON.stringify(q), async () =>
      numberize(
        await db.$queryRaw<any[]>(Prisma.sql`
      SELECT d.defect_code code,d.defect_description name,sum(d.qty) qty,sum(d.rework_qty) "reworkQty",pr.process_name process,m.machine_name machine,m.machine_model "machineModel",d.raw_payload->>'OPERATION_CODE' operation,d.raw_payload->>'WIP_OPTN_CODE' "wipOperation",date_trunc('day',d.occurred_at) date
      FROM fact_lot_defect d JOIN dim_process pr ON pr.process_id=d.process_id JOIN dim_machine m ON m.machine_id=d.machine_id
      WHERE d.quality_status='valid' AND EXISTS(SELECT 1 FROM fact_yield f ${joins} WHERE f.lot_no=d.lot_no AND f.source=d.assembly_source AND ${where({ ...q, grain: 'assembly' })})
      ${q.process ? Prisma.sql`AND pr.process_name=${q.process}` : Prisma.empty} ${q.machine ? Prisma.sql`AND m.machine_name=${q.machine}` : Prisma.empty}
      ${q.operation ? Prisma.sql`AND d.raw_payload->>'OPERATION_CODE'=${q.operation}` : Prisma.empty}
      ${q.machineModel ? Prisma.sql`AND coalesce(m.machine_model,'Unmapped')=${q.machineModel}` : Prisma.empty}
      GROUP BY 1,2,5,6,7,8,9,10 ORDER BY qty DESC LIMIT 2000`),
      ),
    );
  }
  async defectsByOperation(q: Record<string, string>) {
    return this.cached('defects-by-operation' + JSON.stringify(q), async () =>
      numberize(
        await db.$queryRaw<any[]>(Prisma.sql`
      SELECT coalesce(nullif(trim(d.raw_payload->>'WIP_OPTN_CODE'),''),'Unknown operation') name,sum(d.qty) qty
      FROM fact_lot_defect d JOIN dim_process pr ON pr.process_id=d.process_id JOIN dim_machine m ON m.machine_id=d.machine_id
      WHERE d.quality_status='valid' AND EXISTS(SELECT 1 FROM fact_yield f ${joins} WHERE f.lot_no=d.lot_no AND f.source=d.assembly_source AND ${where({ ...q, grain: 'assembly' })})
      ${q.process ? Prisma.sql`AND pr.process_name=${q.process}` : Prisma.empty} ${q.machine ? Prisma.sql`AND m.machine_name=${q.machine}` : Prisma.empty}
      ${q.operation ? Prisma.sql`AND d.raw_payload->>'OPERATION_CODE'=${q.operation}` : Prisma.empty}
      ${q.machineModel ? Prisma.sql`AND coalesce(m.machine_model,'Unmapped')=${q.machineModel}` : Prisma.empty}
      GROUP BY 1 ORDER BY qty DESC,name ASC`),
      ),
    );
  }
  async coverage(q: Record<string, string>) {
    return this.cached('coverage' + JSON.stringify(q), async () => {
      const [result] = numberize(
        await db.$queryRaw<
          any[]
        >(Prisma.sql`WITH selected AS (SELECT DISTINCT f.source,f.lot_no FROM fact_yield f ${joins} WHERE ${where({ ...q, grain: 'assembly' })}),
      process_lots AS (SELECT DISTINCT h.assembly_source source,h.lot_no FROM fact_lot_process h JOIN selected s ON s.source=h.assembly_source AND s.lot_no=h.lot_no),
      defect_lots AS (SELECT DISTINCT h.assembly_source source,h.lot_no FROM fact_lot_defect h JOIN selected s ON s.source=h.assembly_source AND s.lot_no=h.lot_no)
      SELECT (SELECT count(*) FROM selected) "assemblyLots",(SELECT count(*) FROM process_lots) "processLots",(SELECT count(*) FROM defect_lots) "defectLots",
      (SELECT count(*) FROM fact_lot_process h JOIN selected s ON s.source=h.assembly_source AND s.lot_no=h.lot_no) "processRecords",
      (SELECT count(*) FROM fact_lot_defect h JOIN selected s ON s.source=h.assembly_source AND s.lot_no=h.lot_no) "defectRecords",
      (SELECT count(*) FROM fact_lot_process h JOIN selected s ON s.source=h.assembly_source AND s.lot_no=h.lot_no WHERE h.quality_status='invalid') "reviewRecords"`),
      );
      return {
        ...result,
        coveragePercentage: result.assemblyLots ? (100 * result.processLots) / result.assemblyLots : 0,
      };
    });
  }
  async scraps(q: Record<string, string>) {
    return numberize(
      await db.$queryRaw<any[]>(
        Prisma.sql`SELECT s.scrap_reason name,sum(s.scrap_qty) qty FROM fact_scrap s WHERE EXISTS(SELECT 1 FROM fact_yield f ${joins} WHERE f.lot_no=s.lot_no AND f.source=s.source AND ${where(q)}) AND s.occurred_at >= ${q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400000)} AND s.occurred_at < ${q.to ? new Date(new Date(q.to).getTime() + 86400000) : new Date()} GROUP BY 1 ORDER BY qty DESC LIMIT 100`,
      ),
    );
  }
  async equipment(q: Record<string, string>) {
    const values = await this.breakdown({ ...q, dimension: 'machine' });
    const events = await db.equipmentEvent.findMany({
      where: {
        startedAt: {
          gte: q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400000),
          lte: q.to ? new Date(new Date(q.to).getTime() + 86400000) : new Date(),
        },
      },
      include: { machine: true },
    });
    return values.map((v) => {
      const e = events.filter((x) => x.machine.name === v.name);
      return {
        ...v,
        mtbf: e.length ? e.reduce((s, x) => s + x.operatingMinutes, 0) / e.length : null,
        mttr: e.length ? e.reduce((s, x) => s + (+x.endedAt - +x.startedAt) / 60000, 0) / e.length : null,
      };
    });
  }
}
