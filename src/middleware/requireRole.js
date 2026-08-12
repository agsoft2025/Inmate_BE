// Centralized server-side role authorization. Must run AFTER authenticateToken
// (relies on req.user.role, which authToken.js populates from the DB-fetched
// user record - not from an unverified JWT claim). Denies with 403 for any
// role not explicitly allowed for a given route.
const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

const requireRole = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map(normalizeRole);
  return (req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!role || !normalizedAllowed.includes(role)) {
      return res.status(403).json({ success: false, message: "Access denied: insufficient role privileges" });
    }
    next();
  };
};

module.exports = requireRole;
