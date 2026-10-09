# Oracle JDBC extraction

`ORACLE_TRANSPORT=jdbc` selects the Java bridge instead of node-oracledb. Java 11, Oracle ojdbc8 19.30.0.0, and one HikariCP pool per approved source (maximum four connections) are provided in Docker. Oracle Instant Client is not required. The Node worker retains validation, quarantine, PostgreSQL writes, watermarks, retries, locks and audit records. Dashboards and API never contact Oracle or the bridge.

Set a random `JDBC_BRIDGE_TOKEN` of at least 32 characters, shared only by worker and bridge. `JDBC_BRIDGE_URL` is `http://jdbc:4010` in Compose and `http://127.0.0.1:4010` for the local Windows worker. Keep the bridge private; use a protected network or TLS when crossing hosts. Oracle accounts must have SELECT-only access to approved views and no side-effecting functions. JDBC Thin is a different driver from node-oracledb Thin. Database interoperability still requires qualification against the actual release.

The URL format is `jdbc:oracle:thin:@//HOST:PORT/SERVICE`. `oracle.jdbc.timezoneAsRegion=false` addresses legacy Oracle time-zone-file login errors (ORA-01882). Naive Oracle DATE/TIMESTAMP values use UTC interpretation, matching the warehouse contract; normalize local source times in SQL when needed.

## Startup

Build `docker/Dockerfile.jdbc` as `nexus-yms-jdbc:local`. Create ignored `.env.jdbc.local` with only `SOURCE_DB_1_*`, `SOURCE_DB_2_*`, `JDBC_BRIDGE_TOKEN`, and `ORACLE_CALL_TIMEOUT_MS`. Run with port 4010 bound to 127.0.0.1. Corporate database names must resolve inside Docker; supply host mappings when corporate DNS is unavailable. Restart the worker after transport/secret changes. Start this bridge alongside the local API, worker, web, PostgreSQL and Redis.

## Protocol

Authenticated POST `/extract` accepts `{source,sql,binds,test}`. The worker screens SQL, converts named timestamp binds to JDBC placeholders, and streams NDJSON batches of 1000. Read-only transactions are rolled back before pool return. Tests wrap SELECT with ROWNUM <= 5. A required completion marker detects truncated streams. Connection/pool wait timeout is ten seconds, network read timeout defaults to thirty seconds, and statement timeout is sixty seconds for tests or one hour for imports. Worker cancellation closes the stream; statements close when disconnect is observed. Requests and executor queues are bounded. `/health` proves bridge liveness, not Oracle connectivity.

Errors are visible in Synchronization log Details. Historical failures retain their status; a successful new run does not rewrite audit history. Failed-record counts refer to validation failures, so a connection failure can show zero failed records.

## Workspace verification — 2026-10-05

Both configured Oracle sources passed a SELECT-from-DUAL JDBC test. The existing AEY SELECT returned five rows that validated after replacing its NULL machine mapping with the explicit UNASSIGNED label. The historical import loaded 330,014 records from ACTL into fact_yield. Another 871 rows were quarantined for missing quantities, nonpositive input, or quantity imbalance; the completed job correctly reports partial and retains its checkpoint for correction/replay. PostgreSQL contains one fact per accepted source key/event timestamp despite a worker restart and replay during deployment. The 2,520 demonstration records remain separately tagged source=sample; no sample data was deleted.

The AEY source is a WIP lot summary, not a complete operation-event history. Its current operation code and assembly totals require manufacturing interpretation before using them as operation-level process yields. No machine data is inferred from UNASSIGNED. Naive source dates require source-time-zone qualification. JDBC connectivity does not certify these business semantics.
