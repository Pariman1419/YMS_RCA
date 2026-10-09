# API reference and access control

Base path: `/api`. Interactive OpenAPI: `/api/docs`, schema: `/api/docs-json`. Send an **API access token**, not a Microsoft Graph token or ID token, in `Authorization: Bearer <token>`. Tenant, issuer, audience, RS256 signature, expiry, subject and assigned application roles are validated. Production refuses demo authentication.

## Endpoint reference

| Method / path                | Behavior                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------- |
| GET /health/live             | Public liveness probe                                                        |
| GET /health/ready            | Public PostgreSQL + Redis readiness                                          |
| GET /me                      | Signed-in identity and application roles                                     |
| GET /roles                   | Administrator role catalog; local assignments are managed in User management |
| GET /filters                 | Available dimension values                                                   |
| GET /analytics/summary       | Weighted operation KPIs and metric definitions                               |
| GET /analytics/trend         | Date-bucketed weighted trend                                                 |
| GET /analytics/breakdown     | Dimension performance ranked by reject quantity                              |
| GET /analytics/defects       | Defect records aggregated by day/code/process/machine                        |
| GET /analytics/scraps        | Scrap reason Pareto                                                          |
| GET /analytics/equipment     | Machine yield and event-derived reliability                                  |
| GET /lots                    | Paginated assembly summaries with process-history record counts              |
| GET /lots/:lot               | Process, machine, yield, defect, scrap, comment and attachment history       |
| POST /lots/:lot/comments     | Add engineering comment                                                      |
| POST /lots/:lot/attachments  | Multipart file upload, field `file`, 10 MB limit                             |
| GET /attachments/:id         | Authenticated attachment download                                            |
| GET /etl/queries             | Registered extraction configurations                                         |
| POST /etl/queries            | Create SQL extraction definition                                             |
| PUT /etl/queries/:id         | Replace definition and increment version                                     |
| POST /etl/queries/:id/run    | Queue extraction or SQL test (`{"test":true}`)                               |
| GET /etl/jobs                | Most recent 100 ingestion jobs                                               |
| GET /alerts                  | Recent alerts including acknowledgment status                                |
| POST /alerts/:id/acknowledge | Record actor and acknowledge alert                                           |
| GET /alerts/rules            | Alert threshold definitions                                                  |
| PUT /alerts/rules/:id        | Update threshold/enabled status                                              |
| GET /spc                     | Independent measurement streams and rule checks                              |
| POST /spc/calculate          | X-bar/R/P/NP/U/CUSUM calculation                                             |
| GET /reports/export          | Filtered dimension report: csv/xlsx/pdf/pptx                                 |
| GET /reports/schedules       | Schedules and latest five runs                                               |
| POST /reports/schedules      | Create recurring report                                                      |
| GET /reports/runs/:id        | Download generated report                                                    |
| POST /copilot                | Aggregate-grounded AI response, sharing consent required                     |
| GET /audit                   | Recent administrative audit events                                           |

Analytics filters: `from`, `to` (ISO dates, inclusive date-only end), `factory`, `customer`, `product`, `package`, `device`, `bom`, `lot`, `process`, `machine`, `line`, `shift`, `operator`. `bucket`: day/week/month/quarter/year. `dimension`: customer/product/package/device/bom/process/machine/equipmentType/factory/line/shift/operator. Lot drill-down uses `/lots`, not a dimension aggregation. Unknown dimensions are rejected. Lot pagination accepts page >=1 and limit 1–100; default 50. Daily aggregate filtering uses UTC calendar days; intraday precision should use the raw fact endpoint or an added intraday aggregate.

```json
{
  "queryName": "ACTL / Yield history",
  "oracleSource": "1",
  "targetTable": "FACT_YIELD",
  "sqlText": "SELECT TRANSACTION_ID AS SOURCE_KEY, LOT_NO, CUSTOMER, PRODUCT, PROCESS_NAME, MACHINE_ID, INPUT_QTY, OUTPUT_QTY, REJECT_QTY, TRANSACTION_DATE FROM LOT_HISTORY WHERE LAST_UPDATE_DATE >= :LAST_SYNC_TIME AND LAST_UPDATE_DATE < :SYNC_END_TIME",
  "schedule": "15m",
  "enabled": false,
  "loadMode": "incremental"
}
```

```json
{
  "kind": "xbar",
  "samples": [
    { "value": 6.2, "n": 5, "range": 0.2 },
    { "value": 6.3, "n": 5, "range": 0.3 }
  ]
}
```

CUSUM adds `target`, `sigma`, `k` (default 0.5), `h` (default 5). For count charts, sample value is defect/reject count and n is examined units. For X-bar, value is subgroup mean and range is actual subgroup maximum-minus-minimum.

```json
{
  "question": "Why did Wire Bond yield drop this week?",
  "filters": { "process": "Wire Bond", "from": "2026-09-29", "to": "2026-10-05" },
  "consent": true
}
```

Copilot receives current summary/trend/process/machine/defect aggregates plus customer comparison and an equivalent previous interval. The model cannot execute SQL. Disabled provider returns 503; no invented fallback answer is shown.

## RBAC matrix

| Operation                                                   | Allowed roles                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Read analytics, lots, SPC, alerts, reports; export; Copilot | All seven assigned roles                                                          |
| Comments, attachments, SPC calculations                     | Administrator, Yield Engineer, QA Engineer, Production Engineer, Process Engineer |
| Acknowledge alerts                                          | Above engineering roles and Manager                                               |
| View extraction SQL and jobs, run/test stored SQL           | Administrator, Yield Engineer                                                     |
| Create/edit SQL, edit alert thresholds, audit/role catalog  | Administrator                                                                     |
| Create scheduled reports                                    | Administrator, Manager                                                            |

Executive is read-only. Local role assignment is available only to authenticated Administrators through User management. Optional Entra mode uses Entra assignments. Data visibility is currently organization-wide for assigned roles; factory/customer-level entitlements require a manufacturing access model before multi-tenant deployment.

Responses use 400 for invalid inputs, 401 for invalid/missing access tokens, 403 for forbidden role, 404 for missing resources, 409 for unique conflicts and 500 for unexpected service failures. A request ID is returned for tracing. Export and AI operations are audited without storing prompt payloads or source credentials.

Local authentication endpoints and user administration are documented in [local users](local-users.md).

## Assembly and process history

GET /analytics/coverage returns assembly lots, lots with process/defect history, record counts and quality-review counts. Analytics accepts grain=assembly (default) or grain=process. Process/machine breakdowns always use validated process history. GET /lots/:lot accepts source (assembly source, default 1) and processPage; it returns assembly summary, processHistory (100 per page), processTotal, processPage, processLimit and raw source fields. ETL configuration accepts lotScope=assembly_lots, anchorSource and lotBatchSize (1–500). See lot-enrichment.md for the source query contract, mode semantics and execution snapshots.

ETL definitions accept `dependsOnQueryId` (nullable assembly query UUID). An enabled dependent query runs after its parent completes rather than on its own timer. GET /etl/dependencies returns parent/child dispatch and execution status. Job history includes parentJobId for linked runs. The parent must target FACT_YIELD; the child must target FACT_LOT_PROCESS or FACT_LOT_DEFECT and use its parent Oracle source as anchorSource.

Lot material history: GET /api/lots/:lot?source=1&materialPage=1 returns materials (up to 100, ordered by sequence), materialTotal and materialPage. ETL target FACT_LOT_MATERIAL requires assembly_lots scope and :LOT_LIST. Configure source 2, full mode and dependsOnQueryId=AEY query ID to refresh after AEY.

GET /api/lots/:lot defects now include operationSequence, operationCode, processArea, reworkQty, externalRejectCode and externalRejectDescription. GET /api/analytics/defects includes summed reworkQty separately from reject qty. The BSM assembly lot rejects job uses FACT_LOT_DEFECT and dependsOnQueryId for AEY.

### Visual AI analysis response

`POST /ai-assistance` (legacy alias `/copilot`) accepts `{ question, filters, consent: true }`. Authenticated users receive `answer` (plain-text brief), `analysis` (`summary`, `findings`, `hypotheses[{candidate,verification}]`, `actions[{action,owner,priority}]`, `limitations`), `evidence`, `provider`, `model` and `generatedAt`. The evidence contains resolved filters, current and previous aggregate KPIs, up to 90 trend buckets and up to ten rows per ranking. Numerical findings are calculated on the server from warehouse evidence. The browser renders charts, tables and a labeled hypothesis workflow without executing model-generated code. An invalid structured model response retains verified findings and visualizations, with a retry message.

### Lot RCA request options

`POST /ai-assistance` additionally accepts `lotNo` (exact identifier, up to 100 characters), `source` (`1` or `2`, assembly source, default `1`), `targetYield` (0-100, default 98) and `useExternalKnowledge` (default false). An explicit lot filter or a lot identifier mentioned in the question also resolves to exact lot analysis. Unknown lots return 404; invalid targets return 400. Lot mode ignores dashboard date/product filters and uses the source-qualified stored lot. Its `evidence.lot` includes assembly, peer cohort, ordered process details, reject details, materials, whole-lot counts, operation reject rankings and ETL coverage. `evidence.knowledge` includes enabled/status/limitations and retrieved fixed-source references. No caller-supplied URL is fetched.

Administrator AI settings add `externalKnowledgeEnabled`; old update clients that omit the field preserve the current policy. Status responses expose the policy to authenticated users. External retrieval requests are rejected when administrator policy disables it. The per-request checkbox is off by default.
