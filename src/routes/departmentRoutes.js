const express = require('express');
const { createDepartment, getAllDepartment, getDepartmentById, updateDepartment, deleteDepartment } = require('../controllers/departmentController');
const router = express.Router();

router.post("/create",createDepartment);
router.get("/",getAllDepartment);
router.get("/:id",getDepartmentById);
router.put("/:id",updateDepartment);
router.delete("/:id",deleteDepartment);

module.exports = router;