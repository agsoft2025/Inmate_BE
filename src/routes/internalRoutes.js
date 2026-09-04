const express = require("express");
const { provisionLocationAdmin } = require("../controllers/internalController");
const verifyInternalService = require("../middleware/verifyInternalService");
const router = express.Router();

router.use(verifyInternalService);

router.post("/provision-location", provisionLocationAdmin);

module.exports = router;
