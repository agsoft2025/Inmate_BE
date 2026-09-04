// Location records are owned by the Global Server / Super Admin. A logged-in
// Local Admin (role "ADMIN") may VIEW their assigned location but must not
// create, edit, deactivate or reassign it — those actions are performed from
// the Global panel and reach this server via /internal (service key) instead.
// Runs after authenticateToken, so req.user is populated.
const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

const blockLocalAdminLocationWrite = (req, res, next) => {
  if (normalizeRole(req.user?.role) === "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Location changes are managed by the Super Admin.",
    });
  }
  next();
};

module.exports = blockLocalAdminLocationWrite;
