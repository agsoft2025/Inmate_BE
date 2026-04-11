const express = require('express');
const { intimateBalanceReport, transactionSummaryReport, tuckShopSalesReport, wageDistributionReport, quickStatistics, inventoryStockHistoryReport } = require('../controllers/reportController');
const { attachLocationFilter } = require('../utils/locationAccess');
const router = express.Router();

router.get("/quick-statistics", attachLocationFilter, quickStatistics);
router.post("/intimate-balance-report", attachLocationFilter, intimateBalanceReport);
router.post("/transaction-summary-report", attachLocationFilter, transactionSummaryReport);
router.post("/tuckshop-sales-report", attachLocationFilter, tuckShopSalesReport);
router.post("/wage-distribution-report", attachLocationFilter, wageDistributionReport);
router.post("/inventory-report", attachLocationFilter, inventoryStockHistoryReport);

module.exports = router;
