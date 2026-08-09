const express = require('express');
const router = express.Router();
const { getTransactionsByRange, getTransactionsByRangeMobile, getFlaggedTransactions } = require('../controllers/transactionController');

// GET /api/transactions?range=daily|weekly|monthly|yearly
router.get('/', getTransactionsByRange);
router.get('/device', getTransactionsByRangeMobile);
// GET /transactions/flagged?days=7&limit=5 - top flagged transactions for the Dashboard panel
router.get('/flagged', getFlaggedTransactions);

module.exports = router;