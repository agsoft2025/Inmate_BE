const express = require('express');
const { createTuckShop, getAllTucks, searchTuckItems, getTuckShopItemById, updateTuckShopItem, deleteTuckShopItem } = require('../controllers/tuckShopController');
const router = express.Router();

router.post("/create",createTuckShop);
router.get("/search",searchTuckItems);
router.get("/",getAllTucks);
router.get("/:id",getTuckShopItemById);
router.put("/:id",updateTuckShopItem);
router.delete("/:id",deleteTuckShopItem);

module.exports = router;