// Central place for HTTPS-enforcement / reverse-proxy trust settings.
//
// This app is deployed on Render.com (confirmed via BASE_URL/GLOBAL_URL in
// .env), which terminates TLS at its own edge and forwards requests to
// this app over plain HTTP through exactly one reverse-proxy hop, setting
// `X-Forwarded-Proto`/`X-Forwarded-For` on the way in. Express needs to be
// told to trust that one hop (`trust proxy`) for `req.secure`/`req.ip` to
// reflect the real client connection instead of the internal proxy - see
// https://expressjs.com/en/guide/behind-proxies.html. `trust proxy: true`
// (trust an unlimited number of hops) is deliberately NOT used here even
// in production, since that would let a client forge its own
// `X-Forwarded-For` and spoof its IP straight past the rate limiter
// (fix #8) - `1` trusts exactly the platform's own proxy and no further.
//
// All of this is overridable via env vars so a different deployment
// topology (no reverse proxy at all, multiple proxy hops, or one this
// session couldn't directly verify) doesn't get a bad default baked in:
//   TRUST_PROXY   - "false" to disable entirely (req.ip/req.secure reflect
//                   the raw socket connection only - the correct setting
//                   for a directly-exposed deployment with no reverse
//                   proxy in front), a number of hops to trust ("1", "2",
//                   ...), or unset to use the default below.
//   ENFORCE_HTTPS - "false" to disable the HTTP->HTTPS redirect
//                   (middleware/enforceHttps.js) even in production - e.g.
//                   if TLS is terminated somewhere this app can't detect
//                   via X-Forwarded-Proto. Defaults to "true" in
//                   production, "false" otherwise.

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getTrustProxySetting() {
  if (process.env.TRUST_PROXY !== undefined) {
    if (process.env.TRUST_PROXY === "false") return false;
    const n = Number(process.env.TRUST_PROXY);
    return Number.isFinite(n) ? n : process.env.TRUST_PROXY;
  }
  // Default: trust exactly one reverse-proxy hop in production (Render's
  // edge), trust nothing in dev/test (plain local HTTP, no proxy).
  return isProduction() ? 1 : false;
}

function isHttpsEnforcementEnabled() {
  if (process.env.ENFORCE_HTTPS !== undefined) {
    return process.env.ENFORCE_HTTPS === "true";
  }
  return isProduction();
}

module.exports = { isProduction, getTrustProxySetting, isHttpsEnforcementEnabled };
