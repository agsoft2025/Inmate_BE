const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const backupLocationModel = require("../model/backupLocationModel");
const { redactMongoUri } = require("../config/mongoSecurity");

async function backupDatabase() {
  try {
    const backupDoc = await backupLocationModel.findOne().lean();
    let backupDir = backupDoc?.path || path.join(__dirname, "..", "public", "backups");

    backupDir = path.resolve(backupDir);

    const dateStamp = new Date().toISOString().split("T")[0];
    const backupPath = path.join(backupDir, `backup-${dateStamp}`);

    if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true });

    // No hardcoded connection string / database name here - the same
    // env-sourced connection info the rest of the app uses (DB_MONGO_URL),
    // or an optional dedicated least-privilege backup credential
    // (DB_MONGO_BACKUP_URI), so this never silently points at an
    // unauthenticated local database. See docs/mongodb_security_migration.md.
    const mongoUri = process.env.DB_MONGO_BACKUP_URI || process.env.DB_MONGO_URL;
    if (!mongoUri) {
      console.error("Backup failed: DB_MONGO_URL (or DB_MONGO_BACKUP_URI) is not set.");
      return;
    }

    const cmd = `mongodump --uri="${mongoUri}" --out="${backupPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        // redactMongoUri strips any embedded credentials, since exec()
        // error messages can echo back the failing command line.
        console.error("Backup failed:", redactMongoUri(err.message));
      } else {
        console.log(`✅ Backup completed: ${backupPath}`);
      }
    });
  } catch (error) {
    console.error("Error fetching backup location:", error.message);
  }
}

module.exports = backupDatabase;
