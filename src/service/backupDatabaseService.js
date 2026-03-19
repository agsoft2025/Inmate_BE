const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const backupLocationModel = require("../model/backupLocationModel");

async function backupDatabase() {
  try {
    const backupDoc = await backupLocationModel.findOne().lean();
    let backupDir = backupDoc?.path || path.join(__dirname, "..", "public", "backups");

    backupDir = path.resolve(backupDir);

    const dateStamp = new Date().toISOString().split("T")[0];
    const backupPath = path.join(backupDir, `backup-${dateStamp}`);

    if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true });

    const cmd = `mongodump --uri="mongodb://localhost:27017/Inmate-dev" --out="${backupPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("Backup failed:", err.message);
      } else {
        console.log(`✅ Backup completed: ${backupPath}`);
      }
    });
  } catch (error) {
    console.error("Error fetching backup location:", error.message);
  }
}

module.exports = backupDatabase;
