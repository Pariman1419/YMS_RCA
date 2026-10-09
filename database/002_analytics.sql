-- UTC is the warehouse calendar convention. Factory local calendar mapping can be added in ETL.
SET TIME ZONE 'UTC';
CREATE OR REPLACE PROCEDURE ensure_yield_partitions(start_month date, months integer)
LANGUAGE plpgsql AS $$
DECLARE d date; finish date; part text;
BEGIN
 IF months < 1 OR months > 240 THEN RAISE EXCEPTION 'months must be 1..240'; END IF;
 FOR i IN 0..months-1 LOOP
  d := (date_trunc('month',start_month) + make_interval(months=>i))::date;
  finish := (d + interval '1 month')::date;
  part := 'fact_yield_' || to_char(d,'YYYYMM');
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF fact_yield FOR VALUES FROM (%L) TO (%L)',part,d,finish);
 END LOOP;
END $$;
CALL ensure_yield_partitions((CURRENT_DATE - interval '24 months')::date, 48);
-- Historical loads outside the prepared range land here. Move these rows before attaching overlapping partitions.
CREATE TABLE fact_yield_default PARTITION OF fact_yield DEFAULT;
ALTER TABLE fact_yield ADD CONSTRAINT yield_quantities CHECK (input_qty > 0 AND output_qty >= 0 AND reject_qty >= 0 AND rework_qty >= 0 AND output_qty + reject_qty <= input_qty AND rework_qty <= input_qty);
ALTER TABLE fact_yield ADD CONSTRAINT yield_percentage_range CHECK (yield_percentage BETWEEN 0 AND 100);
ALTER TABLE fact_defect ADD CONSTRAINT defect_quantity CHECK (qty >= 0);
ALTER TABLE fact_scrap ADD CONSTRAINT scrap_quantity CHECK (scrap_qty >= 0);
ALTER TABLE fact_spc ADD CONSTRAINT spc_limits CHECK (lcl <= target AND target <= ucl AND sample_size > 0);
ALTER TABLE etl_query_master ADD CONSTRAINT etl_source CHECK (oracle_source IN ('1','2'));
ALTER TABLE etl_query_master ADD CONSTRAINT etl_schedule CHECK (schedule IN ('15m','30m','hourly','daily'));
ALTER TABLE etl_query_master ADD CONSTRAINT etl_target CHECK (target_table IN ('FACT_YIELD','FACT_DEFECT','FACT_SCRAP','FACT_SPC'));
ALTER TABLE etl_query_master ADD CONSTRAINT etl_mode CHECK (load_mode IN ('full','incremental','delta'));
CREATE INDEX fact_yield_time_brin ON fact_yield USING brin(transaction_date);
CREATE INDEX fact_yield_machine_time ON fact_yield(machine_id,transaction_date);
CREATE INDEX fact_yield_process_time ON fact_yield(process_id,transaction_date);
CREATE INDEX fact_yield_factory_time ON fact_yield(factory,transaction_date);
CREATE MATERIALIZED VIEW mv_yield_daily AS
SELECT source,lot_no,customer_id,product_id,bom_id,process_id,machine_id,date_id,
 date_trunc('day',transaction_date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS transaction_date,
 factory,shift,operator,unit_cost,
 sum(input_qty)::bigint input_qty,sum(output_qty)::bigint output_qty,
 sum(reject_qty)::bigint reject_qty,sum(rework_qty)::bigint rework_qty
FROM fact_yield
GROUP BY source,lot_no,customer_id,product_id,bom_id,process_id,machine_id,date_id,9,factory,shift,operator,unit_cost;
CREATE UNIQUE INDEX mv_yield_daily_key ON mv_yield_daily(source,lot_no,customer_id,product_id,bom_id,process_id,machine_id,date_id,transaction_date,factory,shift,operator,unit_cost);
CREATE INDEX mv_yield_daily_date ON mv_yield_daily(transaction_date,customer_id,product_id);
CREATE INDEX mv_yield_daily_process ON mv_yield_daily(process_id,transaction_date);
CREATE INDEX mv_yield_daily_machine ON mv_yield_daily(machine_id,transaction_date);
CREATE INDEX mv_yield_daily_lot ON mv_yield_daily(lot_no,transaction_date);
CREATE INDEX pending_alert_deliveries ON alert_delivery(next_attempt_at) WHERE status='pending';
CREATE INDEX due_etl_queries ON etl_query_master(next_run_at) WHERE enabled;
CREATE INDEX due_reports ON report_schedule(next_run_at) WHERE enabled;
ANALYZE;
