const crypto = require("crypto");

// Shared constants for the double-submit CSRF cookie used alongside the
// httpOnly auth cookie (see config/authCookies.js and authController.js's
// login/logout, and middleware/authToken.js which enforces this on every
// cookie-authenticated state-changing request).
const CSRF_COOKIE_NAME = "csrfToken";
const CSRF_HEADER_NAME = "x-csrf-token";

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generateCsrfToken };
