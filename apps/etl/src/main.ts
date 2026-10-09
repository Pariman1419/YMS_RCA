import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { scheduleMs, yieldRowSchema } from '../../../packages/core/src';
import '../../../packages/core/src/env';
import { storageDirectory } from '../../../packages/core/src/storage';
import { AnalyticsService } from '../../api/src/analytics';
import { renderReport } from '../../api/src/reporting';
import { deliverAlerts, evaluateAlerts } from './alerts';
import { db, loadRow, loadYieldBatch, validateRecord } from './loader';
import { recordDependentRuns, dispatchDependentRuns } from './dependencies';
import { enrichLots } from './enrichment';
import { syncLotRegistry } from './lot-history';
import { closePools, extract } from './oracle';
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
connection.on('error', (e) => console.error('Redis unavailable', e.message));
const pg = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const queue = new Queue('etl', { connection });
function safeError(error: unknown) {
  let text =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : error instanceof Error
        ? error.message
        : 'Unknown extraction error';
  for (const key of ['SOURCE_DB_1_PASSWORD', 'SOURCE_DB_2_PASSWORD', 'JDBC_BRIDGE_TOKEN']) {
    const secret = process.env[key];
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text.slice(0, 1000);
}
async function run(job: Job) {
  const client = await pg.connect();
  const key = job.data.queryId;
  let locked = false;
  let runId: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) acquired', [key]);
    locked = lock.rows[0].acquired;
    if (!locked) throw new Error('Query already running; retry later');
    // Holding the exclusive source-query lock proves prior running records are abandoned.
    await db.etlJob.updateMany({
      where: { queryId: key, status: 'running' },
      data: {
        status: 'failed',
        phase: 'failed',
        endTime: new Date(),
        errors: [
          {
            message:
              'Previous worker stopped before completion. Committed batches retained; this execution safely replays the source.',
          },
        ],
      },
    });
    const query = job.data.configuration || (await db.etlQuery.findUniqueOrThrow({ where: { id: key } }));
    const end = new Date(Date.now() - 60000);
    const start =
      query.loadMode === 'full'
        ? new Date('1970-01-01')
        : new Date((query.lastSyncTime ? new Date(query.lastSyncTime).getTime() : 0) - 300000);
    const run = await db.etlJob.create({
      data: {
        queryId: key,
        parentJobId: job.data.parentJobId || null,
        jobName: query.queryName,
        status: 'running',
        phase: job.data.test ? 'testing' : 'extracting',
        loadMode: query.loadMode,
        queryVersion: query.version,
        configuration: JSON.parse(JSON.stringify(query)),
        heartbeatAt: new Date(),
      },
    });
    runId = run.id;
    heartbeat = setInterval(() => {
      void db.etlJob.update({ where: { id: run.id }, data: { heartbeatAt: new Date() } }).catch(() => {});
    }, 10000);
    let processed = 0,
      failed = 0,
      duplicates = 0,
      rowsRead = 0,
      batchesProcessed = 0;
    const seen = new Set<string>();
    await db.audit.create({
      data: {
        actor: job.data.actor || 'scheduler',
        action: 'oracle.query.start',
        resource: key,
        details: {
          source: query.oracleSource,
          version: query.version,
          sqlHash: createHash('sha256').update(query.sqlText).digest('hex'),
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
          mode: query.loadMode,
          test: !!job.data.test,
        },
      },
    });
    if (query.lotScope === 'assembly_lots') {
      const result = await enrichLots(query, run.id, start, end, !!job.data.test, job.timestamp);
      processed = result.processed;
      failed = result.failed;
    } else
      for await (const rows of extract(
        query.oracleSource,
        query.sqlText,
        query.loadMode,
        start,
        end,
        job.data.test,
      )) {
        rowsRead += rows.length;
        batchesProcessed++;
        if (job.data.test) {
          rows.forEach((row) => validateRecord(query.targetTable, row));
          processed += rows.length;
          continue;
        }
        const valid: unknown[] = [];
        for (const row of rows) {
          const duplicateKey = `${row.SOURCE_KEY}:${row.TRANSACTION_DATE}`;
          if (seen.has(duplicateKey)) {
            duplicates++;
            continue;
          }
          seen.add(duplicateKey);
          try {
            if (query.targetTable === 'FACT_YIELD') {
              valid.push(yieldRowSchema.parse(row));
            } else {
              await db.$transaction(
                (tx) => loadRow(tx, query.oracleSource, query.targetTable, row, query.loadMode),
                { timeout: 30000 },
              );
              processed++;
            }
          } catch (e) {
            if (!(e instanceof z.ZodError)) throw e;
            failed++;
            await db.quarantine.create({
              data: {
                jobId: run.id,
                sourceKey: row.SOURCE_KEY ? String(row.SOURCE_KEY) : null,
                errors: e.issues.map((x) => ({ path: x.path.join('.'), message: x.message })),
              },
            });
          }
        }
        if (valid.length) {
          await loadYieldBatch(query.oracleSource, valid, query.loadMode);
          processed += valid.length;
        }
        await db.etlJob.update({
          where: { id: run.id },
          data: {
            rowsProcessed: processed,
            failedRecords: failed,
            rowsRead,
            batchesProcessed,
            phase: 'loading',
            heartbeatAt: new Date(),
          },
        });
        await job.updateProgress(processed);
        // Bound duplicate memory; target unique keys guarantee idempotency across batches.
        seen.clear();
      }
    const validationErrors = failed
      ? await db.quarantine.findMany({ where: { jobId: run.id }, select: { errors: true }, take: 100 })
      : [];
    const fields = [
      ...new Set(
        validationErrors.flatMap((item) =>
          (item.errors as { path: string; message: string }[]).map(
            (issue) => issue.path || 'quantity balance',
          ),
        ),
      ),
    ];
    await db.$transaction(async (tx) => {
      await tx.etlJob.update({
        where: { id: run.id },
        data: {
          status: job.data.test ? 'tested' : 'running',
          endTime: job.data.test ? new Date() : null,
          phase: job.data.test ? 'complete' : 'refreshing',
          progressPercent: job.data.test ? 100 : 99,
          heartbeatAt: new Date(),
          rowsProcessed: processed,
          ...(query.lotScope === 'all' ? { rowsRead, batchesProcessed } : {}),
          failedRecords: failed,
          errors: [
            ...(duplicates ? [{ duplicateRecords: duplicates }] : []),
            ...(failed
              ? [
                  {
                    message: `${failed} records ${query.lotScope === 'assembly_lots' ? 'stored with quality flags' : 'quarantined'}. Check ${fields.length ? fields.join(', ') : 'source quantity/date quality'}; accepted records were stored.`,
                  },
                ]
              : []),
          ],
        },
      });
    });
    if (!job.data.test) {
      await db.etlJob.update({ where: { id: run.id }, data: { phase: 'refreshing', progressPercent: 99 } });
      if (query.targetTable === 'FACT_YIELD') await syncLotRegistry(query.oracleSource);
      await refresh();
      await evaluateAlerts();
      await db.$transaction(
        async (tx) => {
          await tx.etlJob.update({
            where: { id: run.id },
            data: {
              status: failed ? 'partial' : 'success',
              endTime: new Date(),
              phase: 'complete',
              progressPercent: 100,
            },
          });
          // Advance the watermark only after aggregates are available.
          if (!failed)
            await tx.etlQuery.updateMany({
              where: { id: key, version: query.version },
              data: {
                lastSyncTime: end,
                nextRunAt: new Date(Date.now() + scheduleMs[query.schedule as keyof typeof scheduleMs]),
              },
            });
          await recordDependentRuns(tx, query, run.id);
        },
        { maxWait: 30000, timeout: 30000 },
      );
    }
    await db.audit.create({
      data: {
        actor: 'etl-worker',
        action: 'oracle.query.complete',
        resource: key,
        details: { processed, failed, duplicates },
      },
    });
  } catch (e) {
    if (runId)
      await db.etlJob.update({
        where: { id: runId },
        data: {
          status: 'failed',
          phase: 'failed',
          endTime: new Date(),
          errors: [{ message: safeError(e) }],
        },
      });
    console.error(JSON.stringify({ event: 'etl.failed', jobId: job.id, queryId: key, error: safeError(e) }));
    throw e;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    client.release();
  }
}
async function refresh() {
  const client = await pg.connect();
  try {
    await client.query('SELECT pg_advisory_lock(8675309)');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_yield_daily');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_process_yield_daily');
    await connection.incr('analytics:generation');
  } finally {
    await client.query('SELECT pg_advisory_unlock(8675309)');
    client.release();
  }
}
const worker = new Worker('etl', run, { connection, concurrency: Number(process.env.ETL_CONCURRENCY) || 2 });
worker.on('error', (e) => console.error('Worker error', e.message));
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pg.connect();
    locked = (await client.query('SELECT pg_try_advisory_lock(121212) acquired')).rows[0].acquired;
    if (!locked) return;
    const queries = await db.etlQuery.findMany({
      where: { enabled: true, dependsOnQueryId: null, nextRunAt: { lte: new Date() } },
    });
    for (const q of queries) {
      await queue.add(
        'run',
        { queryId: q.id, actor: 'scheduler', configuration: q },
        {
          jobId: `${q.id}-${Math.floor(+q.nextRunAt / 60000)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      await db.etlQuery.update({
        where: { id: q.id },
        data: { nextRunAt: new Date(Date.now() + scheduleMs[q.schedule as keyof typeof scheduleMs]) },
      });
    }
    await dispatchDependentRuns(queue);
    await deliverAlerts();
    const schedules = await db.reportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
    });
    const analytics = new AnalyticsService();
    for (const s of schedules) {
      const run = await db.reportRun.create({ data: { scheduleId: s.id, status: 'running' } });
      try {
        const result = await renderReport(
          await analytics.breakdown(s.filters as Record<string, string>),
          s.format,
        );
        await mkdir(storageDirectory('reports'), { recursive: true });
        const storageKey = randomUUID() + '.' + result.extension;
        await writeFile(join(storageDirectory('reports'), storageKey), result.buffer);
        await db.reportRun.update({ where: { id: run.id }, data: { status: 'success', storageKey } });
      } catch {
        await db.reportRun.update({
          where: { id: run.id },
          data: { status: 'failed', error: 'Report generation failed' },
        });
      }
      await db.reportSchedule.update({
        where: { id: s.id },
        data: { nextRunAt: new Date(Date.now() + scheduleMs[s.schedule as keyof typeof scheduleMs]) },
      });
    }
  } catch (e) {
    console.error('Scheduler failure', (e as Error).message);
  } finally {
    if (locked) await client?.query('SELECT pg_advisory_unlock(121212)');
    client?.release();
    ticking = false;
  }
}
const timer = setInterval(() => void tick(), 30000);
void tick();
async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await closePools();
  await db.$disconnect();
  await pg.end();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
