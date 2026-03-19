const { default: mongoose } = require("mongoose");
const InmateLocation = require("../model/inmateLocationModel");
const UserSchema = require("../model/userModel")
const axios = require("axios");
const { syncLocationToGlobal } = require("../service/globaleServer");

exports.addLocation = async (req, res) => {
  try {
    const { name, locationName, custodyLimits, baseUrl } = req.body;

    if (!name || !locationName)
      return res.status(400).json({ success: false, message: "name and locationName required" });

    const exists = await InmateLocation.findOne();
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Location already configured"
      });
    }

    const location = await InmateLocation.create({
      singleton: true,
      name,
      locationName,
      baseUrl,
      custodyLimits,
      createdBy: req.user.id,
      updatedBy: req.user.id,
      globalSyncStatus: "pending"
    });

    // 🔥 fire-and-forget background sync
    syncLocationToGlobal(location._id);

    return res.status(201).json({
      success: true,
      message: "Location created (global sync in progress)",
      data: location
    });

  } catch (err) {
    console.log("<><>err",err)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Location already exists"
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};





exports.updateLocation = async (req, res) => {
  try {
    const { locationName, custodyLimits, name, baseUrl } = req.body;

    // Only ONE location exists
    const location = await InmateLocation.findOne();
    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not configured"
      });
    }

    const updateData = { updatedBy: req.user.id };

    if (locationName) updateData.locationName = locationName;
    if (name) updateData.name = name;
    if (baseUrl) updateData.baseUrl = baseUrl;

    if (custodyLimits) {
      if (!Array.isArray(custodyLimits) || custodyLimits.length === 0) {
        return res.status(400).json({
          success: false,
          message: "custodyLimits must be a non-empty array"
        });
      }

      const allowed = new Set([
        "remand_prison",
        "under_trail",
        "contempt_of_court"
      ]);

      for (const c of custodyLimits) {
        if (!allowed.has(c.custodyType)) {
          return res.status(400).json({
            success: false,
            message: `Invalid custodyType: ${c.custodyType}`
          });
        }
      }

      updateData.custodyLimits = custodyLimits;
    }

    // 🔑 mark for re-sync
    updateData.globalSyncStatus = "pending";
    updateData.globalSyncError = null;

    const updated = await InmateLocation.findByIdAndUpdate(
      location._id,
      updateData,
      { new: true, runValidators: true }
    );

    // 🔥 async background sync
    syncLocationToGlobal(updated._id);

    return res.status(200).json({
      success: true,
      message: "Location updated (global sync in progress)",
      data: updated
    });

  } catch (error) {
    console.error("LOCAL UPDATE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


exports.getAllLocation = async (req, res) => {
  try {
    const response = await InmateLocation.find().populate({ path: 'createdBy', select: 'fullname' }).populate({ path: 'updatedBy', select: 'fullname' })
    if (!response.length) {
      res.status(404).send({ success: false, data: response, message: "could not find location" })
    }
    res.status(200).send({ success: true, data: response, message: "location fetch successfully" })
  } catch (error) {
    res.status(500).send({ success: false, message: "internal server down" })
  }
}

exports.deleteLocation = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedLocation = await InmateLocation.findByIdAndDelete(id);

    if (!deletedLocation) {
      return res.status(404).json({
        success: false,
        message: "Location not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Location deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Location Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};
