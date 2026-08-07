const express = require('express');
const router = express.Router();
const { getDashboardData, sendLowBalanceOutreach } = require('../controllers/dashboardController');
const { attachLocationFilter } = require('../utils/locationAccess');

router.get('/', attachLocationFilter, getDashboardData);
router.post('/outreach', attachLocationFilter, sendLowBalanceOutreach);

module.exports = router;
