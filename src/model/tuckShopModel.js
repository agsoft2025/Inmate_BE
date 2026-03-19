const mongoose = require("mongoose");

const tuckSchema = new mongoose.Schema(
  {
    itemName: {type: String,required: true},
    description: {type: String,default: ""},
    price: {type: Number,required: true,min: 0},
    stockQuantity: {type: Number,required: true,min: 0},
    category: {type: String,required: true},
    itemNo:{type:String,required:true,unique: true},
    status:{type:String,required:true}
  },
  { timestamps: true }
);

module.exports = mongoose.model('TuckShop',tuckSchema);