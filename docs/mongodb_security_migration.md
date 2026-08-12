# Securing the production MongoDB connection

## Current state (as found)

- `Inmate_BE/.env`'s `DB_MONGO_URL` currently points at `mongodb://127.0.0.1:27017/Inmate-latest` — a **local, unauthenticated, unencrypted** connection, even though `NODE_ENV=production` in the same file. The app's `BASE_URL`/`GLOBAL_URL` point at an `onrender.com` domain, indicating the backend itself is deployed on Render.com.
- `.env` also contains **commented-out, disabled** MongoDB Atlas SRV connection strings with embedded credentials from an earlier configuration. Even though `.env` is gitignored today (`Inmate_BE/.gitignore` excludes `/.env`), if this file was ever committed before that ignore rule was added, those credentials may still be recoverable from git history.
- No Dockerfile, docker-compose, Kubernetes/Ansible/Terraform config, or any other infrastructure-as-code exists anywhere in this repository — MongoDB itself is not something this codebase deploys or manages; it's a separate piece of infrastructure the operator controls directly (a self-hosted `mongod`, or previously an Atlas cluster).
- The application code loaded the entire connection string from `process.env.DB_MONGO_URL` already (no hardcoded credentials in code), but had **no TLS support at all** and no way to be told "this connection must be secure."

## What changed in this fix (application side only)

This fix could only touch the application's *connection code* — it cannot reach into the actual MongoDB server's configuration from here, since that server isn't part of this repository or reachable from this environment. Four files changed in `Inmate_BE`:

- **`src/config/mongoSecurity.js`** (NEW) — builds TLS connection options from environment variables, redacts credentials out of anything that gets logged, and flags (or optionally blocks) startup when the configured connection looks unauthenticated/unencrypted.
- **`src/config/db.js`** (EDITED) — the main app's Mongoose connection now passes those TLS options through, warns (or refuses to start, if configured) on an insecure `DB_MONGO_URL`, and never logs a raw error object that might embed the connection string.
- **`src/config/cronBackup.js`** (EDITED) — the live, scheduled JSON backup job's `MongoClient` connection gets the same TLS options and redacted error logging.
- **`src/service/backupDatabaseService.js`** (EDITED) — this file is **dead code, not wired into `server.js` or any route** (confirmed - nothing requires it), but it contained a hardcoded, unauthenticated `mongodump --uri="mongodb://localhost:27017/Inmate-dev"` command pointing at a different database name than production. Removed the hardcoded URI; it now reads `DB_MONGO_BACKUP_URI` (a dedicated, optional least-privilege backup credential) or falls back to `DB_MONGO_URL`, and refuses to run at all if neither is set.

None of this required — or made — any change to `.env` itself; the live secrets file was left untouched, consistent with every other fix in this series. New env vars are documented below for you to add once ready.

**Caveat on `backupDatabaseService.js`:** it shells out to the `mongodump` binary with the URI on the command line (`exec(...)`), which means the connection string (including credentials) is briefly visible to anything that can list processes on the same host (`ps aux`) while it runs. This is a pre-existing limitation of using `mongodump` via `exec` rather than the Node driver directly (the *other*, live backup path — `cronBackup.js` — already avoids this by using the `mongodb` driver's `MongoClient` instead). Since this file is unreferenced dead code, a deeper rewrite was out of scope for "do not make unrelated changes" — flagging it here in case you ever wire it up.

## New environment variables (all optional, all off by default — nothing breaks until you opt in)

Add these to your **deployment platform's environment variable settings** (e.g. the Render dashboard) once the MongoDB server itself has authentication and TLS enabled — never write real values into `.env` in the repo.

| Variable | Purpose |
|---|---|
| `DB_MONGO_URL` | (already exists) full connection string — this is where the username/password/host/authSource live. Never change this to a bare string in code. |
| `DB_MONGO_TLS_ENABLED` | `"true"` to require TLS on the connection. |
| `DB_MONGO_TLS_CA_FILE` | Path to the CA certificate file (mounted into the runtime, e.g. via Render's "Secret Files"). |
| `DB_MONGO_TLS_CERT_KEY_FILE` | Path to a client certificate + key file, only needed for mutual TLS / X.509 client authentication. |
| `DB_MONGO_TLS_CERT_KEY_FILE_PASSWORD` | Passphrase for the above file, if it's encrypted. |
| `DB_MONGO_TLS_ALLOW_INVALID_CERTIFICATES` | `"true"` to skip certificate validation. **Never set this in production** — it exists only for short-lived local testing against a self-signed cert. |
| `DB_MONGO_TLS_ALLOW_INVALID_HOSTNAMES` | Same caveat as above, for hostname validation. |
| `DB_MONGO_AUTH_SOURCE` | Explicit `authSource`, if you'd rather not embed it in the URI's query string. |
| `DB_MONGO_REQUIRE_SECURE` | `"true"` to make the app **refuse to start** if `DB_MONGO_URL` has no credentials or TLS isn't enabled. Leave unset until you've completed the migration below and confirmed the secured connection works — then turn it on so a future accidental rollback to an insecure URL fails loudly instead of silently. |
| `DB_MONGO_BACKUP_URI` | Optional, separate least-privilege (ideally read-only) credential for backup jobs, distinct from the main app's read/write user. |

If you don't set any of the `DB_MONGO_TLS_*`/`DB_MONGO_REQUIRE_SECURE` vars, behavior is **byte-identical to before this fix** — this is intentionally non-breaking for local development.

## Migration steps for the actual MongoDB server

You have two realistic paths. Pick based on how MongoDB is actually hosted today (the `.env` snapshot suggests a self-hosted `mongod` reachable at `127.0.0.1:27017` from wherever the app runs, but confirm this against your real infrastructure before proceeding).

### Path A — move to a managed provider (recommended, least effort)

MongoDB Atlas (or another managed MongoDB) gives you authentication and TLS by default with no certificate management on your end — the `.env` history shows this project used Atlas before, so this may just be reverting to that setup with a fresh, least-privilege user:

1. Create (or reactivate) an Atlas cluster (or equivalent managed MongoDB).
2. Create a dedicated **application user** scoped to only the database this app uses (`readWrite` on that one database — not `atlasAdmin`/`root`).
3. Optionally create a second, **read-only** user for `DB_MONGO_BACKUP_URI`.
4. Restrict network access to the specific IP(s)/CIDR your app runs from (Atlas's IP Access List), not `0.0.0.0/0`.
5. Copy the provided `mongodb+srv://` connection string (it already includes `tls=true` by default on Atlas) into `DB_MONGO_URL` in your deployment platform's environment settings.
6. Skip the `DB_MONGO_TLS_CA_FILE`/`DB_MONGO_TLS_CERT_KEY_FILE` vars entirely — Atlas's TLS uses publicly-trusted certs, so the driver validates them without any extra configuration. You only need `DB_MONGO_TLS_ENABLED=true` if the `+srv` URI doesn't already set `tls=true` (it does, by default).
7. Rotate out any old Atlas credentials that were ever in a committed `.env` (see "Credential rotation" below) — don't reuse them.

### Path B — harden the existing self-hosted `mongod`

If MongoDB genuinely stays self-hosted (e.g. co-located with the app, or on its own VM):

1. **Create users before enabling authorization** (once `authorization` is on, you can no longer create users without already being authenticated — MongoDB's `--localhost` exception lets you do this once, from the same host, before the first restart):
   ```js
   // via mongosh, connected locally before authorization is enabled
   use admin
   db.createUser({
     user: "admin",
     pwd: passwordPrompt(),   // never type the password as a literal in a script
     roles: [{ role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase"]
   })

   use inmate            // the app's actual database name
   db.createUser({
     user: "inmate_app",
     pwd: passwordPrompt(),
     roles: [{ role: "readWrite", db: "inmate" }]
   })
   // optional, for DB_MONGO_BACKUP_URI:
   db.createUser({
     user: "inmate_backup",
     pwd: passwordPrompt(),
     roles: [{ role: "read", db: "inmate" }]
   })
   ```
2. **Obtain TLS certificates** from a real CA (your org's internal CA, or a public one like Let's Encrypt if the server has a public hostname) — do not generate a throwaway self-signed cert for production, and never commit any `.pem`/`.crt`/`.key` file to git.
3. **Edit `mongod.conf`** on the database host:
   ```yaml
   security:
     authorization: enabled
   net:
     bindIp: 127.0.0.1,<app-server-private-ip>   # never 0.0.0.0 on a publicly reachable host
     tls:
       mode: requireTLS
       certificateKeyFile: /etc/mongo/certs/mongod.pem   # server cert+key, combined
       CAFile: /etc/mongo/certs/ca.pem
   ```
4. **Restart `mongod`** to pick up both changes.
5. **Confirm the port is not exposed to the public internet** — check the host's firewall/security-group rules; `27017` should only be reachable from the app server(s), never `0.0.0.0/0`.
6. **Update the deployment platform's environment variables** (not `.env` in git):
   ```
   DB_MONGO_URL=mongodb://inmate_app:<password>@<db-host>:27017/inmate?authSource=admin&tls=true
   DB_MONGO_TLS_ENABLED=true
   DB_MONGO_TLS_CA_FILE=/etc/secrets/mongo-ca.pem   # the CA file, made available to the app's runtime
   DB_MONGO_BACKUP_URI=mongodb://inmate_backup:<password>@<db-host>:27017/inmate?authSource=admin&tls=true
   ```
   How the CA file gets onto the app's runtime depends on your platform — Render supports mounting "Secret Files" at a path you choose; point `DB_MONGO_TLS_CA_FILE` at that path.
7. **Redeploy/restart the app.**

## Credential rotation

Regardless of which path you take: rotate any credentials that ever appeared in a committed `.env`. Check whether `.env` was ever tracked before the current `.gitignore` rule was added:
```
git log --all --full-history -- Inmate_BE/.env
```
If any commits show up, treat every credential that ever appeared there as compromised — rotate it on the provider side (Atlas password reset, or drop-and-recreate the self-hosted user) even though `.gitignore` now excludes the file going forward; `.gitignore` only stops *future* commits, it does not remove secrets already in history.

## Verifying the connection after migration

1. **Direct check with `mongosh`**, from the same network the app runs on:
   ```
   mongosh "mongodb://inmate_app:<password>@<db-host>:27017/inmate?authSource=admin&tls=true" --tlsCAFile /path/to/ca.pem
   ```
   A successful connection + `db.runCommand({ping: 1})` returning `{ ok: 1 }` confirms auth and TLS both work end-to-end before you touch the app.
2. **App-level check**: after setting the new env vars and redeploying, watch the startup logs for:
   ```
   Mongo db connected succesfully
   ```
   with **no** `Mongo DB security warning:` line above it. If you see the warning, the URI/TLS env vars aren't fully in place yet — the app will still run (fail-open by default), but the connection isn't actually secured.
3. **Enforce it**: once step 2 is clean, set `DB_MONGO_REQUIRE_SECURE=true` and redeploy once more. The app should start exactly as before (since the connection is already secure by this point) — this just locks in a fail-fast guard against ever silently falling back to an insecure `DB_MONGO_URL` in the future.
4. **Smoke-test the app itself**: log in, load a dashboard page, confirm data reads/writes work normally against the now-authenticated connection.

## Verification performed in this fix (and its limits)

This sandbox has no reachable path to a real MongoDB server or Docker registry (both `hub.docker.com` and MongoDB's own binary CDN, `fastdl.mongodb.org`/`repo.mongodb.org`, return `403` here — only the npm registry is reachable) — a live TLS+auth connection test genuinely could not be run from this environment. Instead, this fix was verified with a 26-assertion test harness (`/tmp/verify_mongo/app/mongo.test.js`, throwaway, not delivered) that requires the REAL, unmodified `mongoSecurity.js`, `db.js`, `cronBackup.js`, and `backupDatabaseService.js` against stubbed `mongoose`/`mongodb`/`node-cron` driver modules, confirming: the exact TLS options object built from every env var combination; credentials are correctly stripped from log output in every failure path (parse errors, connection errors, exec errors); an insecure `DB_MONGO_URL` triggers a warning but still connects by default, and is fully blocked (`process.exit(1)`, no connection attempted) when `DB_MONGO_REQUIRE_SECURE=true`; a secure URI (credentials + `tls=true`) connects with zero warnings; behavior is byte-identical to the pre-fix code when no new env vars are set; and the dead `backupDatabaseService.js` no longer runs at all without a configured URI, no longer contains the old hardcoded `Inmate-dev` URI, and correctly prefers `DB_MONGO_BACKUP_URI` over `DB_MONGO_URL` when both are set. All 26 passed.

**This does not replace a real connectivity test.** Please run the `mongosh` check in step 1 above against your actual (or a local test) MongoDB instance with auth + TLS enabled before relying on this in production.
