-- Durable parent/child ETL execution chain.
ALTER TABLE etl_query_master ADD COLUMN IF NOT EXISTS depends_on_query_id text REFERENCES etl_query_master(query_id);
ALTER TABLE etl_job ADD COLUMN IF NOT EXISTS parent_job_id text REFERENCES etl_job(id);
CREATE INDEX IF NOT EXISTS etl_query_dependency_idx ON etl_query_master(depends_on_query_id) WHERE depends_on_query_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS etl_job_parent_idx ON etl_job(parent_job_id,query_id,start_time);
CREATE TABLE IF NOT EXISTS etl_dependency_dispatch (
 dispatch_id text PRIMARY KEY,
 parent_job_id text NOT NULL REFERENCES etl_job(id),
 child_query_id text NOT NULL REFERENCES etl_query_master(query_id) ON DELETE CASCADE,
 configuration jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','queued','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 queued_at timestamptz,
 UNIQUE(parent_job_id,child_query_id)
);
CREATE INDEX IF NOT EXISTS etl_dependency_pending_idx ON etl_dependency_dispatch(created_at) WHERE status='pending';
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_api') THEN
  GRANT SELECT ON etl_dependency_dispatch TO yms_api;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='yms_etl') THEN
  GRANT SELECT,INSERT,UPDATE ON etl_dependency_dispatch TO yms_etl;
 END IF;
END $$;
