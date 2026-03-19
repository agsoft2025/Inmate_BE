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
const bcrypt = require('bcrypt');
const InmateLocation = require('../model/inmateLocationModel');
// const { parse } =require('date-fns');

const bulkUpsertInmates = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const locationId = req.body.location_id;

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
      { session }
    );

    /* ---------- Parse file ---------- */
    let rows = [];
    const ext = req.file.originalname.split(".").pop().toLowerCase();

    if (ext === "csv") {
      rows = parse(req.file.buffer.toString("utf8"), {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } else if (ext === "xlsx") {
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
    const inmateIds = rows.map(r => r.inmateId).filter(Boolean);
    const phones = rows.map(r => r.phonenumber).filter(Boolean);

    const existingInmates = await Inmate.find(
      {
        $or: [
          { inmateId: { $in: inmateIds } },
          { phonenumber: { $in: phones } }
        ]
      },
      { inmateId: 1, phonenumber: 1 },
      { session }
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
      const {
        inmateId,
        firstName,
        lastName,
        phonenumber,
        status,
        balance = 0,
        cellNumber,
        crimeType,
        custodyType,
        dateOfBirth,
        admissionDate,
        location_id
      } = row;

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
      if (!/^[6-9]\d{9}$/.test(phonenumber)) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Invalid phone number",
          phoneNumber: phonenumber
        });
        return;
      }

      /* ---- Location validation ---- */
      if (location_id && location_id !== locationId) {
        results.failed.push({
          row: index + 2,
          inmateId,
          reason: "Location mismatch"
        });
        return;
      }

      /* ---- Date validation ---- */
      const dob = dateOfBirth ? new Date(dateOfBirth) : undefined;
      const adm = admissionDate ? new Date(admissionDate) : undefined;

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
      if (existingPhoneSet.has(phonenumber)) {
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
            phonenumber,
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
      existingPhoneSet.add(phonenumber);
    });

    /* ---------- Insert inmates ---------- */
    if (inmateInsertOps.length) {
      await Inmate.bulkWrite(inmateInsertOps, { session });
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

      createdUsers = await userModel.insertMany(usersPayload, { session });
    }

    /* ---------- Link user_id back to inmates ---------- */
    if (createdUsers.length) {
      const linkOps = createdUsers.map(u => ({
        updateOne: {
          filter: { inmateId: u.inmateId },
          update: { $set: { user_id: u._id } }
        }
      }));

      await Inmate.bulkWrite(linkOps, { session });
    }

    /* ---------- Unlock location ---------- */
    await InmateLocation.findByIdAndUpdate(
      locationId,
      { $set: { purchaseStatus: "approved" } },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Bulk inmate import completed",
      results
    });

  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

const bulkUpsertFinancial = async (req, res) => {
  try {
    await InmateLocation.findByIdAndUpdate(req.body.location, { $set: { purchaseStatus: "denied" } }).then(async (_d) => {
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
          delimiter: ','
        });
      } else if (ext === 'xlsx') {
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
        const checkLimit = await checkTransactionLimit(inmateId, parseInt(wageAmount), type)
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



    })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  } finally {
    await InmateLocation.findByIdAndUpdate(req.body.location, { $set: { purchaseStatus: "approved" } })
  }
};

module.exports = { bulkUpsertInmates, bulkUpsertFinancial };
