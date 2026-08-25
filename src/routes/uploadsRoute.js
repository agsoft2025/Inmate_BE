const express = require("express");
const { downloadUploadedFile } = require("../controllers/uploadsController");

const router = express.Router();

router.get("/:filename", downloadUploadedFile);

module.exports = router;
