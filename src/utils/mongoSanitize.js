// Strips any object key that could act as a MongoDB query/update operator
// (`$ne`, `$gt`, `$where`, `$rename`, ...) or a dot-notation field path
// (`a.b`) out of client-supplied JSON, recursively. Used as a blanket
// defense-in-depth layer (see middleware/sanitizeInput.js) ahead of every
// route - on top of, not instead of, the per-endpoint type checks and
// findOneAndUpdate() field allowlists elsewhere in this codebase. This
// catches anything a future endpoint forgets to guard explicitly, and
// specifically closes off the case where an entire request body (with no
// intervening field allowlist) is passed straight through as a Mongoose
// filter or update document: MongoDB's update command accepts either a
// plain "set these fields" document OR a document made entirely of atomic
// operators like `$inc`/`$rename`/`$unset`/`$currentDate` - if the client
// controls the whole body, they control which of those two shapes it is.
//
// Why this is safe to apply globally: nothing in this app's request
// payloads legitimately needs a key starting with "$" or containing "." -
// field names throughout are plain camelCase/snake_case identifiers
// (inmateId, totalAmount, location_id, ...).
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (isPlainObject(value)) {
    // Object.create(null) - not `{}` - so a malicious "__proto__" key
    // becomes a harmless own data property on `out` instead of reaching
    // the inherited Object.prototype.__proto__ accessor and actually
    // repointing this object's prototype (the classic recursive-clone
    // prototype-pollution gotcha you'd otherwise reintroduce here).
    const out = Object.create(null);
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || key.includes(".") || key === "__proto__") {
        continue;
      }
      out[key] = sanitizeValue(value[key]);
    }
    return out;
  }
  return value;
}

module.exports = { sanitizeValue, isPlainObject };
