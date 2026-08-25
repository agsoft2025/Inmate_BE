const { isHttpsEnforcementEnabled } = require("../config/httpsConfig");

// Redirects plain-HTTP requests to their HTTPS equivalent in production.
// Relies on `req.secure` - Express derives this from the raw connection,
// or, once `trust proxy` is configured (see config/httpsConfig.js), from
// the `X-Forwarded-Proto` header the platform's reverse proxy sets. A
// misconfigured/absent `trust proxy` would make every request look
// insecure and redirect-loop, which is exactly why this is gated by its
// own ENFORCE_HTTPS flag independent of TRUST_PROXY - see that file's
// comments for how to disable either independently if this app is ever
// deployed somewhere this detection doesn't apply.
function enforceHttps() {
  return function (req, res, next) {
    if (!isHttpsEnforcementEnabled()) return next();
    if (req.secure) return next();

    // GET/HEAD are the only methods worth redirecting - a redirected
    // POST/PUT/PATCH/DELETE would need the client to re-send the body,
    // which not every HTTP client does automatically for a 301/302, and
    // an API caller mistakenly using plain HTTP in production is better
    // served by a clear rejection (nothing is silently sent insecurely)
    // than a redirect that may or may not carry the body along.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(400).json({ message: "HTTPS is required." });
    }

    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  };
}

module.exports = enforceHttps;
