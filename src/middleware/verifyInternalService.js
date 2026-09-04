// Gate for endpoints that only the trusted Global server should call
// (server-to-server, no end-user session involved). Mirrors the
// x-internal-service-key check InmateGlobalServer_BE uses for the reverse
// direction in verifyLocationAccess.js.
const verifyInternalService = (req, res, next) => {
  const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
  const serviceKey = req.headers["x-internal-service-key"];

  if (!internalServiceKey || serviceKey !== internalServiceKey) {
    return res.status(403).json({ success: false, message: "Forbidden: trusted service access required" });
  }

  next();
};

module.exports = verifyInternalService;
