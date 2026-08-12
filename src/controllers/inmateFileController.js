const fs = require("fs");
const InmateFile = require("../model/InmateFile");
const Inmate = require("../model/inmateModel");
const { requireLocationFilter, LocationAccessError } = require("../utils/locationAccess");
const { logError } = require("../utils/safeLog");

// Resolves the caller's authorized location scope the same way the rest of
// the codebase does (req.locationFilter, set by the attachLocationFilter
// route middleware, with a defensive fallback if it's ever missing).
const getLocationFilterOrAbort = (req, res) => {
  try {
    return req.locationFilter ?? requireLocationFilter(req.user);
  } catch (error) {
    if (error instanceof LocationAccessError) {
      res.status(error.status).json({ status: false, message: error.message });
      return null;
    }
    throw error;
  }
};

// multer has already written these to disk by the time the controller runs;
// remove them if we end up rejecting the request so rejected uploads don't
// pile up on disk with no owning record.
const cleanupUploadedFiles = (filesObj) => {
  if (!filesObj) return;
  const allFiles = [...(filesObj.files || []), ...(filesObj.pro_pic || [])];
  for (const file of allFiles) {
    if (file?.path) {
      fs.unlink(file.path, () => {});
    }
  }
};

const uploadInmateFiles = async ({ filesObj, remarks, inmateId, location_id, uploadedBy }) => {
  const savedFiles = [];

  try {
    // multiple files
    if (filesObj.files) {
      for (const file of filesObj.files) {
        const doc = await InmateFile.create({
          fileUrl: file.path,
          fileType: file.mimetype,
          remarks,
          inmateId,
          location_id,
          uploadedBy
        });
        savedFiles.push(doc);
      }
    }

    // profile picture
    if (filesObj.pro_pic && filesObj.pro_pic[0]) {
      const file = filesObj.pro_pic[0];
      const doc = await InmateFile.create({
        fileUrl: file.path,
        fileType: file.mimetype,
        remarks: "Profile picture",
        inmateId,
        location_id,
        uploadedBy
      });
      savedFiles.push(doc);
    }

    return {
      status: true,
      message: "Files uploaded successfully",
      data: savedFiles
    };
  } catch (error) {
    return {
      status: false,
      message: `Upload failed (${error.message})`
    };
  }
};

exports.fileUploadController = async (req, res) => {
  try {
    const { inmateId, remarks } = req.body;

    if (!inmateId || !inmateId.trim()) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({
        status: false,
        message: "inmateId is required"
      });
    }

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) {
      cleanupUploadedFiles(req.files);
      return;
    }

    // Resolve the client-supplied inmateId against the caller's own
    // authorized location scope instead of trusting it directly. A user
    // cannot upload files against an inmateId belonging to another
    // facility - the lookup simply won't match and we return 404.
    const inmate = await Inmate.findOne({
      inmateId: inmateId.trim(),
      ...locationFilter
    }).select("_id inmateId location_id");

    if (!inmate) {
      cleanupUploadedFiles(req.files);
      return res.status(404).json({
        status: false,
        message: "Inmate not found"
      });
    }

    const result = await uploadInmateFiles({
      filesObj: req.files,
      remarks,
      inmateId: inmate.inmateId,
      location_id: inmate.location_id,
      uploadedBy: req.user?.id
    });

    if (!result.status) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json(result);
    }

    return res.status(201).json(result);

  } catch (error) {
    logError("File upload controller error:", error);
    cleanupUploadedFiles(req.files);
    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
};
