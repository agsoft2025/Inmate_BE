const InmateLocation = require("../model/inmateLocationModel");

// custodyLimits has a `validate: v => v.length > 0` on the model, so a location
// can't be created with an empty array. Seed the three custody types with zero
// limits (same shape the local LocationDialog sends) — the Super Admin can tune
// them later from the Global panel.
const DEFAULT_CUSTODY_LIMITS = [
  { custodyType: "remand_prison", spendLimit: 0, depositLimit: 0 },
  { custodyType: "under_trail", spendLimit: 0, depositLimit: 0 },
  { custodyType: "contempt_of_court", spendLimit: 0, depositLimit: 0 },
];

// Called only by InmateGlobalServer_BE (via verifyInternalService) when a Super
// Admin creates a location from the Global panel. It only mirrors the location
// down to this local server (keyed by globalLocationId, idempotent) so the
// facility shows up in the "Add Admin" dropdown. No admin account is created
// here anymore — the Super Admin attaches admins afterwards from the Admin
// screen.
const provisionLocationAdmin = async (req, res) => {
  const { name, locationName, baseUrl = "", global_location_id } = req.body;

  if (!name || !locationName || !global_location_id) {
    return res.status(400).json({
      success: false,
      message: "name, locationName and global_location_id are required",
    });
  }

  try {
    const location = await InmateLocation.findOneAndUpdate(
      { globalLocationId: global_location_id },
      {
        $set: {
          name,
          locationName: locationName.trim(),
          baseUrl,
          globalSyncStatus: "success",
          globalSyncError: null,
        },
        $setOnInsert: {
          globalLocationId: global_location_id,
          custodyLimits: DEFAULT_CUSTODY_LIMITS,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      data: { locationId: location._id },
    });
  } catch (error) {
    console.error("provisionLocationAdmin (location sync) error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync location",
      error: error.message,
    });
  }
};

module.exports = { provisionLocationAdmin };
