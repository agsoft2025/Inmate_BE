const express = require('express');
const { getAllLocation, updateLocation, deleteLocation, addLocation } = require('../controllers/inmateLocationController');
const authenticateToken = require('../middleware/authToken');
const router = express.Router();

router.use(authenticateToken)
router.post("/",addLocation)
router.get("/",getAllLocation)
router.put("/:id",updateLocation)
router.delete("/:id",deleteLocation)

module.exports = router;
