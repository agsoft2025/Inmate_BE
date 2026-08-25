const { isProduction } = require("./httpsConfig");

// Options passed to `helmet()` in server.js. Helmet's own defaults are a
// reasonable, broadly-compatible baseline (X-Content-Type-Options:
// nosniff, Referrer-Policy: no-referrer, X-Frame-Options via
// frame-ancestors 'self', X-DNS-Prefetch-Control, etc., all left as-is) -
// only the two directives below are actually app-specific and worth
// overriding:
//
//   - Content-Security-Policy: helmet's default `style-src 'self'` would
//     block the inline <style> block server.js's own status page (`GET /`)
//     renders. That page is static, server-authored HTML with no user
//     input and no inline *script* anywhere in the app, so allowing inline
//     styles specifically (not scripts) is a narrow, low-risk
//     accommodation rather than a blanket 'unsafe-inline'. Every other
//     directive stays at helmet's 'self'-only default, which is correct
//     for this app: it's a JSON API (CSP has no effect on JSON responses -
//     it only matters for content a browser renders/executes) plus this
//     one static status page and a `/uploads` static-file mount (images/
//     PDFs only, per fix #3's multer config) - nothing here legitimately
//     needs to load a script, style, or frame from any other origin.
//   - Cross-Origin-Resource-Policy: helmet's default (`same-origin`) blocks
//     any cross-origin `<img>`/`<script>`-style load of a resource, even
//     one CORS would otherwise allow - unlike CORS, it isn't scoped to the
//     allowlist in server.js, it's all-or-nothing. This app's `/uploads`
//     static mount serves inmate photos that `Inmate_FE` (a different
//     origin - see server.js's CORS allowlist) legitimately loads via
//     `<img src>`; the JSON API responses are likewise meant to be read
//     cross-origin by that same frontend (and the mobile app). Since
//     nothing this app serves is meant to be origin-restricted at the
//     resource level - that access control is already CORS's job for
//     fetch/XHR, and there's no session/cookie-bearing resource here that
//     CORP would meaningfully protect beyond what CORS already does - this
//     is set to `cross-origin` app-wide rather than left at the default,
//     which would silently have broken every inmate-photo `<img>` tag in
//     the frontend.
//   - Strict-Transport-Security (HSTS): only sent in production. Browsers
//     already ignore this header entirely when received over plain HTTP,
//     so sending it in dev would be harmless, but suppressing it there
//     avoids any chance of a locally-run instance training a developer's
//     browser to expect HTTPS on localhost. `preload` is deliberately left
//     off - submitting to the browser vendors' HSTS preload list is a
//     one-way, hard-to-reverse operation the operator should opt into
//     deliberately (by editing this file), not something this fix should
//     silently switch on. `max-age` defaults to 180 days and is
//     overridable via HSTS_MAX_AGE_SECONDS without a code change.
function getHelmetOptions() {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: isProduction()
      ? {
          maxAge: Number(process.env.HSTS_MAX_AGE_SECONDS) || 15552000, // 180 days
          includeSubDomains: true,
          preload: false,
        }
      : false,
  };
}

module.exports = { getHelmetOptions };
