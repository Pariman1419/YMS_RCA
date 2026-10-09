import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { db } from './loader';

export async function recordDependentRuns(tx: Prisma.TransactionClient, parent: any, parentRunId: string) {
  if (parent.targetTable !== 'FACT_YIELD') return;
  const execution = await tx.etlJob.findUnique({ where: { id: parentRunId }, select: { status: true } });
  if (!execution || !['success', 'partial'].includes(execution.status)) return;
  const children = await tx.etlQuery.findMany({ where: { enabled: true, dependsOnQueryId: parent.id } });
  for (const child of children) {
    const id = `follow-${parentRunId}-${child.id}`;
    await tx.$executeRaw(Prisma.sql`INSERT INTO etl_dependency_dispatch(dispatch_id,parent_job_id,child_query_id,configuration)
   VALUES(${id},${parentRunId},${child.id},${JSON.stringify(child)}::jsonb) ON CONFLICT(parent_job_id,child_query_id) DO NOTHING`);
  }
}

export async function dispatchDependentRuns(queue: Queue, parentRunId?: string) {
  const pending = await db.$queryRaw<
    { dispatch_id: string; parent_job_id: string; child_query_id: string; configuration: any }[]
  >(Prisma.sql`
  SELECT d.dispatch_id,d.parent_job_id,d.child_query_id,d.configuration FROM etl_dependency_dispatch d
  JOIN etl_job p ON p.id=d.parent_job_id
  WHERE d.status='pending' AND p.status IN ('success','partial') ${parentRunId ? Prisma.sql`AND d.parent_job_id=${parentRunId}` : Prisma.empty} ORDER BY d.created_at LIMIT 100`);
  if (!pending.length) return;
  const existing = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'], 0, -1);
  const busy = new Set(existing.map((job) => job.data.queryId));
  const running = await db.etlJob.findMany({ where: { status: 'running' }, select: { queryId: true } });
  for (const job of running) busy.add(job.queryId);
  for (const item of pending) {
    const current = await db.etlQuery.findUnique({ where: { id: item.child_query_id } });
    if (!current?.enabled || current.dependsOnQueryId !== item.configuration.dependsOnQueryId) {
      await db.$executeRaw(
        Prisma.sql`UPDATE etl_dependency_dispatch SET status='cancelled' WHERE dispatch_id=${item.dispatch_id}`,
      );
      continue;
    }
    const started = await db.etlJob.findFirst({
      where: { queryId: item.child_query_id, parentJobId: item.parent_job_id },
      select: { startTime: true },
    });
    if (started) {
      await db.$executeRaw(
        Prisma.sql`UPDATE etl_dependency_dispatch SET status='queued',queued_at=coalesce(queued_at,${started.startTime}) WHERE dispatch_id=${item.dispatch_id}`,
      );
      continue;
    }
    if (busy.has(item.child_query_id)) continue;
    const job = await queue.add(
      'run',
      {
        queryId: item.child_query_id,
        parentJobId: item.parent_job_id,
        actor: 'dependency-scheduler',
        configuration: item.configuration,
      },
      {
        jobId: item.dispatch_id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    // Stable queue ID makes replay safe if the worker stops between enqueue and this update.
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`UPDATE etl_dependency_dispatch SET status='queued',queued_at=now() WHERE dispatch_id=${item.dispatch_id}`,
        );
        await tx.audit.create({
          data: {
            actor: 'dependency-scheduler',
            action: 'etl.dependency.queued',
            resource: item.child_query_id,
            details: { parentJobId: item.parent_job_id, queueJobId: job.id },
          },
        });
      },
      { maxWait: 30000, timeout: 30000 },
    );
    busy.add(item.child_query_id);
  }
}
