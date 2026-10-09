# Operations, resilience and performance

## Data reliability

Oracle connections are acquired and released for each job. Query logs store query hash/version, source, bounded window, actor and counts; passwords and returned payloads are excluded. Worker failures are correlated with queue/job identifiers. Runtime error details remain in worker logs; user-facing errors are sanitized. A query's PostgreSQL advisory lock serializes runs across worker replicas, a scheduler lock prevents duplicate dispatch, and a refresh lock serializes materialized-view refreshes.

Loads commit batches before advancing the watermark. Process restarts retry persisted BullMQ jobs; target uniqueness provides idempotency. Invalid source rows create quarantine records and preserve the watermark. Repair the source or extraction mapping, then rerun. Do not advance a partial job's checkpoint manually without documented reconciliation. Readiness requires both PostgreSQL and Redis. Graceful SIGTERM stops scheduling and waits for workers before closing connections.

If the worker exits ungracefully, its last ETL_JOB may remain `running` while BullMQ recovers the stalled job into a new attempt. Reconcile old running log entries by job IDs before claiming them successful. Retry history is attempt-based. Notifications are at-least-once; a channel send followed by a process crash can duplicate a delivery. Fingerprints prevent repeated creation of the same alert event.

## Database maintenance

- Monitor total facts, dimension growth, invalid rows, job duration, checkpoint lag, queue depth, oldest pending deliveries, cache health, PostgreSQL connections and query p95.
- Precreate partitions before they are needed, for example `CALL ensure_yield_partitions('2027-01-01',12)`. Initialization creates 24 months before and after the current month. Default-partition rows that overlap a new partition must be moved before it can attach. Perform that operation using a DBA-reviewed transaction and maintenance plan.
- ANALYZE after major loads, monitor autovacuum/bloat, and inspect `EXPLAIN (ANALYZE, BUFFERS)` on representative filters. Indexes cover event time, factory, process, equipment and lot access paths; dimension selectivity and factory scale determine additional indexes.
- Never use `prisma db push` against this warehouse: custom partitioning, check constraints and materialized views are managed by versioned SQL. Evolve the Prisma schema and SQL migration together, validate on a restored staging database, then apply once through a migration runner. Initialization scripts are not idempotent upgrade migrations.
- Back up PostgreSQL with a production backup tool and WAL/PITR, plus uploads/reports. Define RPO/RTO and prove restore. Keep bootstrap DBA credentials outside service workloads. Redis persists its queue in production; use a private subnet and ACL/TLS when it is not confined to a trusted local Docker network.

## Performance design and qualification

Yield ingestion streams 1,000 source rows at a time and uses bulk dimension insertion and a parameterized set-based PostgreSQL upsert for yield facts. Defect/scrap/SPC loaders currently use per-record transactions; qualify their volume and add equivalent staged bulk merges if needed. Full loads exceeding the one-hour job deadline must be chunked into controlled historical time ranges. Increase concurrency only within Oracle and PostgreSQL connection budgets.

Dashboards query the indexed daily materialized aggregate, with Redis TTL caching (60 seconds) and a generation increment after ETL refresh. Heavy chart and grid code loads on demand. Lots use bounded database pagination and AG Grid row virtualization. The app is horizontally deployable, but Compose provides a single instance of each service.

The daily aggregate retains lot/operator/shift/unit-cost dimensions to support filters; its cardinality can approach the raw fact cardinality. A full concurrent materialized-view refresh scans the source facts. At 100M+ rows, qualify this cost and add incremental aggregate maintenance or coarse aggregate tables for executive queries. Distinct lot counts and route-based final yield remain more expensive than simple sums. The current rollup is functional, not evidence of a sub-three-second guarantee at 100M rows.

Redis serves cache and BullMQ in the supplied topology with `noeviction` to protect jobs; for large production deployments separate cache and queue Redis instances and define cache capacity/TTL policies. Set Prisma connection_limit and pg pool budgets per replica, deploy PgBouncer where appropriate, and benchmark with cache cold and warm. The dedicated advisory-lock client requires session semantics; do not route it through transaction-pooling mode.

Use `tests/load.js` with k6 and a valid Entra API token. It ramps to 1,000 virtual users and requires HTTP p95 <3s and failure rate <1%. Populate at least 100M realistically distributed records in a dedicated qualification environment. Exercise concurrent dashboard dimensions, lot drill-down, source corrections, ETL refresh, SPC and exports—not only the summary endpoint. Measure cold/warm cache, query plans, CPU/memory/IOPS, ingress latency and freshness while ingestion is active. The supplied harness is a baseline, not a completed capacity qualification.

## Scheduled reports and alert rules

Schedules execute on a 30-second worker tick, so dispatch may occur up to a tick late. Reports capture the configured filter dates; they do not automatically reinterpret a fixed date range as rolling. For rolling operational reports, use empty date filters (the analytics service defaults to the previous 30 days). Export reports contain up to 100 dimension contributors, not a dump of all raw facts.

Yield/scrap/machine alerts use the recent warehouse interval; defect spikes compare today's defects with prior seven-day mean. SPC streams are grouped by machine/process/measurement and use the configured baseline limits. The SPC evaluation reads a bounded 10,000-point recent window; high-volume applications should evaluate by stream/checkpoint to avoid truncation. Alert thresholds are persisted in alert_rule and editable by administrators through the API. Initialization script 004_alert_rules.sql creates disabled rules; approve thresholds before enabling them in the administrator Alerts view. The development seed demonstrates starting values, not approved process limits.

## Security and operational acceptance

Before release, verify Entra tenant and role checks with real tokens, revoke test identities, verify source SELECT-only grants and private network isolation, test corrupted source data and checkpoint recovery, validate file scanning, confirm retention/export access, exercise backup restore and delivery failures, and have yield/process engineering sign off metric definitions and control limits. UI consent to AI does not override organizational data-disclosure policy. This release has role-level authorization; factory/customer entitlements and organization tenancy are not implemented.
