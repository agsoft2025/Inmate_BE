const { sanitizeValue } = require("../utils/mongoSanitize");

// Applies sanitizeValue() to every JSON request body before any route
// handler sees it. Only req.body is touched - req.query is deliberately
// left alone, for two reasons: (1) this app never overrides Express 5's
// default `'simple'` query parser (see server.js), which can only ever
// produce string/array-of-string values for req.query - a `?field[$ne]=x`
// style payload can't become a nested operator object through it, so the
// operator-injection risk this middleware targets doesn't reach req.query
// in the first place; (2) req.query is a getter-only accessor in Express 5
// (no setter), so it can't be reassigned from middleware even if it needed
// to be. Must be mounted after express.json() (so req.body is already
// parsed) and before any route.
function sanitizeInput() {
  return function (req, res, next) {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeValue(req.body);
    }
    next();
  };
}

module.exports = sanitizeInput;
