const express = require("express")
const router = express.Router()
const { addBackupLocation } = require("../controllers/backupController")

router.post("/",addBackupLocation)

module.exports = router
