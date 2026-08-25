const { default: mongoose } = require("mongoose");
const InmateLocation = require("../model/inmateLocationModel");
const userModel = require("../model/userModel");
const axios = require("axios");
const { syncLocationToGlobal } = require("../service/globaleServer");
const { logError } = require("../utils/safeLog");

exports.addLocation = async (req, res) => {
  try {
    const { name, locationName, custodyLimits, baseUrl, razorpay } = req.body;

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
      razorpay: {
        keyId: razorpay?.keyId || "",
        keySecret: razorpay?.keySecret || "",
        webhookSecret: razorpay?.webhookSecret || "",
        accountNumber: razorpay?.accountNumber || "",
        isActive: razorpay?.isActive || false
      },
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
    logError("addLocation error:", err);
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
    if (req.body.razorpay) {
      updateData.razorpay = {
        ...location.razorpay?.toObject(),
        ...req.body.razorpay
      };
    }

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
    logError("updateLocation error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getAllLocation = async (req, res) => {
  try {
    const userData = await userModel.findById(req.user.id);
    if (!userData) {
      return res.status(404).send({ success: false, message: "User not found" });
    }
    const response = await InmateLocation.find({ _id: userData.location_id }).populate({ path: 'createdBy', select: 'fullname' }).populate({ path: 'updatedBy', select: 'fullname' })
    // Previously this fell through to a SECOND res.send() below even after
    // already sending a 404 here - Express/Node throws "Cannot set headers
    // after they are sent to the client" the moment that second send runs,
    // which is always true for a SUPER ADMIN (no location_id, so the query
    // above always returns []) and for anyone whose location was deleted.
    // The crash happens after this response was already written (so this
    // particular request's caller does get a real reply), but Express's
    // default error handler reacts to the later, now-uncatchable error by
    // destroying the underlying socket - which, on a kept-alive connection,
    // can drop whatever OTHER request the browser has queued/sent on that
    // same connection right around the same time. That's what was actually
    // producing the "CORS error" on /dashboard and /inmate when they load
    // alongside this call - not a CORS misconfiguration.
    if (!response.length) {
      return res.status(404).send({ success: false, data: response, message: "could not find location" })
    }
    return res.status(200).send({ success: true, data: response, message: "location fetch successfully" })
  } catch (error) {
    return res.status(500).send({ success: false, message: "internal server down" })
  }
}

exports.deleteLocation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid location ID format",
      });
    }

    // 🔒 STRICT CHECK - same ownership rule as updateLocation: an admin may
    // only ever delete the single location they created and are assigned
    // to, never an arbitrary :id supplied by the client.
    const adminUser = await userModel.findById(req.user.id);

    if (!adminUser || !adminUser.location_id) {
      return res.status(404).json({
        success: false,
        message: "Admin or location not found"
      });
    }

    if (String(adminUser.location_id) !== String(id)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const deletedLocation = await InmateLocation.findOneAndDelete({
      _id: adminUser.location_id,
      createdBy: req.user.id
    });

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
    logError("Delete Location Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};
