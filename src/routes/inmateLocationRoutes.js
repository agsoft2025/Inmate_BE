const express = require('express');
const { getAllLocation, updateLocation, deleteLocation, addLocation } = require('../controllers/inmateLocationController');
const authenticateToken = require('../middleware/authToken');
const requireRole = require('../middleware/requireRole');
const router = express.Router();

router.use(authenticateToken)
// GET is intentionally left open to any authenticated role - every session
// (ADMIN, SUPER ADMIN, POS, INMATE) loads the facility/location list on
// login (LocationContext), so restricting it would break every non-admin
// session. Only managing locations themselves is staff-only.
router.post("/", requireRole("ADMIN", "SUPER ADMIN"), addLocation)
router.get("/",getAllLocation)
router.put("/:id", requireRole("ADMIN", "SUPER ADMIN"), updateLocation)
router.delete("/:id", requireRole("ADMIN", "SUPER ADMIN"), deleteLocation)

module.exports = router;
