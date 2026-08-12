// Shared helpers for safe operational logging.
//
// Use these instead of `console.log(err)` / `console.error(err)` on a raw
// error object, or `console.log(someMongooseDoc)` / `console.log(req.body)`
// on a raw object - any of those can carry a password hash, OTP, JWT, face
// descriptor, Razorpay/WhatsApp credential, HMAC signature, or other PII
// straight into server logs.
//
//   logError(label, err, context) - logs a sanitized {name, message,
//     status, code} shape for the error, plus an explicit, caller-built
//     allowlisted context object - never the raw error, and never a raw
//     req/user/document object as "context".
//   sanitizeError(err) - the sanitizer used above, exported separately for
//     call sites that need to build a custom log line.
//   pick(obj, fields) - allowlists specific fields out of a larger object
//     (a request body, a Mongoose document, a third-party API response)
//     before logging it, so a new sensitive field added to a model/payload
//     later can't silently start appearing in logs the way a full-object
//     dump would.

function sanitizeError(err) {
  if (!err) return err;
  const out = { name: err.name, message: err.message };
  // Axios-style errors carry the full outgoing request in `err.config`
  // (including headers - exactly where an Authorization/Bearer/Basic-auth
  // secret would be) and the full upstream response body in
  // `err.response.data` (which can be another provider's customer/payment
  // records). Keep only the HTTP status code from that, never those.
  if (err.response && typeof err.response.status !== "undefined") {
    out.status = err.response.status;
  }
  if (err.code) out.code = err.code;
  return out;
}

function pick(obj, fields) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const field of fields) {
    if (obj[field] !== undefined) out[field] = obj[field];
  }
  return out;
}

function logError(label, err, context) {
  if (context !== undefined) {
    console.error(label, sanitizeError(err), context);
  } else {
    console.error(label, sanitizeError(err));
  }
}

module.exports = { sanitizeError, pick, logError };
