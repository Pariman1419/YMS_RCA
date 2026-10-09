import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { db } from './analytics';
export function lotFromQuestion(question: string): string | undefined {
  const match = question.match(/\blot(?:\s*(?:number|no\.?))?[\s:#=]+([A-Za-z0-9][A-Za-z0-9._/-]{0,99})/i);
  return match && /\d/.test(match[1]) ? match[1] : undefined;
}
const numeric = (rows: any[]): any[] =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? Number(v) : v,
      ]),
    ),
  );
export async function lotRcaEvidence(lotNo: string, source: string, targetYield: number) {
  const assembly = numeric(
    await db.$queryRaw<any[]>(
      Prisma.sql`SELECT f.lot_no AS "lotNo",f.source,f.transaction_date AS date,f.input_qty::float8 input,f.output_qty::float8 output,f.reject_qty::float8 reject,f.rework_qty::float8 rework,c.customer_name customer,p.product_name product,p.package,p.device,b.bom_name bom,f.factory,f.product_id AS "productId" FROM fact_yield f JOIN dim_customer c USING(customer_id) JOIN dim_product p USING(product_id) JOIN dim_bom b USING(bom_id) WHERE f.lot_no=${lotNo} AND f.source=${source} AND f.source <> 'sample' ORDER BY f.transaction_date DESC,f.yield_id DESC LIMIT 1`,
    ),
  )[0];
  if (!assembly)
    throw new NotFoundException('Lot not found in the selected assembly source. Enter the exact lot number.');
  const [processHistory, processCounts, rejectHistory, defectTotals, materials, materialCounts, peers, sync] =
    await Promise.all([
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT h.operation_sequence::float8 sequence,h.process_code AS "operationCode",p.process_name name,m.machine_name machine,m.machine_model AS "machineModel",h.input_qty::float8 input,h.output_qty::float8 output,h.reject_qty::float8 reject,h.rework_qty::float8 rework,h.yield_percentage::float8 yield,h.quality_status AS "qualityStatus",h.started_at AS "startedAt",h.completed_at AS "completedAt" FROM fact_lot_process h JOIN dim_process p USING(process_id) JOIN dim_machine m USING(machine_id) WHERE h.lot_no=${lotNo} AND h.assembly_source=${source} ORDER BY h.operation_sequence NULLS LAST,h.started_at NULLS LAST,h.source_key LIMIT 120`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT count(*)::int total,count(*) FILTER(WHERE quality_status='valid')::int valid,count(*) FILTER(WHERE quality_status <> 'valid')::int invalid,max(imported_at) AS "lastImportedAt" FROM fact_lot_process WHERE lot_no=${lotNo} AND assembly_source=${source}`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT h.operation_sequence::float8 sequence,h.raw_payload->>'OPERATION_CODE' AS "operationCode",h.raw_payload->>'WIP_OPTN_CODE' operation,h.defect_code code,h.defect_description description,h.qty::float8 qty,h.rework_qty::float8 rework,h.quality_status AS "qualityStatus",m.machine_name machine,h.raw_payload->>'EXT_REJ_CODE' AS "externalCode",h.raw_payload->>'EXT_REJ_DESC' AS "externalDescription" FROM fact_lot_defect h JOIN dim_machine m USING(machine_id) WHERE h.lot_no=${lotNo} AND h.assembly_source=${source} ORDER BY h.qty DESC NULLS LAST,h.operation_sequence LIMIT 100`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT count(*)::int total,count(*) FILTER(WHERE quality_status <> 'valid')::int invalid,sum(qty) FILTER(WHERE quality_status='valid')::float8 qty,sum(rework_qty) FILTER(WHERE quality_status='valid')::float8 rework,max(imported_at) AS "lastImportedAt" FROM fact_lot_defect WHERE lot_no=${lotNo} AND assembly_source=${source}`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT sequence_no::float8 sequence,item_group AS "itemGroup",size_type AS "sizeType",item_no AS "itemNo",item_lot_no AS "itemLotNo" FROM fact_lot_material WHERE lot_no=${lotNo} AND assembly_source=${source} ORDER BY sequence_no,source_key LIMIT 100`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT count(*)::int total,max(imported_at) AS "lastImportedAt" FROM fact_lot_material WHERE lot_no=${lotNo} AND assembly_source=${source}`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT count(*)::int lots,sum(input_qty)::float8 input,sum(output_qty)::float8 output,sum(reject_qty)::float8 reject FROM (SELECT DISTINCT ON(lot_no) lot_no,input_qty,output_qty,reject_qty FROM fact_yield WHERE source=${source} AND product_id=${assembly.productId} AND factory=${assembly.factory} AND lot_no <> ${lotNo} AND transaction_date >= ${new Date(+new Date(assembly.date) - 30 * 86400000)} AND transaction_date <= ${assembly.date} ORDER BY lot_no,transaction_date DESC,yield_id DESC) cohort`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT q.query_name AS job,c.status,c.processed_at AS "processedAt",c.imported_records AS "importedRecords" FROM lot_enrichment_checkpoint c JOIN etl_query_master q USING(query_id) WHERE c.lot_no=${lotNo} AND c.assembly_source=${source} ORDER BY c.processed_at DESC LIMIT 10`,
      ),
    ]);
  // Complete grouped rankings; detailed histories are bounded separately.
  const [processes, machines, defects, operations, sankeyPaths] = await Promise.all([
    db.$queryRaw<any[]>(
      Prisma.sql`SELECT p.process_name name,sum(h.input_qty)::float8 input,sum(h.output_qty)::float8 output,sum(h.reject_qty)::float8 reject,sum(h.rework_qty)::float8 rework,(100.0*sum(h.output_qty)/nullif(sum(h.input_qty),0))::float8 yield FROM fact_lot_process h JOIN dim_process p USING(process_id) WHERE h.lot_no=${lotNo} AND h.assembly_source=${source} AND h.quality_status='valid' GROUP BY p.process_name ORDER BY reject DESC NULLS LAST LIMIT 10`,
    ),
    db.$queryRaw<any[]>(
      Prisma.sql`SELECT m.machine_name name,sum(h.input_qty)::float8 input,sum(h.output_qty)::float8 output,sum(h.reject_qty)::float8 reject,(100.0*sum(h.output_qty)/nullif(sum(h.input_qty),0))::float8 yield FROM fact_lot_process h JOIN dim_machine m USING(machine_id) WHERE h.lot_no=${lotNo} AND h.assembly_source=${source} AND h.quality_status='valid' GROUP BY m.machine_name ORDER BY reject DESC NULLS LAST LIMIT 10`,
    ),
    db.$queryRaw<any[]>(
      Prisma.sql`SELECT defect_code code,defect_description description,sum(qty)::float8 qty FROM fact_lot_defect WHERE lot_no=${lotNo} AND assembly_source=${source} AND quality_status='valid' GROUP BY defect_code,defect_description ORDER BY qty DESC NULLS LAST LIMIT 10`,
    ),
    db.$queryRaw<any[]>(
      Prisma.sql`SELECT coalesce(nullif(raw_payload->>'WIP_OPTN_CODE',''),raw_payload->>'OPERATION_CODE','Unknown operation') name,sum(qty)::float8 qty FROM fact_lot_defect WHERE lot_no=${lotNo} AND assembly_source=${source} AND quality_status='valid' GROUP BY 1 ORDER BY qty DESC NULLS LAST LIMIT 30`,
    ),
    db.$queryRaw<any[]>(
      Prisma.sql`SELECT h.operation_sequence::float8 sequence,coalesce(nullif(h.raw_payload->>'WIP_OPTN_CODE',''),nullif(h.raw_payload->>'OPERATION_CODE',''),'Operation unavailable') operation,m.machine_name machine,m.machine_model AS "machineModel",h.defect_code code,h.defect_description description,sum(h.qty)::float8 qty FROM fact_lot_defect h JOIN dim_machine m USING(machine_id) WHERE h.lot_no=${lotNo} AND h.assembly_source=${source} AND h.quality_status='valid' AND h.qty>0 GROUP BY h.operation_sequence,2,m.machine_name,m.machine_model,h.defect_code,h.defect_description ORDER BY qty DESC,h.operation_sequence NULLS LAST,operation,m.machine_name,h.defect_code,h.defect_description LIMIT 60`,
    ),
  ]);
  const summary = {
    ...assembly,
    lots: 1,
    yield: assembly.input > 0 ? (100 * assembly.output) / assembly.input : null,
    definitions: { yield: 'Latest recorded assembly completion output / input for this lot' },
  };
  const peer = peers[0];
  peer.yield = Number(peer.input) > 0 ? (100 * peer.output) / peer.input : null;
  const lot = {
    lotNo,
    source,
    targetYield,
    belowTarget: summary.yield === null ? null : summary.yield < targetYield,
    assembly: summary,
    peer,
    peerScope:
      'Other lots of the same product and factory in the preceding 30 days, excluding this lot; latest completion per peer lot',
    processHistory,
    rejectHistory,
    materials,
    processCounts: processCounts[0],
    defectTotals: defectTotals[0],
    materialCounts: materialCounts[0],
    sync,
    operations,
    sankeyPaths,
  };
  return {
    filters: { lot: lotNo, source, grain: 'assembly' },
    summary,
    trend: [],
    processes,
    machines,
    defects,
    customers: [],
    previousSummary: peer,
    lot,
    evidenceScope:
      'Exact lot history from PostgreSQL, independent of dashboard date filters. Latest assembly completion; top 10 process/machine/defect rankings and top 30 operation reject groups; up to 120 process records, 100 reject records and 100 material records. Counts and reject totals cover the whole lot. Operation quantities may include repeated measurements or rework and must not be added to assembly rejects as unique unit losses. A material trace by itself does not prove a material cause.',
  };
}
