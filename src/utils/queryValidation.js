// Shared helpers for validating/normalizing client-supplied query/body
// values before they reach a Mongoose filter, sort spec, or aggregation
// pipeline. See utils/mongoSanitize.js for the companion request-body
// operator-stripping middleware - these helpers cover the two things that
// middleware doesn't: rejecting a non-string identifier outright (rather
// than letting it fall through as an empty object), and restricting a
// client-controlled *field name* (not just its value) to a known-safe set.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// A client-supplied sort field is used as a dynamic object key
// (`{ [sortField]: order }` / `{ $sort: { [sortField]: order } }`), so
// without an allowlist the client controls which field/path the database
// sorts by - at minimum an unindexed-field sort (resource-exhaustion
// angle), and it removes any dependency on a particular query-parser
// configuration continuing to keep that key a harmless string. Returns
// `fallback` for anything not on the allowlist rather than erroring, since
// an unrecognized sort field isn't a request that should fail outright -
// it should just fall back to the default order.
function allowlistSortField(rawValue, allowedFields, fallback) {
  return typeof rawValue === "string" && allowedFields.includes(rawValue)
    ? rawValue
    : fallback;
}

module.exports = { isNonEmptyString, allowlistSortField };
