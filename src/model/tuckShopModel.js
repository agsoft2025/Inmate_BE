const mongoose = require("mongoose");

const tuckSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    stockQuantity: { type: Number, required: true, min: 0 },
    category: { type: String, required: true },
    itemNo: { type: String, required: true },
    status: { type: String, required: true },
    location_id: { type: mongoose.Schema.Types.ObjectId, ref: "InmateLocation", index: true },
  },
  { timestamps: true }
);

const tuckShopIndex = { itemNo: 1, location_id: 1 };
tuckSchema.index(tuckShopIndex, { unique: true });

module.exports = mongoose.model("TuckShop", tuckSchema);
