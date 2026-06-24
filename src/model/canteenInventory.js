// models/CanteenInventory.js
const mongoose = require("mongoose");

const canteenInventorySchema = new mongoose.Schema({
  itemNo:       { type: String, required: true },
  storeItem:    { type: mongoose.Schema.Types.ObjectId, ref: "StoreInventory", required: true },
  currentStock: { type: Number, default: 0 },   // stock inside canteen
  totalStock:   { type: Number, default: 0 },   // lifetime total received
  status:       { type: String, enum: ["Active", "Inactive"], default: "Active" },
  location_id:  { type: mongoose.Schema.Types.ObjectId, ref: "InmateLocation", index: true }
}, { timestamps: true });

canteenInventorySchema.index({ location_id: 1, itemNo: 1 }, { unique: true });

module.exports = mongoose.model("CanteenInventory", canteenInventorySchema);
