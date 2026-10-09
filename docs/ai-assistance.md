# YMS AI Assistance and defect filters

Apply database/009_ai_assistance.sql to existing databases. Fresh Docker volumes apply it automatically. API credentials need SELECT/UPDATE on ai_assistance_config and dim_machine (deployment database roles must be updated accordingly).

Open **YMS AI Assistance** as Administrator. Select an installed chat LLM, edit the system prompt and save. Default is the already installed gemma3:4b. Embedding models are excluded. Settings are persisted in PostgreSQL, audited, and protected against concurrent edits. Warehouse evidence remains local to Ollama; no cloud provider is called. The assistant cannot execute SQL or tools. Responses are hypotheses and can be incorrect.

Local API: OLLAMA_BASE_URL=http://127.0.0.1:11434. Docker API: OLLAMA_DOCKER_BASE_URL=http://host.docker.internal:11434 (or an internal Ollama service URL on Linux). Ensure the Ollama service is reachable from the API. No downloads occur when selecting models.

Defect analysis provides Operation (Oracle OPERATION_CODE), Machine number (stored process machine identifier), and Machine model filters. The supplied reject/process SQL does not include a verified machine-model field. Administrators can expand Configure machine models and map confirmed models to machines. Unmapped is explicit; process name is never treated as model. Combined machine identifiers from the source remain combined because the source does not allocate reject quantities per individual machine.

API:

- GET /api/analytics/defect-filters
- GET /api/analytics/defects?operation=D/A-MAP&machine=CANON-02%2FP&machineModel=confirmed-model
- PUT /api/analytics/machines/:id/model {model} (Administrator)
- GET /api/ai-assistance/status (authenticated)
- GET /api/ai-assistance/settings and /models (Administrator)
- PUT /api/ai-assistance/settings {enabled,model,systemPrompt,version} (Administrator)
- POST /api/ai-assistance {question,filters,consent:true}; legacy /copilot alias retained.

Ollama endpoints follow https://docs.ollama.com/api/chat and https://docs.ollama.com/api/tags. AI inference allows 180 seconds; the UI allows 240 seconds including evidence queries. Aggregate evidence is bounded to 10 rows per ranking/trend and explicitly labeled as a sample. Dashboard access continues to use PostgreSQL only.
`Defect evidence` groups by defect code and WIP_OPTN_CODE and displays the latter in its Operation column. The Operation filter continues to match OPERATION_CODE; these are distinct source fields.
Defects by operation chart uses a dedicated full PostgreSQL aggregation by WIP_OPTN_CODE, sorted by total reject quantity descending. It is independent of the 2,000-row defect evidence limit. Top 15, Top 30, and All options show ranked operations with quantities and tooltip contribution percentages.
Lot explorer defect history now includes validated reject/rework summary cards, operation and defect ranking charts, operation filtering, text search and a structured detail table. All views use the same filtered records. WIP_OPTN_CODE is provided as wipOperation by the lot API. Invalid/missing quantities are excluded from chart totals; the existing 1,000-record cap is disclosed when reached.

## Visual analysis briefs

AI Assistance now provides an executive summary, observed findings, suggested actions and evidence limits. Its response includes four views: Overview, Charts, Tables and Investigation map. Charts and numerical tables come directly from the PostgreSQL evidence returned by the API, not model-generated numbers. Rankings show up to ten groups; trend shows the latest ninety buckets. Process rankings describe measured process history, which is distinct from assembly completion yield. Empty scopes display no measurements.

Ollama uses a structured JSON response schema. The server validates the response. Numerical summaries and findings are calculated from warehouse aggregates. If the model returns invalid JSON, the response keeps verified findings and visualizations and explains that the investigation needs a retry. Investigation-map candidates are unconfirmed and paired with verification steps. No model-generated HTML, scripts, SQL or diagram code is executed. Up to five analyses are retained in browser component memory for the current session; administrator model and prompt controls are collapsed by default.

## Lot root cause analysis and optional external knowledge

Choose **Lot root cause analysis**, enter the exact lot number and assembly source, set an investigation target, and ask a question. You can also select **Investigate this lot with AI** from Lot Explorer. The target defaults to 98% for investigation and is not an official product specification.

The analysis uses PostgreSQL only: latest lot assembly completion, validated process and machine rankings, reject codes and WIP_OPTN_CODE operations, material references, data-quality counts and ETL checkpoints. It retrieves history independently of dashboard date filters. The comparison cohort contains other lots of the same product and factory in the preceding thirty days, using each peer's latest completion within that window. Assembly rejects, process rejects and reject-detail totals are separate measures and may overlap. Materials and machine associations are traceability evidence, not proof of cause.

Full aggregate counts are retained. UI details are limited to 120 process records, 100 reject records and 100 materials; the local model receives up to 40 ordered process records, 30 largest reject records and 20 materials, plus aggregate rankings. No validated process or reject history results in an enrichment action instead of invented causes. Candidates stay unconfirmed until engineering verification.

**Include external assembly knowledge** is optional and unchecked by default. Administrators can disable this capability in AI settings. When requested, YMS retrieves up to two fixed public primary-source pages from Texas Instruments and Amkor, selected by assembly topic. It shows publisher links, reference IDs and retrieval timestamps. Content goes to local Ollama as general technical background; no prompts, lot numbers, customers, material IDs or manufacturing quantities are transmitted to the publishers. No search-engine credentials are required. This is retrieval from an approved reference catalog, not unrestricted web search.

Retrieval uses HTTPS, fixed URLs, no redirects, ten-second timeouts, a 1 MB response cap, and a one-hour process cache. Failed sources are reported; local analysis remains usable. Script/style/navigation content is removed, and external text is treated as untrusted reference data rather than instructions. External literature cannot confirm a lot-specific root cause.

For existing deployments, apply `database/010_ai_lot_rca.sql` before restarting the API. New Compose installations include the migration automatically. Administrator settings persist `externalKnowledgeEnabled`; individual requests default `useExternalKnowledge` to false.

Lot RCA inspection semantics: FVI/AOI reject quantities identify detection steps; they cannot establish a thermal process origin. Reliability-test and sampling dispositions must be confirmed before treating recorded removals as defective units. Candidate recommendations that mistake inspection for a thermal operation are replaced with classification and upstream-traceability checks.

If the model returns no supported candidates, the map provides clearly labeled investigation checks derived from the lot's recorded reject codes and process history. These checks prioritize reject-disposition review and upstream traceability; they do not infer a confirmed physical failure. With no validated process/reject records, the map remains empty and requests enrichment instead.
