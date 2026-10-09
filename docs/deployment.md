Oracle JDBC is now configured by default in Compose and this workspace. See [JDBC setup and troubleshooting](jdbc.md). The node-oracledb notes below apply to ORACLE_TRANSPORT=node.

Local authentication is now the default; Microsoft login is optional. Follow [local accounts and existing-database upgrade](local-users.md). The Entra instructions below apply only when AUTH_MODE=entra. For local deployment apply script 005, configure the exact origin, and use HTTPS for production sessions.

# Deployment guide

## Local development

Use `compose.dev.yaml` for PostgreSQL and Redis only, root `.env` for the API/worker and `apps/web/.env.local` for public browser settings. Demo authentication is explicitly development-only and returns an Administrator identity. Do not expose the local preview beyond a trusted development machine. The sample seed refuses `NODE_ENV=production`.

## Linux production deployment

1. Provision a Linux host or orchestrated cluster, TLS ingress, persistent PostgreSQL/Redis storage, private network paths, secret manager and monitored backups. Docker Compose is a single-host deployment reference; it is not an HA cluster.
2. Copy `.env.example` to `.env`; set a strong bootstrap `POSTGRES_PASSWORD`, Entra values, exact `WEB_ORIGIN`, read-only Oracle credentials and provider settings. Use separate `API_DATABASE_URL` and `ETL_DATABASE_URL` with the internal PostgreSQL hostname `postgres`. Never commit `.env`. Secret-manager injected variables are preferred to plaintext files in production.
3. Initialize the warehouse: `docker compose up -d postgres redis`. SQL scripts 001, 002, 004 and 005 execute **only when the PostgreSQL volume is empty**.
4. Execute `database/003_security.sql` as the bootstrap DBA account. Assign yms_api/yms_etl passwords securely using DBA tooling, and set matching connection URLs. The SQL file intentionally contains no passwords. The API may read facts but cannot modify them. The ETL role owns and refreshes the materialized aggregate.
5. Choose local accounts (default) or configure optional Entra registrations and app roles below. Verify Oracle views, accounts and timestamp contracts. Do not seed production with sample records.
6. Run `docker compose build` and `docker compose up -d`. Services use a non-root Node user. The API receives no Oracle credentials. The worker uses node-oracledb Thin mode; if your Oracle version/authentication requires Thick mode, add a licensed compatible Instant Client and a reviewed driver initialization before deployment.
7. Put the provided Nginx HTTP listener behind a TLS-terminating reverse proxy/load balancer. Port 8080 is an upstream HTTP port, not a complete public TLS deployment. Configure certificates, HSTS, trusted proxy headers, private database/Redis networking, and source firewall rules according to the organization standard. Bind Compose published ports appropriately.
8. Verify `/api/health/ready`, Entra sign-in, least-privilege access, read-only Oracle SQL tests, one bounded full load, quantity reconciliation, then incremental schedules. Verify the materialized aggregate and dashboard agree with source/MES reconciliation totals.
9. Run load qualification, failover/restart tests, notification delivery tests, backup restore and process-engineer metric/SPC acceptance before go-live.

The Docker build requires network access to the official package registry. `package-lock.json` pins installed versions. Build-time public Entra values are embedded into the Next.js application; rebuilding is required when changing them. Database URLs, Oracle passwords and AI keys are server-only.

## Microsoft Entra ID setup

- Register a single-tenant API application, expose an API scope such as `api://<API_APP_ID>/access_as_user`, and issue v2 access tokens.
- Define application role display names: Administrator, Yield Engineer, QA Engineer, Production Engineer, Process Engineer, Manager, Executive. Use token values Administrator, YieldEngineer, QAEngineer, ProductionEngineer, ProcessEngineer, Manager, Executive. Entra role values cannot contain spaces; the API maps values to business display names. A manifest fragment for a new API registration is provided in database/entra-app-roles.json. Preserve existing role IDs when updating an existing registration. Assign users/groups through the enterprise application. A token with no recognized assigned role is denied.
- Register a browser SPA, add the real HTTPS application origin as a SPA redirect URI, grant the delegated API scope and obtain required tenant consent.
- Set `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE` to the API application audience, `NEXT_PUBLIC_ENTRA_CLIENT_ID` to the SPA app ID, `NEXT_PUBLIC_ENTRA_TENANT_ID`, `NEXT_PUBLIC_ENTRA_SCOPE` to the exposed API scope. Confirm the actual token `aud` value matches the configured audience.
- Set `AUTH_DEMO=false`, `NEXT_PUBLIC_AUTH_DEMO=false`, `NODE_ENV=production`. The API exits if production auth is incomplete or demo auth is enabled. MSAL handles authorization-code flow with PKCE and token refresh; bearer tokens are not stored in the YMS database.
- Verify unauthorized requests return 401 and Executive cannot create/edit SQL or modify lots. Validate tenant sign-in and conditional-access policies with the identity team.

## Oracle sources

ACTL: SOURCE_DB_1_HOST=ACTL_BASE, PORT=1521, SERVICE=ACTL.
BSM: SOURCE_DB_2_HOST=BSM_BASE, PORT=1521, SERVICE=BSM.

Each has a separate pool (max four connections), queue timeout (10s default), per-round-trip call timeout (30s default) and job deadline (one hour). BullMQ retries failed jobs three times with exponential backoff. A test consumes at most five rows and has a shorter deadline. Oracle call timeout is per round trip, not a substitute for a job deadline, as documented by [node-oracledb](https://node-oracledb.readthedocs.io/en/stable/api_manual/connection.html).

Use approved extraction views with uppercase aliases matching the contracts. Index the source modification timestamp and stable transaction key. Avoid SELECT * in production. Restrict grants so source users cannot perform DML, invoke side-effecting packages or access unauthorized views. Perform a manual SQL test before enabling the schedule. The source configuration supports these two registered sources; extending beyond two requires adding registry support and a configuration schema rather than trusting arbitrary host input.

## AI providers

| Provider     | AI_PROVIDER | AI_BASE_URL example         | AI_MODEL                 |
| ------------ | ----------- | --------------------------- | ------------------------ |
| Ollama       | ollama      | http://ollama:11434/v1      | installed model name     |
| Llama 3      | llama3      | http://ollama:11434/v1      | llama3                   |
| Phi-4        | phi4        | http://ollama:11434/v1      | phi4                     |
| DeepSeek     | deepseek    | https://api.deepseek.com/v1 | deepseek-chat            |
| OpenAI       | openai      | https://api.openai.com/v1   | an enabled account model |
| Azure OpenAI | azure       | uses AZURE_OPENAI_ENDPOINT  | deployment-specific      |

For Azure configure AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION and AI_API_KEY. For hosted providers set AI_API_KEY. For local Ollama ensure the model is already installed and reachable; localhost inside a container is the container itself. Outbound aggregate disclosure requires organizational approval and the user's UI consent. AI is disabled by default. Do not use model suggestions as automatic machine/recipe control actions.

## Alerts, reports and attachments

Set TEAMS_WEBHOOK_URL to an approved Teams workflow webhook and verify its accepted payload shape. Set SMTP_HOST/PORT/USER/PASSWORD/FROM and ALERT_EMAIL_TO for email. No messages are sent when channel configuration is absent. Delivery attempts are persisted, retried up to five times and then marked failed. Alert acknowledgment does not guarantee external delivery.

Reports are generated into the persistent `reports` volume, shared read-only with the API. Attachments use a separate `uploads` volume, UUID storage names, size/type checks and forced-download responses. Add organizational malware scanning, content-signature inspection, retention policies and object storage before exposing uploads to a broad production audience. Existing attachment history is preserved; no automatic destructive retention job is enabled.

JWT validation follows Microsoft's audience, tenant, issuer and signature guidance: [validate access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation). This implementation is single-tenant; do not replace the issuer with `common` without designing tenant authorization.

Role-value constraints follow [Microsoft app role guidance](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps).
