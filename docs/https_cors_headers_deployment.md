# HTTPS, CORS, and Security Headers — deployment notes

This documents the env vars introduced by the HTTPS/CORS/security-headers audit, what they default to, and when an operator needs to change them for a deployment topology different from this app's current one (Render.com, confirmed via `BASE_URL`/`GLOBAL_URL` in `.env`).

All of these are optional. With none of them set, production behavior is: trust exactly one reverse-proxy hop, enforce HTTPS, send HSTS, and use the same two CORS origins this app has always used. Development/test behavior (`NODE_ENV` anything other than `production`) is unchanged from before this fix in every respect except the new response headers (CSP, `X-Content-Type-Options`, etc.), which are always on since they don't depend on the deployment's HTTPS topology.

## `TRUST_PROXY`

Controls Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting, which determines what `req.ip` and `req.secure` reflect - the raw socket connection, or the `X-Forwarded-For`/`X-Forwarded-Proto` headers set by a reverse proxy in front of the app.

- **Default: `1` in production, disabled in development.** `1` means "trust exactly one hop" - correct for this app's current single-reverse-proxy Render.com deployment, and safer than trusting an unlimited number of hops (`true`), which would let any client forge its own `X-Forwarded-For` and spoof its IP straight past the rate limiter (see the "Fixed" section on rate limiting in `security_fixes_log`).
- Set to **`false`** if this app is ever deployed with no reverse proxy in front of it at all (directly exposed, or behind a proxy that does not set these headers) - `req.ip`/`req.secure` will then reflect the raw connection, same as before this fix.
- Set to a **number** (`"2"`, `"3"`, ...) if there is ever more than one reverse-proxy hop between the client and this app.

## `ENFORCE_HTTPS`

Controls whether plain-HTTP requests are redirected (GET/HEAD, 301) or rejected (other methods, 400) in production - see `middleware/enforceHttps.js`.

- **Default: `"true"` in production, `"false"` otherwise.**
- Set to **`"false"`** to disable even in production, if TLS termination happens somewhere this app can't detect via `X-Forwarded-Proto` (e.g. `TRUST_PROXY` can't be configured correctly for the actual topology).
- This flag and `TRUST_PROXY` are independent - disabling one does not disable the other.

## `CORS_ALLOWED_ORIGINS`

Comma-separated list of origins allowed to make credentialed cross-origin requests (see `server.js`'s `corsOptionsDelegate`). Always an explicit allowlist, never a wildcard - `credentials: true` requires it.

- **Default (unset): `http://localhost:5173,https://inmateapi.agsoftsolutions.co.in`** - the same two origins this app has always allowed.
- Set this to add or rotate a production frontend origin without a code deploy, e.g. `CORS_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com`.
- Setting it to an empty value blocks all cross-origin browser requests (fails closed) and logs a startup warning - almost certainly a misconfiguration, not an intended "block everything" mode, so check for a trailing/stray comma or an unset variable that got sourced as empty.

## `HSTS_MAX_AGE_SECONDS`

How long (in seconds) browsers should remember to only use HTTPS for this origin, once they've received the `Strict-Transport-Security` header once over a real HTTPS connection.

- **Default: `15552000` (180 days).**
- HSTS is only ever sent in production (browsers ignore it entirely over plain HTTP, so it's harmless in dev, but suppressed there anyway to avoid training a developer's browser to expect HTTPS on `localhost`).
- `preload` (submission to browsers' built-in HSTS preload list) is **not** enabled by this fix and has no env var - it's a one-way, hard-to-reverse operation (removal from the list can take months). If you want it, opt in deliberately by editing `config/securityHeaders.js`'s `hsts.preload` value, not by env var.

## Content-Security-Policy and Cross-Origin-Resource-Policy

Not env-configurable (app structure, not deployment-specific) - see the comments in `config/securityHeaders.js` for the rationale, summarized here:

- **CSP** allows inline `<style>` (`style-src 'unsafe-inline'`) specifically because `server.js`'s own status page (`GET /`) uses one; every other directive is locked to `'self'`. There is no inline `<script>` anywhere in the app, and `script-src` is **not** relaxed.
- **Cross-Origin-Resource-Policy** is set to `cross-origin` rather than helmet's default `same-origin`. The default would have silently blocked `Inmate_FE` (a different origin) from loading `/uploads` inmate photos via `<img src>`, even though CORS already allows it to fetch the JSON API - CORP is a separate, resource-level check that isn't scoped to the CORS allowlist.

## New dependency

`helmet` was added to `package.json`. **Run `npm install` in `Inmate_BE`** to pick it up (same requirement as `cookie-parser`, added by the JWT-storage fix).
