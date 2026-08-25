// Central place for the httpOnly JWT auth cookie's name/options, so
// login/logout and the auth middleware never disagree on how the cookie
// was set (a mismatched path/sameSite/secure attribute between the
// `res.cookie(...)` call and the later `res.clearCookie(...)` call would
// silently fail to clear it in some browsers).
const { CSRF_COOKIE_NAME } = require("../middleware/csrf");

const AUTH_COOKIE_NAME = "authToken";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

// All overridable via env var so ops can adjust for the real deployment
// topology without a code change (same pattern as config/rateLimitConfig.js
// and config/mongoSecurity.js elsewhere in this app):
//   AUTH_COOKIE_SECURE   - "true"/"false", defaults to on in production
//                          (browsers silently drop `Secure` cookies over
//                          plain HTTP, so this must be "false" for local
//                          http://localhost dev).
//   AUTH_COOKIE_SAMESITE - "lax" (default), "strict", or "none". "lax" is
//                          correct when the frontend and backend are on the
//                          same site (including sibling subdomains, e.g.
//                          app.example.com calling api.example.com) - which
//                          is the common case and matches this repo's
//                          production origin (agsoftsolutions.co.in). If the
//                          frontend is ever hosted on a genuinely different
//                          site, this must be set to "none" (which in turn
//                          requires AUTH_COOKIE_SECURE=true, since browsers
//                          reject SameSite=None cookies that aren't Secure).
function getAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.AUTH_COOKIE_SECURE
      ? process.env.AUTH_COOKIE_SECURE === "true"
      : isProduction(),
    sameSite: process.env.AUTH_COOKIE_SAMESITE || "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000, // 24h - matches the JWT's own `expiresIn: '24h'`
  };
}

// Same attributes as the auth cookie, minus httpOnly - the frontend must be
// able to read this one (see lib/axios.js) to echo it back as a header.
function getCsrfCookieOptions() {
  const { httpOnly, ...rest } = getAuthCookieOptions();
  return { ...rest, httpOnly: false };
}

// Used by logout to clear both cookies. `res.clearCookie` must be called
// with the same path/sameSite/secure attributes the cookie was originally
// set with, or the browser won't recognize it as the same cookie and won't
// clear it - `maxAge` is intentionally omitted (irrelevant to a clear).
function clearAuthCookies(res) {
  const authOpts = getAuthCookieOptions();
  const csrfOpts = getCsrfCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, {
    path: authOpts.path,
    httpOnly: authOpts.httpOnly,
    secure: authOpts.secure,
    sameSite: authOpts.sameSite,
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    path: csrfOpts.path,
    httpOnly: csrfOpts.httpOnly,
    secure: csrfOpts.secure,
    sameSite: csrfOpts.sameSite,
  });
}

module.exports = {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getCsrfCookieOptions,
  clearAuthCookies,
};
