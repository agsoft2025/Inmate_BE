const mongoose = require("mongoose");

const inmatePaymentMandateSchema = new mongoose.Schema({
  inmateId: { type: String, required: true, unique: true },
  customerId: { type: String, required: true },
  mandateId: { type: String, required: true },
  maxAmount: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("InmatePaymentMandate", inmatePaymentMandateSchema);
