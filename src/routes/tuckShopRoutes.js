const express = require('express');
const { createTuckShop, getAllTucks, searchTuckItems, getTuckShopItemById, updateTuckShopItem, deleteTuckShopItem } = require('../controllers/tuckShopController');
const requireRole = require('../middleware/requireRole');
const router = express.Router();

// Item catalog is readable by whoever can sell from it (POS) as well as staff.
router.get("/search", requireRole("ADMIN", "SUPER ADMIN", "POS"), searchTuckItems);
router.get("/", requireRole("ADMIN", "SUPER ADMIN", "POS"), getAllTucks);
router.get("/:id", requireRole("ADMIN", "SUPER ADMIN", "POS"), getTuckShopItemById);

// Managing the catalog itself (pricing, stock, add/remove items) - staff only.
router.post("/create", requireRole("ADMIN", "SUPER ADMIN"), createTuckShop);
router.put("/:id", requireRole("ADMIN", "SUPER ADMIN"), updateTuckShopItem);
router.delete("/:id", requireRole("ADMIN", "SUPER ADMIN"), deleteTuckShopItem);

module.exports = router;