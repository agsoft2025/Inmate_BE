const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const Inmate = require('../model/inmateModel');
const Financial = require('../model/financialModel');
const logAudit = require('../utils/auditlogger');
const Department = require("../model/departmentModel");
const mongoose = require("mongoose");
const { checkTransactionLimit } = require('../utils/inmateTransactionLimiter');
const InmateSchema = require("../model/inmateModel");
const userModel = require('../model/userModel');
const { logError } = require('../utils/safeLog');
const bcrypt = require('bcrypt');
const InmateLocation = require('../model/inmateLocationModel');
const { resolveLocationId, LocationAccessError } = require('../utils/locationAccess');
const { normalizeIndianMobile, isValidIndianMobile } = require('../utils/phoneUtils');
const { supportsTransactions } = require('../utils/dbUtils');
// const { parse } =require('date-fns');

const pickValue = (row, keys = []) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return undefined;
};

const parseDate = (value) => {
  if (!value) return undefined;

  // Handle Excel serial numbers
  if (!isNaN(value)) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  const str = String(value).trim();

  // YYYY-MM-DD (safe)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(str);
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const match = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return new Date(`${yyyy}-${mm}-${dd}`);
  }

  // fallback (last attempt)
  const parsed = new Date(str);
  return isNaN(parsed) ? null : parsed;
};

const normalizeStatus = (value) => {
  const str = String(value || "").trim().toLowerCase();
  if (str === "active") return "Active";
  if (str === "inactive") return "Inactive";
  return value;
};

const bulkUpsertInmates = async (req, res) => {
  const useTx = await supportsTransactions();
  let session = null;
  if (useTx) {
    session = await mongoose.startSession();
    session.startTransaction();
  }
  const sessionOpt = session ? { session } : {};
  let locationId;

  try {
    locationId = await resolveLocationId(req.user, req.body.location_id);
    if (!locationId) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const locationIdString = locationId.toString();

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    /* ---------- Lock location ---------- */
    await InmateLocation.findByIdAndUpdate(
      locationId,
      { $set: { purchaseStatus: "denied" } },
      sessionOpt
    );

    /* ---------- Parse file ---------- */
    let rows = [];
    const ext = req.file.originalname.split(".").pop().toLowerCase();

    if (ext === "csv") {
      rows = parse(req.file.buffer.toString("utf8"), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported file format"
      });
    }

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "Uploaded file contains no data"
      });
    }

    /* ---------- Pre-fetch existing inmateIds & phones ---------- */
    const inmateIds = rows
      .map(r => pickValue(r, ["inmateId", "inmateID", "inmateNumber"]))
      .filter(Boolean);
    const phones = rows
      .map(r => normalizeIndianMobile(pickValue(r, ["phonenumber", "phoneNumber", "phone"])))
      .filter(Boolean);

    const existingInmates = await Inmate.find(
      {
        $or: [
          { inmateId: { $in: inmateIds } },
          { phonenumber: { $in: phones } }
        ]
      },
      { inmateId: 1, phonenumber: 1 },
      sessionOpt
    ).lean();

    const existingInmateIdSet = new Set(
      existingInmates.map(i => i.inmateId)
    );

    const existingPhoneSet = new Set(
      existingInmates.map(i => i.phonenumber)
    );

    const inmateInsertOps = [];
    const usersToCreate = [];
    const results = {
      created: [],
      alreadyExists: [],
      failed: []
    };

    /* ---------- Process rows ---------- */
    rows.forEach((row, index) => {
      const inmateId = pickValue(row, ["inmateId", "inmateID", "inmateNumber"]);
      const firstName = pickValue(row, ["firstName", "firstname"]);
      const lastName = pickValue(row, ["lastName", "lastname"]);
      const phonenumber = pickValue(row, ["phonenumber", "phoneNumber", "phone"]);
      const status = normalizeStatus(pickValue(row, ["status"]));
      const balance = pickValue(row, ["balance"]) ?? 0;
      const cellNumber = pickValue(row, ["cellNumber", "cellNo"]);
      const crimeType = pickValue(row, ["crimeType"]);
      const custodyType = pickValue(row, ["custodyType"]);
      const dateOfBirth = pickValue(row, ["dateOfBirth", "dob"]);
      const admissionDate = pickValue(row, ["admissionDate"]);
      const location_id = pickValue(row, ["location_id", "locationId"]);
      const normalizedPhone = normalizeIndianMobile(phonenumber);

      /* ---- Mandatory fields ---- */
      const requiredFields = {
        inmateId,
        firstName,
        lastName,
        phonenumber,
        status
      };

      const missingFields = Object.entries(requiredFields)
        .filter(([_, v]) => v === undefined || v === null || v === "")
        .map(([k]) => k);

      if (missingFields.length) {
        results.failed.push({
          row: index + 2,
          inmateId: inmateId || "UNKNOWN",
          reason: "Validation failed",
          missingFields
        });
        return;
      }

      /* ---- Phone format ---- */
      if (!isValidIndianMobile(phonenumber)) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Invalid phone number",
          phoneNumber: phonenumber
        });
        return;
      }

      /* ---- Location validation ---- */
      if (location_id && location_id !== locationIdString) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Location mismatch"
        });
        return;
      }

      /* ---- Date validation ---- */
      // const dob = dateOfBirth ? new Date(dateOfBirth) : undefined;
      // const adm = admissionDate ? new Date(admissionDate) : undefined;

      const dob = parseDate(dateOfBirth);
      const adm = parseDate(admissionDate);


      if ((dob && isNaN(dob)) || (adm && isNaN(adm))) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Invalid date format"
        });
        return;
      }

      /* ---- Existing inmateId ---- */
      if (existingInmateIdSet.has(inmateId)) {
        results.alreadyExists.push(inmateId);
        return;
      }

      /* ---- Existing phone number ---- */
      if (existingPhoneSet.has(normalizedPhone)) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Phone number already exists",
          phoneNumber: phonenumber
        });
        return;
      }

      /* ---- Prepare inmate insert ---- */
      inmateInsertOps.push({
        insertOne: {
          document: {
            inmateId,
            firstName,
            lastName,
            phonenumber: normalizedPhone,
            status,
            balance: Number(balance),
            cellNumber,
            crimeType,
            custodyType,
            dateOfBirth: dob,
            admissionDate: adm,
            location_id: locationId
          }
        }
      });

      usersToCreate.push(inmateId);
      results.created.push(inmateId);

      // prevent duplicates within same file
      existingInmateIdSet.add(inmateId);
      existingPhoneSet.add(normalizedPhone);
    });

    /* ---------- Insert inmates ---------- */
    if (inmateInsertOps.length) {
      await Inmate.bulkWrite(inmateInsertOps, sessionOpt);
    }

    /* ---------- Create users ---------- */
    let createdUsers = [];
    if (usersToCreate.length) {
      const usersPayload = await Promise.all(
        usersToCreate.map(async id => ({
          username: id,
          fullname: id,
          inmateId: id,
          password: await bcrypt.hash(id, 10),
          role: "INMATE",
          location_id: locationId
        }))
      );

      createdUsers = await userModel.insertMany(usersPayload, sessionOpt);
    }

    /* ---------- Link user_id back to inmates ---------- */
    if (createdUsers.length) {
      const linkOps = createdUsers.map(u => ({
        updateOne: {
          filter: { inmateId: u.inmateId },
          update: { $set: { user_id: u._id } }
        }
      }));

      await Inmate.bulkWrite(linkOps, sessionOpt);
    }

    /* ---------- Unlock location ---------- */
    await InmateLocation.findByIdAndUpdate(
      locationId,
      { $set: { purchaseStatus: "approved" } },
      sessionOpt
    );

    if (session) await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Bulk inmate import completed",
      results
    });

  } catch (error) {
    logError("Error in bulkUpsertInmates:", error);
    if (session) await session.abortTransaction();
    if (error instanceof LocationAccessError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  } finally {
    if (session) session.endSession();
  }
};

const bulkUpsertFinancial = async (req, res) => {
  let locationId;
  try {
    locationId = await resolveLocationId(req.user, req.body.location);
    if (!locationId) {
      return res.status(400).json({ message: 'Location is required' });
    }

    await InmateLocation.findByIdAndUpdate(
      locationId,
      { $set: { purchaseStatus: "denied" } }
    );

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    let records;

    if (ext === 'csv') {
      const csvString = req.file.buffer.toString('utf-8');
      records = parse(csvString, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter: ','
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      return res.status(400).json({ message: 'Unsupported file format' });
    }

    const results = {
      created: [],
      skipped: [],
      failed: []
    };

    for (const entry of records) {
      let {
        inmateId,
        custodyType,
        wageAmount,
        hoursWorked,
        transaction = "WEEKLY",
        workAssignId,
        type = "wages"
      } = entry;

      if (!inmateId || !custodyType || !type || !wageAmount || !hoursWorked || !transaction || !workAssignId) {
        results.failed.push({ inmateId, reason: 'Missing required fields' });
        continue;
      }

      const Departments = await Department.find({
        "name": workAssignId
      });

      if (!Departments.length) {
        results.failed.push({ inmateId, reason: 'Missing department', workAssignId });
        continue;
      }

      const inmateData = await Inmate.findOne({ inmateId }).populate("location_id");
      if (!inmateData || !inmateData.location_id) {
        results.failed.push({ inmateId, reason: "Inmate or location missing" });
        continue;
      }
      const locationId = inmateData.location_id._id || inmateData.location_id;
      const checkLimit = await checkTransactionLimit(inmateId, parseInt(wageAmount), type, locationId);
      if (!checkLimit.status) {
        results.failed.push({ inmateId, reason: checkLimit.message, workAssignId });
        continue;
      }

      workAssignId = new mongoose.Types.ObjectId(Departments[0]._id);

      try {
        const wage = parseInt(wageAmount || 0);
        if (!wage || isNaN(wage)) {
          results.skipped.push(inmateId);
          continue;
        } else {
          const newEntry = new Financial({
            inmateId,
            transaction,
            workAssignId,
            hoursWorked: parseInt(hoursWorked || 0),
            wageAmount: wage,
            type,
            status: "ACTIVE",
            custodyType
            , location_id: locationId
          });

          await newEntry.save();
          if (wage > 0) {
            const inmate = await Inmate.findOne({ inmateId });
            if (inmate) {
              inmate.balance += wage;
              inmate.custodyType = custodyType;
              await inmate.save();
            } else {
              results.failed.push({ inmateId, reason: 'Inmate not found for balance update' });
              continue;
            }
          }
          results.created.push(inmateId);
        }
      } catch (err) {
        results.failed.push({ inmateId, reason: 'Save failed', error: err.message, custodyType });
      }
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'BULK_UPSERT',
      targetModel: 'Financial',
      targetId: null,
      description: `Bulk upsert of wages performed. Created: ${results.created.length}, Updated: ${results.skipped.length}, Failed: ${results.failed.length}`,
      changes: results
    });
    res.status(200).json({
      success: true,
      message: 'Bulk financial operation completed',
      results
    });
  } catch (err) {
    if (err instanceof LocationAccessError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  } finally {
    if (locationId) {
      await InmateLocation.findByIdAndUpdate(locationId, { $set: { purchaseStatus: "approved" } });
    }
  }
};

module.exports = { bulkUpsertInmates, bulkUpsertFinancial };
