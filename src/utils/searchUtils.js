// Shared helpers for building safe case-insensitive "contains" search
// filters from free-text query params, used by the list endpoints behind
// the frontend's Unified Smart Search (users, audit logs, transactions).

// Escapes RegExp special characters so user-typed search text (e.g.
// "a+b (test)") is matched literally instead of being interpreted as a
// pattern - prevents both wrong/missing matches and a user typing
// something like "(a+)+" into a search box from turning into a runaway
// regex on the server.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a case-insensitive "contains" RegExp for a trimmed search term, or
// null when the term is empty/whitespace-only - callers should skip adding
// any search filter in that case (no search = don't restrict the query).
function buildSearchRegex(term) {
  const trimmed = String(term ?? "").trim();
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), "i");
}

module.exports = { escapeRegex, buildSearchRegex };
