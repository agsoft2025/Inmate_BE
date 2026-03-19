const mongoose = require("mongoose");

const paymentLogSchema = new mongoose.Schema({
  inmateId: String,
  mandateId: String,
  orderId: String,
  paymentId: String,
  amount: Number,
  status: String,
  response: Object,
  customerId:String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("PaymentLog", paymentLogSchema);
