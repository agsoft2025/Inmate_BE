const mongoose = require("mongoose");

const inmateSchema = new mongoose.Schema(
  {
    inmateId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50
    },

    phonenumber: {
      type: String,
      required: true,
      unique: true,
      match: /^[6-9]\d{9}$/, // Indian mobile validation
      index: true
    },

    status: {
      type: String,
      enum: ["Active", "On Bail", "On Parole", "Released","Transfer"],
      default: "Active",
      index: true
    },

    custodyType: {
      type: String,
      enum: ["remand_prison", "under_trail", "contempt_of_court","parole"],
      index: true
    },

    crimeType: {
      type: String
      // enum: [
      //   "THEFT",
      //   "ASSAULT",
      //   "FRAUD",
      //   "CYBER_CRIME",
      //   "MURDER",
      //   "NARCOTICS",
      //   "OTHER"
      // ]
    },

    cellNumber: {
      type: String,
      trim: true
    },

    balance: {
      type: Number,
      default: 0,
      min: 0
    },

    isBlocked: {
      type: Boolean,
      default: false,
      index: true
    },

    blockedReason: {
      type: String,
      trim: true
    },

    dateOfBirth: {
      type: Date,
      validate: {
        validator: function (v) {
          return v < new Date();
        },
        message: "Date of birth must be in the past"
      }
    },

    admissionDate: {
      type: Date,
      default: Date.now,
      index: true
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },

    location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InmateLocation",
      required: true,
      index: true
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },

    deletedAt: {
      type: Date
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

/* Compound indexes for real-world queries */
inmateSchema.index({ location_id: 1, status: 1 });
inmateSchema.index({ custodyType: 1, isBlocked: 1 });

/* Soft delete helper */
inmateSchema.methods.softDelete = function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

module.exports = mongoose.model("Inmate", inmateSchema);
