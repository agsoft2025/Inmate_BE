const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure upload folder exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Saved files are served back to the browser via the authenticated
// GET /uploads/:filename route (controllers/uploadsController.js), which
// sets the response Content-Type from this record's stored mimetype. The
// on-disk *extension* still matters too though: the extension used to
// previously come straight from the client-supplied original filename
// (`path.extname(file.originalname)`) - a request can set
// `Content-Type: image/jpeg` (satisfying fileFilter below, since it only
// checks the client-controlled mimetype header) while naming the upload
// e.g. "x.html" and sending a <script> payload as the body. The file would
// then be written to disk as "<name>.html", and anything that ever derives
// its Content-Type from the on-disk extension instead of the stored
// mimetype (a misconfigured static mount, a future refactor, a direct
// filesystem browse) would serve it as `text/html`, letting the browser
// parse and execute the attacker-controlled body - a stored XSS. Mapping
// mimetype -> extension here means the extension can only ever be one of
// the three types fileFilter already allows, regardless of what filename or
// extension the client sent - a defense-in-depth backstop, not the primary
// control (that's now the download route trusting the DB-stored mimetype).
const MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9);
    // fileFilter runs before this callback and already rejects anything
    // whose mimetype isn't a key of MIME_EXTENSIONS, so this lookup always
    // hits in practice - the fallback is defensive only, in case that
    // ordering or the filter's allowlist ever changes.
    const ext = MIME_EXTENSIONS[file.mimetype] || ".bin";
    cb(null, uniqueName + ext);
  }
});

// Optional file filter
const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "application/pdf"
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Invalid file type"), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = upload;
