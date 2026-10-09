# Verification and release boundaries

Verified on 5 October 2026 using Windows Node.js 24 and Linux Node.js 22 containers.

| Check                            | Result                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL initialization        | Star schema, check constraints, monthly partitions and materialized aggregate created                           |
| Sample warehouse                 | 360 lots, 2,520 process transactions, 300 SPC readings, defect/scrap/downtime records                           |
| TypeScript and production builds | Frontend, API and ETL passed                                                                                    |
| Complete test suite              | 16 passed, 0 failed, including live API and worker integration                                                  |
| Bulk loader                      | Idempotency, incremental corrections and delta preservation verified                                            |
| Data validation                  | Missing/null/blank identifiers, quantities and dates rejected; text whitespace normalized                       |
| Exports                          | CSV escaping/formula neutralization and real Excel/PDF/PowerPoint documents verified                            |
| Lot collaboration                | Comment and attachment persistence, downloads and cleanup verified                                              |
| Scheduled report                 | Worker generated Excel; API downloaded the shared artifact                                                      |
| Authentication safeguards        | Missing bearer denied; Linux production startup refused demo auth                                               |
| Database permissions             | API role could read facts but could not update them; worker role refreshed the aggregate; audit updates revoked |
| Linux images                     | API, frontend and ETL built successfully                                                                        |
| Linux runtime                    | API readiness/summary and frontend HTTP 200 checked                                                             |
| Docker Compose                   | Production configuration validates                                                                              |
| Dependency audit                 | 0 vulnerabilities in the final lockfile                                                                         |
| Browser                          | Responsive dashboard, lot grid/history and custom P-chart calculation checked                                   |

Current preview: `http://127.0.0.1:8088`. API docs: `http://localhost:4000/api/docs`. Preview authentication is explicitly labeled development-only. Mermaid diagram sources are `solution-architecture.mmd` and `database-er.mmd`; source code, SQL scripts and deployment/operations guides are in the repository.

## Required environment acceptance

- Real Oracle connections, source dictionaries, change timestamps, source-account permissions, historical backfill and source/MES reconciliation. Credentials were not supplied; extraction queries remain disabled.
- Microsoft Entra sign-in, real token/role assignments and conditional-access policies. Tenant/app registrations were not supplied.
- Teams and SMTP delivery. No external notifications were sent.
- AI provider connectivity and output qualification. AI is disabled until configured and aggregate disclosure is approved.
- 100M+ realistic records, >1,000 concurrent users and p95 <3s on target hardware, including cold cache and concurrent ETL/refresh. The k6 harness is provided; capacity targets were not measured here.
- Production HA/failover, backup restore, RPO/RTO, malware scanning, retention, detailed data entitlements, TLS and network isolation.
- Manufacturing engineering approval of metric proxies, lot/route semantics, process sequence, control limits, subgroup assumptions and alert thresholds.

Sample-data validation is not production manufacturing qualification. FPY, scrap and COPQ definitions and limits are documented in `data-contracts.md`.

To repeat all tests with PostgreSQL, Redis, API and worker running:

```powershell
$env:RUN_INTEGRATION='true'
$env:RUN_WORKER_INTEGRATION='true'
npm test
```

Overrides pin patched PostCSS, image-size, js-yaml, uuid and deepmerge-ts. Shared dependencies are declared at the workspace root so npm resolves those overrides consistently. Next.js remains on major version 15. Repeat builds, tests and audit when updating the lockfile.

## Local user management verification (2026-10-05)

18 tests passed with integration and worker checks enabled. Verified salted password hashing, unauthorized access, admin login, account creation, Executive denials, existing ETL query editing/version increment, disabling accounts/session revocation, password resets, logout, and rejecting untrusted mutation origins. Frontend/backend/worker typechecks and production builds passed. Local Oracle credentials and source schema qualification remain environment-specific.

## JDBC verification (2026-10-05)

Oracle JDBC Docker build passed. Both ACTL and BSM passed SELECT-from-DUAL connection tests. AEY sample validated five rows after explicit UNASSIGNED machine mapping. Completed historical load imported 330,014 real records and quarantined 871 quantity validation failures, correctly showing partial. Actual source records and demonstration records retain distinct source tags. All 19 tests passed with integration and worker checks enabled; frontend and worker production builds and all typechecks passed. See docs/jdbc.md for source semantics and deployment notes.

## Assembly/process methodology update (2026-10-05)

Source-2 SQL was verified against PROMIS2.BWIP_LOT_PROCESS with exact lot equality and AREA_CODE <> TEST. Metadata verified primary key LOT + OPERATION_SEQ. Three recent ACTL lots returned 89 process records. The SQL test via the ETL queue passed with five sampled rows and no data writes. The historical process import is asynchronous; this note does not certify that the full cohort has finished. More than 1.85 million process records were retained at the latest check, with zero TEST-area leaks. The worker resumed durable cohort checkpoints after a transaction-start timeout and deployment restart.

All 23 unit and local integration tests passed again after the checkpoint resume refinement. The process-storage integration tests passed again after the refinement (raw optional field retention, invalid-quality preservation, idempotent corrections, delta immutability). Typechecks passed for frontend, API and ETL. Frontend production build passed; API and ETL compile successfully. Browser verification confirmed a real lot shows assembly summary plus 22 ordered source-2 process records. Screenshot: lot-history-preview.png. Defect detail ingestion remains unconfigured until its SQL is supplied.

## Automatic AEY follow-up verification (2026-10-05)

All 25 tests passed with PostgreSQL, live API and worker integration enabled. Dependency tests verified parent/source validation, one durable request per parent completion, waiting behind an active child, and exclusion of SQL tests. All workspace typechecks passed. Browser verification confirmed the source-2 process job is enabled, uses full mode, and runs after AEY. Migration 007 is applied. No new live AEY run was launched for this verification; its next completion will exercise the configured live follow-up. The prior historical process import has completed successfully. Defect ingestion still requires its source SQL.

## Lot material verification (2026-10-05)

All 27 tests passed with API, PostgreSQL and worker integration enabled. All workspace typechecks and frontend/API/ETL production builds passed. Oracle source 2 verified PROMIS.BWIP_LOT_MATERIAL returns the expected fields and has primary key LOT + SEQ_NO. Migration 008 applied. Enabled BSM assembly lot materials, full cohort load, after AEY; initial live historical import started. Material integration tests verify correction upserts, delta immutability, null preservation, cohort restrictions and duplicate-key rejection. Historical completion is tracked in ETL Control.

Live material historical import completed successfully: 1,834,934 records, all 330,014 assembly lots checked, no reported errors. Browser verified ADNPTM838.1 displays five ordered material records. Screenshot: lot-material-preview.png. Oracle confirmed primary key LOT + SEQ_NO.

## UTAC theme and favicon (2026-10-06)

Frontend typecheck and production build passed. Official favicon downloaded from https://utacgroup.com/wp-content/uploads/2024/12/favicon.png and served locally as /utac-icon.png (HTTP 200). Theme palette referenced UTAC website stylesheet: indigo #2b296c, purple #4533f4, blue #3858e9. Browser verified top-bar toggle, switching both directions, persisted selection after reload, light grid background, and local icon metadata. Screenshot: utac-theme-preview.png. Preference is browser-local and no manufacturing data changes.

UTAC is now the default theme (2026-10-06). Frontend typecheck/build passed. Verified no saved choice, invalid saved choice and blocked storage use UTAC; explicit saved dark preference stays dark. Server-rendered HTML also defaults to UTAC.

## UTAC text contrast (2026-10-06)

Fixed dark-theme leftovers in links, heatmaps, Copilot replies, footer, placeholders, button hover/disabled states, chart reference labels, tooltip items, and sidebar small text. Verified 13 representative foreground/background pairs exceed 4.5:1: body 13.50, secondary 7.25, heatmap secondary 6.28, links 7.63, blue values on lavender 4.86, success 6.59, warning 4.82, disabled controls 5.28, primary button gradient endpoints 5.61/6.92, sidebar secondary 6.71, chart target 7.04, error 6.58. These checks are not a complete accessibility certification. Browser verified actual rendered link, KPI/footer, button and heatmap colors. Frontend typecheck and build passed.

## Reject source integration (2026-10-06)

Source-2 SQL against PROMIS.BWIP_LOT_REJECT validated five real records without writes; Oracle confirms primary key LOT + OPERATION_CODE + REJECT_CODE. Enabled BSM assembly lot rejects, full assembly-lot cohort source 1, after AEY; historical import queued and remains asynchronous. All 28 unit/live integration tests passed, including quantity corrections, rework and raw external reject retention, missing quantity quality flags, and idempotence. All typechecks and frontend/API production builds passed. Browser verified lot A0TPT0098.1 shows four reject records across operations/areas with external codes; API defect aggregates sum to 10 rejects. Screenshot lot-reject-preview.png. This does not certify completion of the whole backfill; check the ETL execution status and processed/total lots.

Backfill status at final verification: running, 712,551 records processed, 74,000 / 330,014 lots checked, zero failed records. Job ID a3cbd298-c131-4754-9e7c-f5de21e1fbfd. API /api/analytics/defects validated four groups summing to 10 rejects for A0TPT0098.1. Frontend build passed again after updating the source/freshness help text.

## AI Assistance visual response update (2026-10-06)

- API and web production builds and workspace type checks pass.
- Six focused tests pass for structured model response validation, safe fallback, verified warehouse findings and deterministic process/date filter handling.
- Live Ollama gemma3:4b responses were verified in the browser. Overview values and rank findings are calculated from warehouse evidence. Charts show yield and reject contributors; tables show period comparison and contributor rows; the investigation map shows unconfirmed candidates and verification steps.
- Rankings remain bounded to ten rows and trend to ninety buckets. No model output is treated as SQL, HTML or executable diagram code.

## Lot RCA and optional external references (2026-10-06)

- Warehouse and API tests validate exact lot resolution, assembly/source separation, target validation, product/factory cohort comparison, material and reject coverage, and administrator external-knowledge policy.
- Unit checks confirm external retrieval is off by default, sends only fixed public URLs, does not follow redirects, and tolerates failed publishers.
- Live retrieval succeeded for Texas Instruments failure-analysis guidance and Amkor interconnect guidance; the UI identifies sources and retrieval timestamps.
- Browser/Ollama analysis of IS3PT2317.8 showed 91.01% assembly yield, 1,257 assembly rejects, and a 92.8% same-product/factory peer cohort. Counts and yield are warehouse calculations. Candidates are unconfirmed, and reject-detail/process quantities are not added to assembly rejects.
- Existing deployments require database/010_ai_lot_rca.sql. The local migration was applied; Compose initializes it for new databases.
