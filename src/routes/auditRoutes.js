// routes/auditRoutes.js
const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditController');
const { attachLocationFilter } = require('../utils/locationAccess');

router.get('/', attachLocationFilter, getAuditLogs);

module.exports = router;
