# Data contracts and metric definitions

## Oracle source onboarding

Register sources via `SOURCE_DB_1_*` and `SOURCE_DB_2_*` variables. Defaults identify ACTL_BASE:1521/ACTL and BSM_BASE:1521/BSM; credentials are intentionally empty. Use SELECT-only Oracle accounts with access only to approved extraction views. A read-only transaction and SQL screening are defense in depth; arbitrary user-authored SQL is **not** made safe by a regular expression. Restrict execute privileges on side-effecting functions and access to database links through the Oracle account. Only administrators author source SQL.

Example object names are contracts, not discovered source schemas. A source DBA must verify actual tables, columns, timestamp semantics and indexes before enabling a query. `database/oracle-extraction.sql` supplies four extraction templates.

| Target      | Required Oracle result aliases                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| FACT_YIELD  | SOURCE_KEY, LOT_NO, CUSTOMER, PRODUCT, PROCESS_NAME, MACHINE_ID, INPUT_QTY, OUTPUT_QTY, REJECT_QTY, TRANSACTION_DATE |
| FACT_DEFECT | SOURCE_KEY, LOT_NO, PROCESS_NAME, MACHINE_ID, DEFECT_CODE, DEFECT_DESCRIPTION, QTY, TRANSACTION_DATE                 |
| FACT_SCRAP  | SOURCE_KEY, LOT_NO, PROCESS_NAME, SCRAP_QTY, SCRAP_REASON, TRANSACTION_DATE                                          |
| FACT_SPC    | SOURCE_KEY, PROCESS_NAME, MACHINE_ID, MEASUREMENT_NAME, MEASUREMENT_VALUE, UCL, LCL, TARGET, TRANSACTION_DATE        |

Optional yield fields: REWORK_QTY (0), PACKAGE, DEVICE, TECHNOLOGY, BOM (Unknown), BOM_REVISION (A), FACTORY, LINE, SHIFT, OPERATOR (Unknown), UNIT_COST (0). Optional SPC fields: SAMPLE_SIZE (5), SUBGROUP (individual). Populate real values to enable meaningful cost, grouping and subgroup calculations.

`SOURCE_KEY` must identify a transaction or operation record. For yield, uniqueness is `(source, source_key, transaction_date)` to support partitioned uniqueness. Event timestamp must remain immutable across corrections. Other facts use `(source, source_key)`. A mutable timestamp with the same key creates a second yield record; use a stable source event timestamp and a separate update timestamp in the WHERE clause.

## Load modes and checkpoints

- Full: scan the configured SELECT; upsert historical records, never truncate the warehouse. For very large initial loads, create bounded date-range query definitions rather than one unbounded billion-row scan.
- Incremental: filter on source **last modification time**, with `:LAST_SYNC_TIME` and `:SYNC_END_TIME`. Window end is the worker's current time minus one minute. Start overlaps the committed watermark by five minutes. New records and corrections are upserted.
- Delta: the same bounded extraction, inserting new target keys and preserving existing facts. Use it only for append-only streams.
- Successful loads advance the checkpoint only if query version is unchanged. Partial loads quarantine invalid rows and preserve the checkpoint so corrected source rows can be re-read. Committed batches remain durable and retries are idempotent.
- Default schedules are 15m, 30m, hourly, daily. Schedule changes do not alter application code.

Source clocks must be synchronized. Five-minute lookback does not capture arbitrarily backdated updates or missed deletes. For strict change capture, provide CDC/change-log extraction with stable change sequence and soft-delete mapping. This implementation does not delete source-missing facts or implement log-based Oracle CDC. Query version changes retain the old watermark; when changing grain or source mapping, create a new query for a controlled full backfill.

## Validation

Schema checks reject missing identifiers, invalid dates, negative/fractional quantities, zero input and output+reject greater than input. Rework cannot exceed input. SPC values must be finite and limits must surround target. Invalid rows are quarantined with field-level errors and source key; raw manufacturing payloads and credentials are not stored in quarantine. Duplicate keys within a batch are counted; unique target keys prevent duplicates across batches/retries. Operational `rows_processed` counts accepted upserts, including records replayed by overlap, and is not a count of newly inserted records.

## Yield metrics

| Metric                  | Implementation / caveat                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall yield           | SUM(output_qty) / SUM(input_qty), weighted across operation transactions                                                                                                      |
| First pass yield        | Proxy: (SUM(output_qty) − SUM(rework_qty)) / SUM(input_qty). Exact FPY needs unit/lot first-pass disposition flags.                                                           |
| Final yield             | Per lot, last observed process output divided by first observed process input, aggregated over lots in selection. Partial route selections are not completed-lot final yield. |
| Scrap rate              | Reject/input proxy; confirm all rejects are scrapped before interpreting this as physical scrap rate. Scrap facts report actual discarded quantity separately.                |
| Rework rate             | Rework/input; not a measure of the number of repeat passes unless source semantics support it.                                                                                |
| COPQ                    | Reject quantity × source unit cost; excludes rework labor, downtime, warranty and other costs. No cross-currency conversion.                                                  |
| Lots/products/customers | Distinct identifiers within the selected interval; running means observed, not real-time WIP state.                                                                           |
| MTBF                    | Sum recorded operating minutes / recorded failure event count in the selected interval.                                                                                       |
| MTTR                    | Average elapsed downtime from recorded failure start/end, in minutes.                                                                                                         |

SUM(input) across multiple process stages counts operation throughput, not unique finished units. Do not average percentages across lots. Validate quantity balancing, lot splits/merges, route re-entry, scrap dispositions and recipe revisions against MES before operational sign-off. Current lot identity assumes globally unique lot numbers across the two factories. If source lot numbers overlap, normalize them with a source/factory prefix during extraction.

## SPC

Western Electric: one point beyond 3 sigma; two of three beyond 2 sigma on one side; four of five beyond 1 sigma on one side; eight consecutive on one side. Six monotonic observations trigger a separate trend rule. Individual charts use configured limits; limits are never automatically relearned from an abnormal production stream.

X-bar/R use fixed subgroup sizes 2–10 and tabulated A2/D3/D4 constants. Provide actual subgroup means and ranges; the UI groups the first selected stream by SUBGROUP. P supports changing denominators, NP requires fixed denominators, U handles defects per unit. CUSUM requires a qualified baseline target/sigma, configurable k and decision interval h. Distributional assumptions and rational subgrouping require process-engineer approval. A violation is investigation evidence, not proof of a root cause.
