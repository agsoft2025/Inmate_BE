const path = require("path");
const fs = require("fs");
const InmateFile = require("../model/InmateFile");
const { logError } = require("../utils/safeLog");

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// fileUploadUtils.js's storage engine saves under the literal relative
// directory "uploads", and multer's diskStorage joins that with the
// generated filename via Node's path.join - which uses "/" on POSIX and
// "\\" on Windows. The stored InmateFile.fileUrl therefore reads either
// "uploads/<name>" or "uploads\\<name>" depending on the OS the server ran
// on when the file was uploaded. Matching both keeps lookups correct
// regardless of platform, without needing to touch/re-save older records.
const fileUrlCandidates = (filename) => [`uploads/${filename}`, `uploads\\${filename}`];

// GET /uploads/:filename - replaces the old unauthenticated
// `express.static('/uploads', ...)` mount. That mount served every uploaded
// inmate document/photo to anyone who had (or guessed, shared, or found in
// a browser/proxy history) a URL, with no login and no facility check at
// all - the exact "public bucket" / "no signed URL expiration" failure mode
// this endpoint exists to close. Every request here now has to be
// authenticated (see routes/uploadsRoute.js) and resolve to an InmateFile
// record the caller is actually allowed to see, using the same
// location-scoping (and, for INMATE-role callers, own-record scoping)
// already applied to every other inmate-data endpoint.
exports.downloadUploadedFile = async (req, res) => {
  try {
    // Accept only a bare filename - path.basename() strips any directory
    // component (including a decoded "../", an absolute path, or a
    // URL-encoded "%2F" that Express already decoded into the param before
    // this handler ever ran). Comparing the result back to the raw param
    // rejects anything that had a separator in it instead of silently
    // truncating it, so a manipulated key can't reach outside uploads/.
    const rawName = req.params.filename || "";
    const filename = path.basename(rawName);
    if (!filename || filename !== rawName) {
      return res.status(400).json({ status: false, message: "Invalid file name" });
    }

    // req.locationFilter is set by attachLocationFilter on this route:
    // {} for SUPER ADMIN, {location_id: <caller's facility>} for everyone
    // else. A facility mismatch and a nonexistent file both come back as a
    // plain 404 (never 403) so this endpoint can't be used to probe which
    // filenames exist in another facility.
    const record = await InmateFile.findOne({
      fileUrl: { $in: fileUrlCandidates(filename) },
      ...(req.locationFilter || {}),
    });

    if (!record) {
      return res.status(404).json({ status: false, message: "File not found" });
    }

    // An INMATE-role caller may only ever download attachments on their own
    // inmate record, even within their own facility - the same restriction
    // requireOwnInmateRecordOrStaff already applies to the record endpoints
    // that hand these fileUrls to the frontend in the first place.
    const role = typeof req.user?.role === "string" ? req.user.role.trim().toUpperCase() : "";
    if (role === "INMATE" && record.inmateId !== req.user?.inmateId) {
      return res.status(404).json({ status: false, message: "File not found" });
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ status: false, message: "File not found" });
    }

    // fileType was recorded from the validated multer mimetype at upload
    // time (fix #15), so it's always one of the fixed allowlisted values -
    // safe to echo straight into the response Content-Type header, and more
    // precise than guessing from the on-disk extension.
    if (record.fileType) {
      res.type(record.fileType);
    }
    return res.sendFile(filePath);
  } catch (error) {
    logError("Uploaded file download error:", error);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: "Internal server error" });
    }
  }
};
