# Solution architecture

```mermaid
flowchart LR
 ACTL[(Oracle ACTL\nACTL_BASE:1521/ACTL)] --> POOLS
 BSM[(Oracle BSM\nBSM_BASE:1521/BSM)] --> POOLS
 subgraph Ingestion boundary
  POOLS[Read-only connection pools] --> ETL[ETL worker\nBounded extraction / validation / bulk load]
  SCHED[Scheduler / query master] --> QUEUE[BullMQ / Redis]
  QUEUE --> ETL
 end
 ETL --> PG[(PostgreSQL YMS_DATABASE\nPartitioned facts / conformed dimensions)]
 ETL --> LOG[Audit / job logs / quarantine]
 PG --> MV[Materialized daily yield aggregates]
 MV --> API[NestJS feature modules]
 PG --> API
 CACHE[Redis TTL cache] <--> API
 ENTRA[Microsoft Entra ID] --> API
 API --> WEB[Next.js 15 / React\nAG Grid / Recharts / Tailwind / Shadcn]
 WEB --> NGINX[Nginx / TLS edge]
 API --> JOBS[Report jobs / alert outbox]
 JOBS --> CHANNELS[In-app / Teams / Email]
 API --> AI[Configured AI provider\nAggregate evidence only]
```

The API has no Oracle import and its production container receives no Oracle credentials. SQL tests and manual runs enqueue work; the isolated worker performs Oracle access. Use network ACLs to prevent API/frontend hosts reaching Oracle listeners, in addition to the code boundary. All dashboard endpoints operate on PostgreSQL facts, dimensions or materialized aggregates.

The API is organized into platform, analytics, lots, ETL administration, alerts, SPC, reporting and Copilot modules. Analytics, authentication, report generation and AI transport are services; core validation and SPC functions have no infrastructure dependencies. The ETL separates extraction, loading, alert evaluation and orchestration. Shared data contracts validate externally supplied inputs.

## Star schema ER diagram

```mermaid
erDiagram
 DIM_CUSTOMER ||--o{ FACT_YIELD : customer_id
 DIM_PRODUCT ||--o{ FACT_YIELD : product_id
 DIM_BOM ||--o{ FACT_YIELD : bom_id
 DIM_PROCESS ||--o{ FACT_YIELD : process_id
 DIM_MACHINE ||--o{ FACT_YIELD : machine_id
 DIM_DATE ||--o{ FACT_YIELD : date_id
 DIM_PROCESS ||--o{ FACT_DEFECT : process_id
 DIM_MACHINE ||--o{ FACT_DEFECT : machine_id
 DIM_PROCESS ||--o{ FACT_SCRAP : process_id
 DIM_PROCESS ||--o{ FACT_SPC : process_id
 DIM_MACHINE ||--o{ FACT_SPC : machine_id
 DIM_MACHINE ||--o{ EQUIPMENT_EVENT : machine_id
 ETL_QUERY_MASTER ||--o{ ETL_JOB : query_id
 ALERT ||--o{ ALERT_DELIVERY : alert_id
 REPORT_SCHEDULE ||--o{ REPORT_RUN : schedule_id
 DIM_CUSTOMER { int customer_id PK string customer_code UK string customer_name string region }
 DIM_PRODUCT { int product_id PK string product_name string package string device string technology }
 DIM_BOM { int bom_id PK string bom_name string revision }
 DIM_MACHINE { int machine_id PK string machine_name UK string machine_type string production_line }
 DIM_PROCESS { int process_id PK string process_name UK string operation_name int sequence }
 DIM_DATE { int date_id PK date date UK int year int quarter int month int week int day }
 FACT_YIELD { string yield_id PK datetime transaction_date PK string source string source_key string lot_no int customer_id FK int product_id FK int bom_id FK int process_id FK int machine_id FK int date_id FK int input_qty int output_qty int reject_qty int rework_qty decimal yield_percentage }
 FACT_DEFECT { string defect_id PK string lot_no int process_id FK int machine_id FK string defect_code string defect_description int qty }
 FACT_SCRAP { string scrap_id PK string lot_no int process_id FK int scrap_qty string scrap_reason }
 FACT_SPC { string spc_id PK int process_id FK int machine_id FK string measurement_name float measurement_value float ucl float lcl float target }
 ETL_QUERY_MASTER { string query_id PK string query_name string oracle_source string target_table string sql_text string schedule boolean enabled datetime last_sync_time }
 ETL_JOB { string id PK string query_id FK string job_name datetime start_time datetime end_time string status int rows_processed int failed_records json errors }
 ALERT { string id PK string fingerprint UK string type string severity string status }
 ALERT_DELIVERY { string id PK string alert_id FK string channel string status int attempts }
 EQUIPMENT_EVENT { string id PK int machine_id FK datetime started_at datetime ended_at float operating_minutes }
 REPORT_SCHEDULE { string id PK string format string schedule json filters }
 REPORT_RUN { string id PK string schedule_id FK string status string storage_key }
```

Fact grain: one immutable source operation transaction, with stable source key and event timestamp. Dimensions are conformed across ACTL/BSM. Cross-source identifiers must be normalized in extraction SQL or a controlled mapping before ingestion. Factory, shift and operator are degenerate dimensions in this release. Manufacturing engineering owns process sequence, definition of rework, control limits and source cost currency.

## Production folder structure

```text
apps/
  web/src/app/             Responsive application shell and views
  web/src/components/     Lazy chart/grid components and Shadcn button
  web/src/lib/            Entra/MSAL and authenticated API transport
  api/src/modules/        Feature controllers and NestJS modules
  api/src/analytics.ts    Parameterized PostgreSQL analytics / caching
  api/src/auth.ts         Entra verification / RBAC
  api/src/reporting.ts    Reusable document exporters
  api/src/copilot.ts      Provider adapters / grounded prompt
  etl/src/oracle.ts       Oracle source pools / bounded extraction
  etl/src/loader.ts       Validation / conformed dimensions / bulk upsert
  etl/src/alerts.ts       Rule evaluation / delivery outbox
  etl/src/main.ts         Worker / scheduler / checkpoints / locks
packages/core/src/        Shared schemas and statistical calculations
database/                Prisma schema / PostgreSQL / Oracle examples / seed
docker/                  Linux images / Nginx
tests/                   Domain, auth, exports, integration and load harness
docs/                    Architecture / contracts / API / deployment / operations
```
