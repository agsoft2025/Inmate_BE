const globalServiceClient = require("../utils/globalServiceClient");
const InmateLocation = require("../model/inmateLocationModel");

const syncLocationToGlobal = async (locationId) => {
  try {
    console.log("<><>global server");
    
    const location = await InmateLocation.findById(locationId);
    if (!location) return;

    const payload = {
      externalId: locationId,
      name: location.name,
      location: location.locationName,
      baseUrl: location.baseUrl
    };

    const res = await globalServiceClient.post("/api/location", payload);
    console.log("<><>res",res.data);
    

    await InmateLocation.updateOne(
      { _id: locationId },
      {
        globalLocationId: res.data._id,
        globalSyncStatus: "success",
        globalSyncError: null
      }
    );

  } catch (err) {
    await InmateLocation.updateOne(
      { _id: locationId },
      {
        globalSyncStatus: "failed",
        globalSyncError: err.message
      }
    );
  }
};


module.exports = {
    syncLocationToGlobal
}