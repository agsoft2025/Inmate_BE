const express = require('express');
const { addInventoryStock, getInventoryStock, getInventoryStockById, updateInventoryProduct,deleteStoreData,deleteInventoryItem,getAllCanteenItem,transferInventoryToCanteenInventory,getCanteenItemListOptions, createCanteenStock,deleteCanteenItem, transferIventoryProduct } = require('../controllers/inventoryController');
const router = express.Router();

router.post('/',addInventoryStock)
router.get('/',getInventoryStock)
router.get('/canteen',getAllCanteenItem)
router.post('/transfer',transferInventoryToCanteenInventory)
router.get('/canteen-item-options',getCanteenItemListOptions)
router.get('/:id',getInventoryStockById)
router.put('/:id',updateInventoryProduct)
router.delete('/item/:id',deleteStoreData)
router.delete('/store/:id',deleteInventoryItem)
router.post('/create-canteen-stock',createCanteenStock)
router.delete('/canteen-item/:id',deleteCanteenItem)
module.exports = router;