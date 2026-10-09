# Local Windows startup

On 2026-10-09, the Windows task `NEXUS YMS Local Services` was installed for the current user. It starts the Node supervisor at sign-in and checks every five minutes to restart it when stopped. The task has no execution time limit and continues on battery power. Docker Desktop must be running for database/cache/Oracle connector access. Manage the task in Windows Task Scheduler. This machine configuration is separate from the manual shortcut below.

If the browser shows ERR_CONNECTION_REFUSED at http://127.0.0.1:8088/, the local web process is not listening. Docker Desktop runs PostgreSQL, Redis and the JDBC bridge, while the web/API/ETL applications run under the local Node supervisor.

Double-click scripts/Start-NEXUS.cmd in this project. Keep its command window open while using NEXUS. It starts the existing database/cache/connector containers and the compiled website, API and ETL worker. The supervisor restarts child services five seconds after an exit. It does not configure Windows boot/login startup. Logs are in .runtime/web.log, api.log and etl.log. Database volumes are preserved.

The shortcut requires Node.js, Docker Desktop and existing production builds. To rebuild after source changes, stop the supervisor first, run npm run build, and copy apps/web/.next/static into apps/web/.next/standalone/apps/web/.next/static before restarting. Avoid starting a second application stack on ports 8088/4000.

Recovery verified on 2026-10-06: web HTTP 200, admin authentication HTTP 201, authenticated ETL query API HTTP 200, successful browser sign-in to the dashboard. The previous web/API/ETL processes had stopped while PostgreSQL, Redis and JDBC remained running. No database reset was performed.
