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
    },
    inmateId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InmateLocation",
      required: true,
      index: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InmateFile", inmateFileSchema);
