const express = require('express');
const router = express.Router();
const {
  createOfficerFeedback,
  getOfficerFeedbackForTransaction,
} = require('../controllers/officerFeedbackController');

// POST /officer-feedback - record Confirm / False Positive / Investigate
router.post('/', createOfficerFeedback);
// GET /officer-feedback/:transactionId - review history for one transaction
router.get('/:transactionId', getOfficerFeedbackForTransaction);

module.exports = router;
