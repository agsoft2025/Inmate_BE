// Shared helpers for connecting to MongoDB securely (authentication + TLS)
// and for never leaking connection-string credentials into logs.
//
// All secrets (usernames/passwords) continue to live only in DB_MONGO_URL
// (loaded from the environment / secret manager - never hardcoded here).
// This module adds the pieces needed to run that connection over TLS and
// to detect + warn/refuse when a connection is configured insecurely.
//
// See docs/mongodb_security_migration.md for the full list of env vars and
// step-by-step instructions for enabling auth + TLS on the actual MongoDB
// deployment.

const CREDENTIALS_PATTERN = /(mongodb(?:\+srv)?:\/\/)([^@/\s]+)@/gi;

/**
 * Replaces any embedded "user:password@" in a Mongo connection string (or
 * any free-text error message that happens to contain one) with a redacted
 * placeholder, so it is safe to print to logs/console.
 */
function redactMongoUri(text) {
  if (!text) return text;
  return String(text).replace(CREDENTIALS_PATTERN, "$1***:***@");
}

function envFlag(name) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

/**
 * Builds the mongoose/MongoClient connection-options object purely from
 * environment variables. Every key is OPTIONAL and omitted entirely when
 * unset, so existing non-TLS local-dev setups keep working unchanged -
 * TLS/auth hardening is opt-in via env config, never hardcoded here.
 *
 * Recognized env vars (all optional):
 *   DB_MONGO_TLS_ENABLED                    - "true" to require TLS
 *   DB_MONGO_TLS_CA_FILE                     - path to the CA certificate
 *   DB_MONGO_TLS_CERT_KEY_FILE               - path to a client cert+key (mutual TLS / x.509 auth)
 *   DB_MONGO_TLS_CERT_KEY_FILE_PASSWORD      - passphrase for the above, if any
 *   DB_MONGO_TLS_ALLOW_INVALID_CERTIFICATES  - "true" to skip cert validation (never use in production)
 *   DB_MONGO_TLS_ALLOW_INVALID_HOSTNAMES     - "true" to skip hostname validation (never use in production)
 *   DB_MONGO_AUTH_SOURCE                     - authSource, if not already embedded in DB_MONGO_URL
 */
function getMongoConnectionOptions() {
  const options = {};

  if (envFlag("DB_MONGO_TLS_ENABLED")) {
    options.tls = true;
  }
  if (process.env.DB_MONGO_TLS_CA_FILE) {
    options.tlsCAFile = process.env.DB_MONGO_TLS_CA_FILE;
  }
  if (process.env.DB_MONGO_TLS_CERT_KEY_FILE) {
    options.tlsCertificateKeyFile = process.env.DB_MONGO_TLS_CERT_KEY_FILE;
  }
  if (process.env.DB_MONGO_TLS_CERT_KEY_FILE_PASSWORD) {
    options.tlsCertificateKeyFilePassword = process.env.DB_MONGO_TLS_CERT_KEY_FILE_PASSWORD;
  }
  // Secure by default: these are only ever set (to true) when the operator
  // explicitly opts in - there is no code path that turns them on silently.
  if (envFlag("DB_MONGO_TLS_ALLOW_INVALID_CERTIFICATES")) {
    options.tlsAllowInvalidCertificates = true;
  }
  if (envFlag("DB_MONGO_TLS_ALLOW_INVALID_HOSTNAMES")) {
    options.tlsAllowInvalidHostnames = true;
  }
  if (process.env.DB_MONGO_AUTH_SOURCE) {
    options.authSource = process.env.DB_MONGO_AUTH_SOURCE;
  }

  return options;
}

/**
 * Checks whether a Mongo connection string + the current env config looks
 * like a secured (authenticated + encrypted) connection. This is a
 * best-effort heuristic used only to warn/block on obviously-insecure
 * configuration (e.g. the historical "mongodb://127.0.0.1:27017/db" with no
 * credentials and no TLS) - it does not replace verifying the real server
 * config server-side.
 */
function assertSecureMongoConfig(uri) {
  const reasons = [];

  if (!uri) {
    reasons.push("DB_MONGO_URL is not set");
    return { ok: false, reasons };
  }

  const hasCredentials = /mongodb(?:\+srv)?:\/\/[^@/\s]+@/i.test(uri);
  if (!hasCredentials) {
    reasons.push(
      "DB_MONGO_URL has no embedded username/password - MongoDB authentication does not appear to be configured"
    );
  }

  const tlsEnabledViaEnv = envFlag("DB_MONGO_TLS_ENABLED");
  const tlsEnabledViaUri = /[?&](tls|ssl)=true/i.test(uri);
  if (!tlsEnabledViaEnv && !tlsEnabledViaUri) {
    reasons.push(
      "TLS is not enabled - set DB_MONGO_TLS_ENABLED=true (or add tls=true to DB_MONGO_URL) once the server supports it"
    );
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = { redactMongoUri, getMongoConnectionOptions, assertSecureMongoConfig };
