// Escapes regex metacharacters so user-supplied strings used in $regex
// queries (username lookups, search filters) can't alter the match or
// trigger catastrophic backtracking.
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = escapeRegex;
