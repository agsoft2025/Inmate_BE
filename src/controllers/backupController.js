const backupLocationModel = require("../model/backupLocationModel");

exports.addBackupLocation = async (req, res) => {
  try {
    const { path, cronTime, time, enabled } = req.body;

    // ✅ 1. Validate and parse inputs
    if (!time) {
      return res.status(400).send({ success: false, message: "time is required (e.g. '10:00 AM')" });
    }

    // cronTime is like "1 hour" or "2" → extract the first number for interval hours
    const intervalHours = parseInt(String(cronTime).match(/\d+/)?.[0], 10);
    if (!intervalHours || intervalHours < 1) {
      return res.status(400).send({
        success: false,
        message: "cronTime must contain a positive number of hours (e.g. '1 hour')",
      });
    }

    // ✅ 2. Build cron expression: e.g. "0 10-23/1 * * *"
    const cronExpr = buildCronExpr({ time, intervalHours });

    // ✅ 3. Insert or update the single backup location doc
    const existing = await backupLocationModel.findOne();
    if (existing) {
      await backupLocationModel.updateOne(
        {},
        {
          $set: {
            path,
            cronTime: cronExpr,
            time,
            enabled,
            updatedBy: req.user.id,
          },
        }
      );
      return res.send({
        success: true,
        data: { ...existing.toObject(), cronTime: cronExpr },
        message: "Backup location updated successfully",
      });
    }

    const created = await backupLocationModel.create({
      path,
      cronTime: cronExpr,
      time,
      enabled,
      updatedBy: req.user.id,
    });

    return res.send({
      success: true,
      data: created,
      message: "Backup location added successfully",
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Convert a time like "10:00 AM" and an interval in hours
 * into a valid node-cron expression, e.g. "0 10-23/1 * * *"
 */
function buildCronExpr({ time, intervalHours }) {
  // Split "10:00 AM" into ["10:00", "AM"]
  const [hhmm, ampm] = time.trim().split(" ");
  let [hour, minute] = hhmm.split(":").map(Number);

  // Convert to 24-hour format
  if (ampm.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;

  // Cron syntax: minute hour-range/step day month day-of-week
  // Example: "0 10-23/1 * * *" = every hour on the hour starting at 10:00
  return `${minute} ${hour}-23/${intervalHours} * * *`;
}

    