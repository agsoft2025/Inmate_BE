// models/VendorPurchase.js
const mongoose = require("mongoose");

const vendorPurchaseSchema = new mongoose.Schema({
  date:          { type: Date,   required: true },
  invoiceNo:     { type: String, required: true, unique: true },
  vendorName:    { type: String, required: true, trim: true },
  gatePassNumber:{ type: String, required: true, trim: true },
  contact:       { phone: String, email: String, address: String },
  vendorValue:   { type: Number, required: true },
  status:        { type: String, enum: ["Active", "Inactive"], default: "Active" },
  location_id:   { type: mongoose.Schema.Types.ObjectId, ref: "InmateLocation", index: true },
}, { timestamps: true });

module.exports = mongoose.model("VendorPurchase", vendorPurchaseSchema);
