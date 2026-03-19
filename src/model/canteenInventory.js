// models/CanteenInventory.js
const mongoose = require("mongoose");

const canteenInventorySchema = new mongoose.Schema({
  itemNo:       { type: String, required: true, unique: true },
  storeItem:    { type: mongoose.Schema.Types.ObjectId, ref: "StoreInventory", required: true },
  currentStock: { type: Number, default: 0 },   // stock inside canteen
  totalStock:   { type: Number, default: 0 },   // lifetime total received
  status:       { type: String, enum: ["Active", "Inactive"], default: "Active" }
}, { timestamps: true });

module.exports = mongoose.model("CanteenInventory", canteenInventorySchema);
