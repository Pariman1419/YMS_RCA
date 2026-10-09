import { Prisma } from '@prisma/client';
import { db } from './loader';
import { extract } from './oracle';
import { loadLotHistory, syncLotRegistry } from './lot-history';
export async function enrichLots(
  query: any,
  runId: string,
  start: Date,
  end: Date,
  test: boolean,
  executionStarted?: number,
) {
  await syncLotRegistry(query.anchorSource);
  const cohortTime = new Date();
  const cohort = Prisma.sql`r.assembly_source=${query.anchorSource} AND r.created_at<=${cohortTime}
 ${!test && executionStarted ? Prisma.sql`AND NOT EXISTS(SELECT 1 FROM lot_enrichment_checkpoint cp WHERE cp.query_id=${query.id} AND cp.assembly_source=r.assembly_source AND cp.lot_no=r.lot_no AND cp.query_version=${query.version} AND cp.processed_at>=${new Date(executionStarted)})` : Prisma.empty}
 ${query.loadMode === 'delta' ? Prisma.sql`AND NOT EXISTS(SELECT 1 FROM lot_enrichment_checkpoint cp WHERE cp.query_id=${query.id} AND cp.assembly_source=r.assembly_source AND cp.lot_no=r.lot_no AND cp.query_version=${query.version} AND cp.status='matched')` : Prisma.empty}`;
  const [count] = await db.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT count(*) total FROM lot_registry r WHERE ${cohort}`,
  );
  const total = Number(count.total);
  await db.etlJob.update({
    where: { id: runId },
    data: {
      totalLots: test ? null : total,
      phase: test ? 'testing' : 'extracting',
      progressPercent: total ? 0 : 100,
    },
  });
  let cursor = '',
    processed = 0,
    failed = 0,
    read = 0,
    batches = 0,
    processedLots = 0;
  while (true) {
    const lots = await db.$queryRaw<{ lot_no: string }[]>(
      Prisma.sql`SELECT r.lot_no FROM lot_registry r WHERE ${cohort} AND r.lot_no>${cursor} ORDER BY r.lot_no LIMIT ${query.lotBatchSize}`,
    );
    if (!lots.length) break;
    const names = lots.map((l) => l.lot_no),
      allowed = new Set(names),
      matched = new Map<string, number>(),
      invalidLots = new Set<string>();
    await db.etlJob.update({
      where: { id: runId },
      data: { phase: test ? 'testing' : 'extracting', heartbeatAt: new Date() },
    });
    for await (const rows of extract(
      query.oracleSource,
      query.sqlText,
      query.loadMode,
      start,
      end,
      test,
      names,
    )) {
      read += rows.length;
      const result = await loadLotHistory(
        query.oracleSource,
        query.anchorSource,
        query.targetTable,
        rows,
        query.loadMode,
        allowed,
        test,
      );
      processed += result.stored;
      failed += result.invalid;
      batches++;
      for (const row of rows) {
        const lot = String(row.LOT_NO);
        matched.set(lot, (matched.get(lot) || 0) + 1);
      }
      for (const lot of result.invalidLots) invalidLots.add(lot);
      await db.etlJob.update({
        where: { id: runId },
        data: {
          phase: test ? 'testing' : 'loading',
          rowsRead: read,
          rowsProcessed: processed,
          failedRecords: failed,
          batchesProcessed: batches,
          processedLots,
          heartbeatAt: new Date(),
        },
      });
    }
    if (test) break;
    const checkpoints = names.map((lot_no) => ({
      query_id: query.id,
      assembly_source: query.anchorSource,
      lot_no,
      query_version: query.version,
      imported_records: matched.get(lot_no) || 0,
      status: invalidLots.has(lot_no) ? 'review' : matched.has(lot_no) ? 'matched' : 'unmatched',
    }));
    await db.$executeRaw(Prisma.sql`INSERT INTO lot_enrichment_checkpoint(query_id,assembly_source,lot_no,query_version,imported_records,status)
  SELECT query_id,assembly_source,lot_no,query_version,imported_records,status FROM jsonb_to_recordset(${JSON.stringify(checkpoints)}::jsonb) AS x(query_id text,assembly_source text,lot_no text,query_version int,imported_records int,status text)
  ON CONFLICT(query_id,assembly_source,lot_no) DO UPDATE SET query_version=EXCLUDED.query_version,imported_records=EXCLUDED.imported_records,status=EXCLUDED.status,processed_at=now()`);
    processedLots += names.length;
    cursor = names[names.length - 1];
    await db.etlJob.update({
      where: { id: runId },
      data: {
        processedLots,
        progressPercent: total ? Math.min(99, (100 * processedLots) / total) : 100,
        heartbeatAt: new Date(),
      },
    });
  }
  return { processed, failed };
}
