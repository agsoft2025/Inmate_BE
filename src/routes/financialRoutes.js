const express = require('express');
const { createFinancial, getFinancial, getFinancialID, updateFinancial, searchFinancial, deleteFinancial, downloadWagesCSV } = require('../controllers/financialControllers');
const router = express.Router();

router.post("/create",createFinancial);
router.get('/',getFinancial);
router.get('/wages/download-csv/:id',downloadWagesCSV);
router.get('/search',searchFinancial);
router.get('/:id',getFinancialID);
router.put('/:id',updateFinancial);
router.delete('/:id',deleteFinancial);

module.exports = router;