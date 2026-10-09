ALTER TABLE etl_query_master DROP CONSTRAINT IF EXISTS etl_target;
ALTER TABLE etl_query_master ADD CONSTRAINT etl_target CHECK(target_table IN ('FACT_YIELD','FACT_DEFECT','FACT_SCRAP','FACT_SPC','FACT_LOT_PROCESS','FACT_LOT_DEFECT','FACT_LOT_MATERIAL'));
CREATE TABLE IF NOT EXISTS fact_lot_material (
 id uuid PRIMARY KEY, source text NOT NULL, source_key text NOT NULL,
 assembly_source text NOT NULL, lot_no text NOT NULL,
 sequence_no numeric NOT NULL CHECK(sequence_no >= 0),
 item_group text, size_type text, item_no text, item_lot_no text,
 raw_payload jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_key),
 FOREIGN KEY(assembly_source,lot_no) REFERENCES lot_registry(assembly_source,lot_no)
);
CREATE INDEX IF NOT EXISTS lot_material_route_idx ON fact_lot_material(assembly_source,lot_no,sequence_no,source_key);
CREATE INDEX IF NOT EXISTS lot_material_trace_idx ON fact_lot_material(item_lot_no,item_no);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_api') THEN GRANT SELECT ON fact_lot_material TO yms_api; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_etl') THEN GRANT SELECT,INSERT,UPDATE ON fact_lot_material TO yms_etl; END IF;
END $$;
