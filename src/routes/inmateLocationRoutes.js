const express = require('express');
const { getAllLocation, updateLocation, deleteLocation, addLocation } = require('../controllers/inmateLocationController');
const authenticateToken = require('../middleware/authToken');
const blockLocalAdminLocationWrite = require('../middleware/blockLocalAdminLocationWrite');
const router = express.Router();

router.use(authenticateToken)
router.get("/",getAllLocation)
// Writes are Super-Admin-only; a Local Admin can only view their assigned location.
router.post("/", blockLocalAdminLocationWrite, addLocation)
router.put("/:id", blockLocalAdminLocationWrite, updateLocation)
router.delete("/:id", blockLocalAdminLocationWrite, deleteLocation)

module.exports = router;
