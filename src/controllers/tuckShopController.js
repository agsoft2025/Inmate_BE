const TuckShopSchema = require("../model/tuckShopModel");
const UserSchema = require("../model/userModel");
const mongoose = require("mongoose");
const logAudit = require("../utils/auditlogger");

const createTuckShop = async (req, res) => {
  const adminAccess = await UserSchema.findById(req.user.id);
  if(!adminAccess.location_id){
      return res.status(404).send({success:false,message:"please add location"})
    }
  if (adminAccess.role === "ADMIN") {
    try {
      const { itemName, description, price, stockQuantity,itemNo, category,status } = req.body;
      if((category === "recharge") && (price > 500)){
        return res.status(400).send({success:false,message: "Recharge failed: the amount must be ₹500 or less."})
      }

      if (!itemName || price == null || stockQuantity == null || !itemNo || !category) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const isItem = await TuckShopSchema.findOne({itemNo:itemNo})
      if(isItem){
        return res.status(403).send({success:false,message:`item number ${itemNo} already existing`})
      }

      const existingItem = await TuckShopSchema.findOne({ itemName, price,itemNo });

      if (existingItem) {
        // Update existing item's stock
        existingItem.stockQuantity += stockQuantity;
        const updatedItem = await existingItem.save();

        await logAudit({
          userId: req.user.id,
          username: req.user.username,
          action: 'UPDATE_STOCK',
          targetModel: 'TuckShop',
          targetId: updatedItem._id,
          description: `Updated stock for item "${updatedItem.itemName}". New quantity: ${updatedItem.stockQuantity}`,
          changes: {
            stockQuantity: updatedItem.stockQuantity
          }
        });

        return res.status(200).json({ success: true, data: updatedItem, message: "Stock updated successfully" });
      }

      const newItem = new TuckShopSchema({ itemName, description, price, stockQuantity, category,itemNo,status });
      const savedItem = await newItem.save();

      await logAudit({
        userId: req.user.id,
        username: req.user.username,
        action: 'CREATE',
        targetModel: 'TuckShop',
        targetId: savedItem._id,
        description: `Created new tuck shop item "${savedItem.itemName}" in category "${savedItem.category}"`,
        changes: {
          itemName: savedItem.itemName,
          description: savedItem.description,
          price: savedItem.price,
          stockQuantity: savedItem.stockQuantity,
          category: savedItem.category
        }
      });
      res.status(201).json({ success: true, data: savedItem, message: "Item created successfully" })
    } catch (error) {
      res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
  } else {
    res.status(400).json({ success: false, message: "Admin can only able to add inventory" });
  }
}

const getAllTucks = async (req, res) => {
  try {
    const items = await TuckShopSchema.find().sort({ createdAt: -1 });
    if (!items) {
      return res.status(404).json({ success: false, message: "No data found" });
    }
    res.status(200).json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const getTuckShopItemById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const item = await TuckShopSchema.findById(id);
    if (!item) {
      return res.status(404).json({ message: "No item found" });
    }

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const updateTuckShopItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updateBody = req.body;
if((req.body.category === "recharge") && (req.body.price > 500)){
        return res.status(400).send({success:false,message: "Recharge failed: the amount must be ₹500 or less."})
      }
    if (!id) {
      return res.status(400).json({ message: "ID is missing" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const updatedItem = await TuckShopSchema.findByIdAndUpdate(
      id,
      updateBody,
      { new: true, runValidators: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ message: "No item found" });
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE',
      targetModel: 'TuckShop',
      targetId: updatedItem._id,
      description: `Updated tuck shop item "${updatedItem.itemName}"`,
      changes: updateBody
    });

    res.status(200).json({ success: true, data: updatedItem, message: "TuckShop item updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const deleteTuckShopItem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const deletedItem = await TuckShopSchema.findByIdAndDelete(id);
    if (!deletedItem) {
      return res.status(404).json({ message: "No item found to delete" });
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      targetModel: 'TuckShop',
      targetId: deletedItem._id,
      description: `Deleted tuck shop item "${deletedItem.itemName}"`,
      changes: deletedItem
    });

    res.status(200).json({ success: true, message: "TuckShop item deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};


const searchTuckItems = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "Search query is required" });
    }

    const regex = new RegExp(query, 'i');

    const results = await TuckShopSchema.find({
      $or: [
        { itemName: regex },
        { category: regex }
      ]
    }).sort({createdAt:-1})

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

module.exports = { createTuckShop, getAllTucks, getTuckShopItemById, updateTuckShopItem, deleteTuckShopItem, searchTuckItems };