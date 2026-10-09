-- Run separately as DBA after initialization. Assign passwords via your secret manager.
-- Do not use the bootstrap superuser in production services.
CREATE ROLE yms_api LOGIN;
CREATE ROLE yms_etl LOGIN;
GRANT CONNECT ON DATABASE "YMS_DATABASE" TO yms_api,yms_etl;
GRANT USAGE ON SCHEMA public TO yms_api,yms_etl;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO yms_api;
GRANT INSERT,UPDATE ON etl_query_master,audit_log,alert,alert_rule,lot_comment,attachment,report_schedule TO yms_api;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO yms_etl;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO yms_etl;
REVOKE UPDATE ON audit_log FROM yms_api,yms_etl;
-- PostgreSQL 16 requires MV ownership for refresh. Only the worker owns this aggregate.
ALTER MATERIALIZED VIEW mv_yield_daily OWNER TO yms_etl;
ALTER MATERIALIZED VIEW mv_process_yield_daily OWNER TO yms_etl;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO yms_api,yms_etl;

GRANT SELECT,INSERT,UPDATE ON app_user TO yms_api;
GRANT SELECT,INSERT,DELETE ON auth_session TO yms_api;
GRANT SELECT,UPDATE ON ai_assistance_config TO yms_api;
GRANT UPDATE(machine_model) ON dim_machine TO yms_api;
