const mongoose = require("mongoose");

const POSShoppingCartSchema = new mongoose.Schema(
  {
    inmateId: { type: String, required: true, trim: true },
    totalAmount: { type: Number, default: 0 },
    is_reversed:{type:Boolean, default:false},
    products: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "TuckShop", required: true },
        quantity: { type: Number, required: true, min: 1 }
      }
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.model('POSShoppingCart',POSShoppingCartSchema);