const express = require('express');
const { createInmateMandate, saveMandate } = require('../controllers/InmatePaymentMandateController');
const router = express.Router();

router.post("/",createInmateMandate)
router.post("/save",saveMandate)

module.exports = router;