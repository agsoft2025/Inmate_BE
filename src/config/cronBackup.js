const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const backupLocationModel = require('../model/backupLocationModel');
const { getMongoConnectionOptions, redactMongoUri } = require('./mongoSecurity');

let currentJob = null; // store reference to currently scheduled cron job

async function backupDatabase() {
  try {
    // 1️⃣ Fetch client-defined backup path from DB
    const backupDoc = await backupLocationModel.findOne().lean();
    let backupBaseDir = backupDoc?.path;

    // 2️⃣ Validate path exists and writable
    if (!backupBaseDir) {
      console.warn('⚠️ No backup path defined. Using default folder inside server.');
      backupBaseDir = path.join(__dirname, '..', '..', 'public', 'backup');
    } else {
      try {
        fs.accessSync(backupBaseDir, fs.constants.W_OK);
      } catch (err) {
        console.warn(`⚠️ Cannot write to user-defined path "${backupBaseDir}". Using default folder inside server.`);
        backupBaseDir = path.join(__dirname, '..', '..', 'public', 'backup');
      }
    }

    // 3️⃣ Create date-stamped backup folder
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupFolder = path.join(backupBaseDir, `backup-${timestamp}`);
    fs.mkdirSync(backupFolder, { recursive: true });

    // 4️⃣ Connect to MongoDB (same auth/TLS options as the main app connection -
    // see config/mongoSecurity.js / docs/mongodb_security_migration.md)
    const client = new MongoClient(process.env.DB_MONGO_URL, getMongoConnectionOptions());
    await client.connect();
    const db = client.db();

    // 5️⃣ Backup each collection to JSON
    const collections = await db.listCollections().toArray();
    for (const { name } of collections) {
      const docs = await db.collection(name).find().toArray();
      const filePath = path.join(backupFolder, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
      console.log(`✅ Saved collection ${name}`);
    }

    console.log(`🎉 Backup completed successfully: ${backupFolder}`);
    await client.close();
  } catch (err) {
    // redactMongoUri strips any embedded credentials in case the driver
    // ever includes the connection string in an error message.
    console.error('❌ Backup failed:', redactMongoUri(err.message));
  }
}

// 6️⃣ Schedule cron job dynamically from DB
async function scheduleBackup() {
  const scheduleDoc = await backupLocationModel.findOne().lean();

  if (!scheduleDoc || !scheduleDoc.enabled) {
    console.log("⚠️ Backup is disabled in DB.");
    return;
  }

  const cronTime = scheduleDoc.cronTime;
  console.log(`⏱ Scheduling backup at cron time: ${cronTime}`);

  // Stop previous job if exists
  if (currentJob) currentJob.destroy();

  // Schedule new job
  currentJob = cron.schedule(cronTime, backupDatabase);
}

// 7️⃣ Optional: Watch for changes in DB to reschedule
async function rescheduleBackupOnUpdate() {
  let lastCron = null;
  let lastEnabled = null;

  // Check every minute (or any interval you prefer)
  setInterval(async () => {
    try {
      const doc = await backupLocationModel.findOne().lean();
      if (!doc) return;

      const { cronTime, enabled } = doc;

      // If cron time or enabled flag changes, re-schedule
      if (cronTime !== lastCron || enabled !== lastEnabled) {
        lastCron = cronTime;
        lastEnabled = enabled;
        console.log('🔄 Backup schedule changed in DB. Rescheduling...');
        await scheduleBackup();
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, 60_000);
}

module.exports = { scheduleBackup, rescheduleBackupOnUpdate, backupDatabase };






// const cron = require('node-cron');
// const fs = require('fs');
// const path = require('path');
// const { MongoClient } = require('mongodb');
// const backupLocationModel = require('../model/backupLocationModel');

// const scheduleBackup = () => {
//   // Run every day at 12:00 AM (adjust cron as needed)
//   cron.schedule('26 21 * * *', async () => {
//     console.log('⏳ Starting MongoDB JSON backup...');

//     try {
//       // 1️⃣ Fetch client-defined backup path from DB
//       let backupDoc = await backupLocationModel.findOne().lean();
//       let backupBaseDir = backupDoc?.path;

//       // 2️⃣ Validate path exists and writable
//       if (!backupBaseDir) {
//         console.warn('⚠️ No backup path defined. Using default folder inside server.');
//         backupBaseDir = path.join(__dirname, '..', '..', 'public', 'backup');
//       } else {
//         try {
//           fs.accessSync(backupBaseDir, fs.constants.W_OK);
//         } catch (err) {
//           console.warn(
//             `⚠️ Cannot write to user-defined path "${backupBaseDir}". Using default folder inside server.`
//           );
//           backupBaseDir = path.join(__dirname, '..', '..', 'public', 'backup');
//         }
//       }

//       // 3️⃣ Create date-stamped backup folder
//       const timestamp = new Date().toISOString().replace(/:/g, '-');
//       const backupFolder = path.join(backupBaseDir, `backup-${timestamp}`);
//       fs.mkdirSync(backupFolder, { recursive: true });

//       // 4️⃣ Connect to MongoDB
//       const client = new MongoClient(process.env.DB_MONGO_URL);
//       await client.connect();
//       const db = client.db();

//       // 5️⃣ Backup each collection to JSON
//       const collections = await db.listCollections().toArray();
//       for (const { name } of collections) {
//         const docs = await db.collection(name).find().toArray();
//         const filePath = path.join(backupFolder, `${name}.json`);
//         fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
//         console.log(`✅ Saved collection ${name}`);
//       }

//       console.log(`🎉 Backup completed successfully: ${backupFolder}`);
//       await client.close();
//     } catch (err) {
//       console.error('❌ Backup failed:', err.message);
//     }
//   });
// };

// module.exports = { scheduleBackup };
