const express = require('express');
const { createUser, createAdminCredential, getAllUsers, getUserById, deleteUser, updateUserById, defaultUser, faceRecongition, faceRecongitionMatch, deleteFaceRecognitionRecord } = require('../controllers/usersController');
const router = express.Router();
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const authenticateToken = require('../middleware/authToken');

router.post("/admin/create", requireSuperAdmin, createAdminCredential);
router.use(authenticateToken)
router.post("/create",createUser);
router.get("/",getAllUsers);
router.post("/register",faceRecongition)
router.delete("/delete/:id",deleteFaceRecognitionRecord)
router.post("/match",faceRecongitionMatch)
router.get("/:id",getUserById);
router.put("/:id",updateUserById);
router.delete("/:id",deleteUser);

module.exports = router;
