const express = require('express');
const inmatePayment = require("../controllers/paymentController")
const router = express.Router();

// wallet add
router.post("/create",inmatePayment.inmateCreatePayment)
router.post("/verify",inmatePayment.inmateVerifyPayment)

// global server (subscription add)
router.post("/subscribe/create",inmatePayment.createOrder)
router.post("/subscribe/verify",inmatePayment.verifyPayment)

module.exports = router;