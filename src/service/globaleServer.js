const { default: axios } = require("axios");
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

    const url = `${process.env.GLOBAL_URL}/api/location`
    console.log("<><>url",url)
    const res = await axios.post(
      `${url}`,
      payload,
      { timeout: 5000 }
    );
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