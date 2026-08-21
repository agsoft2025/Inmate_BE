const express = require('express');
const { createAdminCredential, getAllAdmins, getAdminById, updateAdmin, deleteAdmin, getLocationsForAdmin } = require('../controllers/admin.controller');
const router = express.Router();
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

router.get("/locations", requireSuperAdmin, getLocationsForAdmin);
router.post("/", requireSuperAdmin, createAdminCredential);
router.get("/",requireSuperAdmin, getAllAdmins)
router.get("/:id",requireSuperAdmin, getAdminById);
router.put("/:id",requireSuperAdmin, updateAdmin);
router.delete("/:id",requireSuperAdmin, deleteAdmin);
module.exports = router;
