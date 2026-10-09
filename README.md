Local login is enabled by default: **admin / admin**. Use **User management** for accounts and **ETL control** for existing job edits. See [local account setup](docs/local-users.md). Oracle extraction now supports the [JDBC bridge](docs/jdbc.md), enabled in the current workspace.

# NEXUS — Semiconductor Yield Management System

A runnable Next.js 15 / NestJS / PostgreSQL application with a separate Oracle ingestion worker. Dashboard traffic never connects to Oracle. ACTL and BSM are configurable source systems; PostgreSQL is the analytics system of record.

## Local launch

Requires Node.js 22+, Docker Engine and Docker Compose.

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
docker compose -f compose.dev.yaml up -d
npm run db:seed
npm run dev:api
# In another terminal:
npm run dev:web
# In a third terminal:
npm run dev:etl
```

Create `apps/web/.env.local` with `NEXT_PUBLIC_AUTH_MODE=local` and `NEXT_PUBLIC_API_URL=http://localhost:4000/api` for local development. The API reads the root `.env`. Open http://localhost:3000 and http://localhost:4000/api/docs. If port 3000 is occupied, run `npm run dev -w @yms/web -- --port 8088 --hostname 127.0.0.1` and set `WEB_ORIGIN=http://127.0.0.1:8088` in `.env` before restarting the API. The current workspace preview uses port 8088.

The seed creates 360 lots, seven process stages, 2,520 operation records, 300 SPC readings, defects, scrap, equipment downtime events, and a recent Wire Bond yield deterioration. All sample facts carry `source=sample`. Eight example Oracle extraction definitions are initially disabled. Oracle credentials are not needed to explore sample analytics.

## Included features

- Executive KPIs, weighted trends, Pareto and dimension heatmaps; factory/customer/product/package/device/BOM/lot/process/machine/line/shift/date filters.
- Customer → product → package → BOM → lot → process → machine drill-down, paginated virtual lot grid, traceability, comments and attachments.
- Process, equipment and defect analytics; defect Pareto, treemap, bubble, heatmap and trend views; MTBF/MTTR from equipment events.
- Individual SPC observations with configured limits and Western Electric rules; subgroup X-bar/R, P, NP, U and CUSUM calculation API and UI.
- Oracle pools, bounded streaming, timeouts, retrying jobs, incremental/delta/full modes, query configuration, manual/test runs, scheduling, job history and quarantine.
- Local user/password sign-in, administrator user management, seven application roles, protected operations, audit records, and optional Microsoft Entra SSO.
- In-app alerts and banners with configurable rules; Teams/email delivery outbox with retry and deduplication.
- CSV, Excel, PDF and PowerPoint exports; scheduled report generation and downloads.
- Evidence-grounded AI Copilot adapters for Ollama, DeepSeek, Llama 3, Phi-4, Azure OpenAI and OpenAI; explicit aggregate-sharing consent.
- Monthly yield partitions, indexed star schema, PostgreSQL materialized aggregates, Redis cache and BullMQ background jobs.
- Linux Docker deployment, Nginx proxy, health endpoints, OpenAPI UI, unit/integration tests and load-test harness.

## Engineering documentation

- [Architecture and diagrams](docs/architecture.md)
- [Data contracts and semiconductor metric definitions](docs/data-contracts.md)
- [API and role permissions](docs/api.md)
- [Deployment, authentication and source onboarding](docs/deployment.md)
- [Operations, recovery and performance acceptance](docs/operations.md)
- [Verification evidence and rollout boundaries](docs/verification.md)
- [Database schema](database/schema.prisma), [PostgreSQL initialization](database/001_schema.sql), [partitioning and analytics](database/002_analytics.sql), [least-privilege roles](database/003_security.sql), [sample Oracle queries](database/oracle-extraction.sql).

## Validation

```powershell
npm run typecheck
npm test
npm run build
# With seeded PostgreSQL, Redis and the local API running:
$env:RUN_INTEGRATION='true'
npm test
```

Production readiness is an acceptance process, not a claim based on sample data. Live Oracle schemas and credentials, tenant role assignments, target hardware, retention, backups, network isolation, notification endpoints and load qualification must be supplied and validated for the manufacturing environment. The 100M-record / 1,000-user / <3-second targets have a test harness and architecture support; they have not been demonstrated at that scale in this workspace. See `docs/verification.md` for the exact checks completed.

Assembly-lot process enrichment: [methodology, SQL mapping and progress](docs/lot-enrichment.md).
