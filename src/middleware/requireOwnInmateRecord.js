// For the small number of self-service routes an INMATE-role user is allowed
// to call directly (their own profile, their own transaction history):
// staff (ADMIN/SUPER ADMIN) pass through unrestricted, but an INMATE-role
// caller may only ever request the record matching their own inmateId (the
// route's :id param) - never another inmate's. Must run after both
// authenticateToken and requireRole(...,"INMATE") so req.user is populated.
const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

const requireOwnInmateRecordOrStaff = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (role === "ADMIN" || role === "SUPER ADMIN") {
    return next();
  }
  if (role === "INMATE" && req.user?.inmateId && req.user.inmateId === req.params.id) {
    return next();
  }
  return res.status(403).json({ success: false, message: "Access denied: you may only access your own records" });
};

module.exports = requireOwnInmateRecordOrStaff;
