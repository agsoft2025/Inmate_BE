const express = require('express');
const { createAdminCredential, getAllAdmins, getAdminById, updateAdmin, deleteAdmin, } = require('../controllers/admin.controller');
const router = express.Router();
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

router.post("/", requireSuperAdmin, createAdminCredential);
router.get("/",requireSuperAdmin, getAllAdmins)
router.get("/:id",requireSuperAdmin, getAdminById);
router.put("/:id",requireSuperAdmin, updateAdmin);
router.delete("/:id",requireSuperAdmin, deleteAdmin);
module.exports = router;
