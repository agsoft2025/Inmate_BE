const express = require("express")
const { fileUploadController } = require("../controllers/inmateFileController")
const upload = require("../utils/fileUploadUtils")
const router = express()

router.post("/",upload.fields([{ name: 'files', maxCount: 10 },{ name: 'pro_pic', maxCount: 1 }]),fileUploadController)

module.exports = router