// routes/auditRoutes.js
const express = require('express');
const { bulkUpsertInmates, bulkUpsertFinancial } = require('../controllers/bulkOperationController');
const upload = require('../middleware/upload');
const router = express.Router();

router.post('/inmates', upload.single('file'), bulkUpsertInmates);
router.post('/wages', upload.single('file'), bulkUpsertFinancial);

module.exports = router;
