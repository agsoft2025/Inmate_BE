const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Central place for every rate limit's window/ceiling. Every value is
// overridable via an environment variable so a deployment can tune limits
// (e.g. a facility running many shared POS terminals behind one NAT IP
// needing a higher ceiling) without a code change. Defaults are
// deliberately generous relative to normal usage patterns in this app
// while still bounding abuse - see security_fixes_log.md fix #8 for the
// reasoning behind each tier.
module.exports = {
  // Broad, IP-only protection shared by every login-adjacent route
  // (password login, face login, mobile/OTP login, OTP verification) -
  // bounds raw request flooding and credential-stuffing spread across many
  // accounts from one source.
  authIp: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_AUTH_IP_MAX, 20),
  },
  // Stricter, per-target-account protection on POST /user/login
  // specifically (keyed by IP + the username/face-id being attempted) -
  // this is what actually stops a sustained brute force against one
  // account, since the broad IP ceiling above alone would still allow many
  // attempts against a single username as long as they're spread out under
  // it.
  authAccount: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_AUTH_ACCOUNT_MAX, 8),
  },
  // PUT /users/:id doubles as the only password-change path in this app
  // (oldPassword/newPassword) - there is no separate "forgot password"
  // endpoint. Wired up with a `skip` predicate so only requests that
  // actually attempt a password change are counted; ordinary profile
  // edits (name/role/location/face) are unaffected.
  passwordChange: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_PASSWORD_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_PASSWORD_MAX, 10),
  },
  // /payment/* and /mandate/* (Razorpay order create/verify and auto-debit
  // mandate setup) - authenticated, so keyed by caller id.
  payment: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_PAYMENT_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_PAYMENT_MAX, 30),
  },
  // POST /file (inmate file/photo upload) - authenticated, keyed by caller id.
  upload: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_UPLOAD_MAX, 20),
  },
  // Lenient, app-wide safety net applied to every request ahead of all the
  // route-specific limiters above.
  global: {
    windowMs: toPositiveInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS, 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_GLOBAL_MAX, 300),
  },
};
