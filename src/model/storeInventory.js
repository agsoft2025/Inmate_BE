const mongoose = require("mongoose");

const storeInventorySchema = new mongoose.Schema({
  vendorPurchase: { type: mongoose.Schema.Types.ObjectId, ref: "VendorPurchase" },
  itemName:       { type: String, required: true },      // e.g. Britannia Biscuit
  itemNo:         { type: String, required: true },      // e.g. ITM001
  amount:         { type: Number },                     // total cost for this item batch
  stock:          { type: Number, required: true },     // current store stock
  sellingPrice:   { type: Number, required: true },     // price to canteen
  category:       { type: String },                     // optional (Snacks, Soap…)
  status:         { type: String, enum: ["Active", "Inactive"], default: "Active" },
  location_id:    { type: mongoose.Schema.Types.ObjectId, ref: "InmateLocation", index: true },
}, { timestamps: true });

storeInventorySchema.index({ location_id: 1, itemNo: 1 }, { unique: true });

module.exports = mongoose.model("StoreInventory", storeInventorySchema);
