const { default: mongoose } = require("mongoose");
const InmateLocation = require("../model/inmateLocationModel");
const userModel = require("../model/userModel");
const axios = require("axios");
const { syncLocationToGlobal } = require("../service/globaleServer");

exports.addLocation = async (req, res) => {
  try {
    const { name, locationName, custodyLimits, baseUrl } = req.body;

    if (!name || !locationName) {
      return res.status(400).json({
        success: false,
        message: "name and locationName required"
      });
    }

    // 🔒 Ensure admin doesn't already have a location
    const existingUser = await userModel.findById(req.user.id);

    if (existingUser.location_id) {
      return res.status(400).json({
        success: false,
        message: "Admin already has a location"
      });
    }

    const location = await InmateLocation.create({
      name,
      locationName,
      baseUrl,
      custodyLimits,
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    // assign location to admin
    await userModel.findByIdAndUpdate(req.user.id, {
      location_id: location._id
    });

    syncLocationToGlobal(location._id);

    return res.status(201).json({
      success: true,
      message: "Location created successfully",
      data: location
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};





exports.updateLocation = async (req, res) => {
  try {
    const { locationName, custodyLimits, name, baseUrl } = req.body;

    const adminUser = await userModel.findById(req.user.id);

    if (!adminUser || !adminUser.location_id) {
      return res.status(404).json({
        success: false,
        message: "Admin or location not found"
      });
    }

    // 🔒 STRICT CHECK
    const location = await InmateLocation.findOne({
      _id: adminUser.location_id,
      createdBy: req.user.id
    });

    if (!location) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const updateData = { updatedBy: req.user.id };

    if (locationName) updateData.locationName = locationName;
    if (name) updateData.name = name;
    if (baseUrl) updateData.baseUrl = baseUrl;

    if (custodyLimits) {
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

    updateData.globalSyncStatus = "pending";
    updateData.globalSyncError = null;

    const updated = await InmateLocation.findByIdAndUpdate(
      location._id,
      updateData,
      { new: true }
    );

    syncLocationToGlobal(updated._id);

    return res.status(200).json({
      success: true,
      message: "Location updated",
      data: updated
    });

  } catch (error) {
    console.error(error);
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
