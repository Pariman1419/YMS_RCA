# Local accounts and administration

Local sign-in is the default. Microsoft sign-in is not required.

Initial username: `admin`. Initial password: `admin`, as requested. The API creates this account only if absent; restarts never reset its password. `BOOTSTRAP_ADMIN_PASSWORD` sets the initial password for new environments.

Administrators open **User management** to add accounts, assign one or more business roles, disable accounts, and edit/reset passwords. Edits revoke the affected account's existing sessions. The reserved admin account cannot be disabled, renamed or stripped of Administrator access. Passwords are scrypt hashes; plaintext passwords are never stored. Sessions are eight-hour, opaque tokens in HttpOnly/SameSite cookies, stored hashed in PostgreSQL. Production cookies require HTTPS. Sign out with the top-right account button. Login attempts are rate limited and accounts lock for 15 minutes after repeated failures. Account/login changes are audited without credentials.

Administrators open **ETL control**, click an existing query name, edit SQL/source/target/load mode/schedule/enabled, and save. Changes increment configuration version; running jobs do not advance a checkpoint against a changed query version. SQL tests and executions remain confined to the worker.

## Existing database upgrade

Run `database/005_local_users.sql` against the existing database using a DBA account before starting the updated API. The migration is additive and retains manufacturing data. New Docker volumes apply it automatically. Run `npm run db:generate` after updating Prisma source. Set `AUTH_MODE=local`, `AUTH_DEMO=false`, `NEXT_PUBLIC_AUTH_MODE=local`. Rebuild the frontend after changing public settings. Set WEB_ORIGIN to the exact browser origin; browser and API must share the same site (for local use, both 127.0.0.1 or both localhost). Production uses /api behind Nginx and HTTPS.

Optional Entra integration remains available by explicitly choosing AUTH_MODE=entra and NEXT_PUBLIC_AUTH_MODE=entra. Local accounts are not accepted in that mode.

## API

POST /auth/login {username,password}; POST /auth/logout; POST /auth/password {currentPassword,password} (revokes sessions). GET /users, POST /users, PUT /users/:id require Administrator. User create/update body: {username,name,roles,enabled,password?}. Password is required for creation; omitted on update preserves current hash. Local /me returns id, username, name, roles. Do not share default credentials beyond initial setup; administrator can replace them in User management.
