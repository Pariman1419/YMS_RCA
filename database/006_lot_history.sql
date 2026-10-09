-- Additive migration: assembly facts remain in FACT_YIELD.
ALTER TABLE etl_query_master DROP CONSTRAINT IF EXISTS etl_target;
ALTER TABLE etl_query_master ADD CONSTRAINT etl_target CHECK(target_table IN ('FACT_YIELD','FACT_DEFECT','FACT_SCRAP','FACT_SPC','FACT_LOT_PROCESS','FACT_LOT_DEFECT'));
ALTER TABLE etl_query_master ADD COLUMN IF NOT EXISTS lot_scope text NOT NULL DEFAULT 'all';
ALTER TABLE etl_query_master ADD COLUMN IF NOT EXISTS anchor_source text NOT NULL DEFAULT '1';
ALTER TABLE etl_query_master ADD COLUMN IF NOT EXISTS lot_batch_size integer NOT NULL DEFAULT 100 CHECK(lot_batch_size BETWEEN 1 AND 500);
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS load_mode text;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS query_version integer;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'complete';
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS rows_read integer NOT NULL DEFAULT 0;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS batches_processed integer NOT NULL DEFAULT 0;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS total_lots integer;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS processed_lots integer NOT NULL DEFAULT 0;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS progress_percent double precision;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS configuration jsonb;
CREATE TABLE IF NOT EXISTS lot_registry (
 assembly_source text NOT NULL, lot_no text NOT NULL,
 customer_id integer NOT NULL REFERENCES dim_customer(customer_id),
 product_id integer NOT NULL REFERENCES dim_product(product_id),
 bom_id integer NOT NULL REFERENCES dim_bom(bom_id),
 factory text NOT NULL, assembly_date timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(assembly_source,lot_no)
);
CREATE INDEX IF NOT EXISTS lot_registry_date_idx ON lot_registry(assembly_date,assembly_source,lot_no);
CREATE TABLE IF NOT EXISTS fact_lot_process (
 id uuid PRIMARY KEY, source text NOT NULL, source_key text NOT NULL,
 assembly_source text NOT NULL, lot_no text NOT NULL, source_lot_no text,
 process_id integer NOT NULL REFERENCES dim_process(process_id),
 machine_id integer NOT NULL REFERENCES dim_machine(machine_id),
 operation_sequence numeric, process_code text,
 started_at timestamptz, completed_at timestamptz,
 input_qty bigint, output_qty bigint, reject_qty bigint, rework_qty bigint,
 yield_percentage numeric(12,6), status text NOT NULL,
 quality_status text NOT NULL, quality_errors jsonb NOT NULL DEFAULT '[]',
 operator_name text, shift text, raw_payload jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_key),
 FOREIGN KEY(assembly_source,lot_no) REFERENCES lot_registry(assembly_source,lot_no)
);
CREATE INDEX IF NOT EXISTS lot_process_process_idx ON fact_lot_process(process_id);
CREATE INDEX IF NOT EXISTS lot_process_machine_idx ON fact_lot_process(machine_id);
CREATE INDEX IF NOT EXISTS lot_process_route_idx ON fact_lot_process(assembly_source,lot_no,operation_sequence,completed_at);
CREATE INDEX IF NOT EXISTS lot_process_analytics_idx ON fact_lot_process(completed_at,process_id,machine_id) WHERE quality_status='valid';
CREATE INDEX IF NOT EXISTS lot_process_time_brin ON fact_lot_process USING brin(completed_at);
CREATE TABLE IF NOT EXISTS fact_lot_defect (
 id uuid PRIMARY KEY, source text NOT NULL, source_key text NOT NULL,
 assembly_source text NOT NULL,lot_no text NOT NULL, source_lot_no text,
 process_id integer NOT NULL REFERENCES dim_process(process_id),
 machine_id integer NOT NULL REFERENCES dim_machine(machine_id),
 operation_sequence numeric, process_source_key text,
 defect_code text NOT NULL, defect_description text NOT NULL, qty bigint,
 rework_qty bigint,occurred_at timestamptz,
 quality_status text NOT NULL,quality_errors jsonb NOT NULL DEFAULT '[]',
 raw_payload jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_key),
 FOREIGN KEY(assembly_source,lot_no) REFERENCES lot_registry(assembly_source,lot_no)
);
CREATE INDEX IF NOT EXISTS lot_defect_route_idx ON fact_lot_defect(assembly_source,lot_no,operation_sequence);
CREATE INDEX IF NOT EXISTS lot_defect_analytics_idx ON fact_lot_defect(occurred_at,defect_code) WHERE quality_status='valid';
CREATE TABLE IF NOT EXISTS lot_enrichment_checkpoint (
 query_id text NOT NULL REFERENCES etl_query_master(query_id) ON DELETE CASCADE,
 assembly_source text NOT NULL,lot_no text NOT NULL,
 query_version integer NOT NULL, imported_records integer NOT NULL,
 status text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(query_id,assembly_source,lot_no),
 FOREIGN KEY(assembly_source,lot_no) REFERENCES lot_registry(assembly_source,lot_no)
);
INSERT INTO lot_registry(assembly_source,lot_no,customer_id,product_id,bom_id,factory,assembly_date)
 SELECT DISTINCT ON(source,lot_no) source,lot_no,customer_id,product_id,bom_id,factory,transaction_date
 FROM fact_yield WHERE source <> 'sample' ORDER BY source,lot_no,transaction_date DESC
 ON CONFLICT(assembly_source,lot_no) DO UPDATE SET customer_id=EXCLUDED.customer_id,product_id=EXCLUDED.product_id,bom_id=EXCLUDED.bom_id,factory=EXCLUDED.factory,assembly_date=EXCLUDED.assembly_date,updated_at=now();
CREATE OR REPLACE VIEW v_process_yield AS
 SELECT h.source,h.source_key,h.lot_no,r.customer_id,r.product_id,r.bom_id,h.process_id,h.machine_id,
 h.completed_at transaction_date,r.factory,coalesce(h.shift,'Unknown') shift,coalesce(h.operator_name,'Unknown') operator,
 h.input_qty,h.output_qty,h.reject_qty,coalesce(h.rework_qty,0) rework_qty,0::numeric unit_cost,h.yield_percentage
 FROM fact_lot_process h JOIN lot_registry r USING(assembly_source,lot_no)
 WHERE h.quality_status='valid' AND h.completed_at IS NOT NULL;
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_process_yield_daily AS
 SELECT source,lot_no,customer_id,product_id,bom_id,process_id,machine_id,
 date_trunc('day',transaction_date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' transaction_date,factory,shift,operator,unit_cost,
 sum(input_qty) input_qty,sum(output_qty) output_qty,sum(reject_qty) reject_qty,sum(rework_qty) rework_qty
 FROM v_process_yield GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12;
CREATE UNIQUE INDEX IF NOT EXISTS mv_process_yield_daily_key ON mv_process_yield_daily(source,lot_no,customer_id,product_id,bom_id,process_id,machine_id,transaction_date,factory,shift,operator,unit_cost);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_api') THEN
  GRANT SELECT ON lot_registry,fact_lot_process,fact_lot_defect,lot_enrichment_checkpoint,v_process_yield,mv_process_yield_daily TO yms_api;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_etl') THEN
  GRANT SELECT,INSERT,UPDATE ON lot_registry,fact_lot_process,fact_lot_defect,lot_enrichment_checkpoint TO yms_etl;
  GRANT SELECT ON v_process_yield,mv_process_yield_daily TO yms_etl;
  ALTER MATERIALIZED VIEW mv_process_yield_daily OWNER TO yms_etl;
 END IF;
END $$;
