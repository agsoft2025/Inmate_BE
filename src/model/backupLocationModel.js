// models/Location.js
const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
  path: { type: String, required: true },
  updatedBy: { type: String },  
  cronTime: { type: String, required: true },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("backuplocation", locationSchema);
