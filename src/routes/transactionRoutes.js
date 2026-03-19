const express = require('express');
const router = express.Router();
const { getTransactionsByRange, getTransactionsByRangeMobile } = require('../controllers/transactionController');

// GET /api/transactions?range=daily|weekly|monthly|yearly
router.get('/', getTransactionsByRange);
router.get('/device', getTransactionsByRangeMobile);

module.exports = router;