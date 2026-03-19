// models/InmateFile.js
const mongoose = require("mongoose");

const inmateFileSchema = new mongoose.Schema(
  {
    fileUrl: {
      type: String,
      required: true
    },
    fileType: {
      type: String
    },
    remarks: {
      type: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InmateFile", inmateFileSchema);
