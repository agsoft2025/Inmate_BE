const mongoose = require("mongoose");

const inmateTransactionSchema = new mongoose.Schema({
  inmate_id: {
    type: String,        
    required: true
  },

  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  order_id: {
    type: String,
    required: true
  },

  payment_id: {
    type: String
  },

  amount: {
    type: Number,
    required: true
  },

  status: {
    type: String,
    enum: ["created", "paid", "failed"],
    default: "created"
  },

  payment_mode: {
    type: String,
    default: "razorpay"
  }

}, { timestamps: true });

module.exports = mongoose.model("InmateTransaction", inmateTransactionSchema);
