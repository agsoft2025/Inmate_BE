const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../controllers/dashboardController');
const { attachLocationFilter } = require('../utils/locationAccess');

router.get('/', attachLocationFilter, getDashboardData);

module.exports = router;
