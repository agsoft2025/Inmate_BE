const FinancialSchema = require("../model/financialModel");
const InmateSchema = require("../model/inmateModel");
const mongoose = require("mongoose");
const logAudit = require("../utils/auditlogger");
const { Parser } = require('json2csv');
const { checkTransactionLimit } = require("../utils/inmateTransactionLimiter");
const inmateModel = require("../model/inmateModel");
const departmentModel = require("../model/departmentModel");
const InmateFile = require("../model/InmateFile");

const downloadWagesCSV = async (req, res) => {
  try {
    const inmateData = await inmateModel.find()
    const departmentsData = await departmentModel.find()
    if (!departmentsData.length) {
      return res.status(404).json({ message: 'No departments found. Please create at least one department.' });
    }
    if (!inmateData || inmateData.length === 0) {
      return res.status(404).json({ message: 'No wage records found to export' });
    }
    const formattedData = inmateData.map(inmate => ({
      inmateId: inmate.inmateId,
      custodyType: inmate.custodyType,
      wageAmount: 0, hoursWorked: 0,
      transaction: "WEEKLY",
      workAssignId: departmentsData[0].name,
      type: "wages"
    }))

    const fields = [
      'inmateId',
      'custodyType',
      'wageAmount',
      'hoursWorked',
      'transaction',
      'workAssignId',
      'type'
    ];


    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedData);

    res.setHeader('Content-Disposition', 'attachment; filename=wages.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).end(csv);
  } catch (err) {
    res.status(500).json({ message: 'Failed to export wages CSV', error: err.message });
  }
};



// const createFinancial = async (req, res) => {
//   try {
//     const { inmateId, workAssignId, hoursWorked, wageAmount, transaction,
//       depositName, status, relationShipId, type, depositAmount } = req.body;
//     const depositLim = await checkTransactionLimit(inmateId, type === "wages" ? wageAmount : depositAmount, type);

//     if (!depositLim.status) {
//       return res.status(400).send({ success: false, message: depositLim.message });
//     }

//     if (type == 'wages') {

//       if (!inmateId || !workAssignId || !hoursWorked || !wageAmount || !type || !transaction) {
//         return res.status(400).json({ message: "Missing required fields" });
//       }
//     } else if (type == 'deposit') {
//       if (!inmateId || !depositName || !type || !depositAmount || !relationShipId) {
//         return res.status(400).json({ message: "Missing required fields" });
//       }
//     } else {
//       return res.status(400).json({ message: "Type is missing or incorrect" });
//     }

//     const inmate = await InmateSchema.findOne({ inmateId });
//     if (!inmate) {
//       return res.status(404).json({ message: "Inmate not found" });
//     }

//     let amountToAdd = 0;
//     if (type === 'wages') {
//       amountToAdd = wageAmount || 0;
//     } else if (type === 'deposit') {
//       amountToAdd = depositAmount || 0;
//     }

//     inmate.balance += amountToAdd;
//     await inmate.save();

//     const financial = new FinancialSchema({
//       inmateId,
//       custodyType: inmate.custodyType,
//       workAssignId,
//       hoursWorked,
//       wageAmount,
//       transaction,
//       status,
//       type,
//       relationShipId,
//       depositAmount,
//       depositName
//     });

//     const savedFinancial = await financial.save();
//     await logAudit({
//       userId: req.user.id,
//       username: req.user.username,
//       action: 'CREATE',
//       targetModel: 'Financial',
//       targetId: savedFinancial._id,
//       description: `Created ${type} record for inmate ${inmateId}`,
//       changes: { ...req.body, custodyType: inmate.custodyType }
//     });

//     res.status(201).json({ success: true, data: savedFinancial, message: "Financial " + type + " successfully created" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: "Internal server error", error: error.message });
//   }
// };
const createFinancial = async (req, res) => {
  try {
    const { inmateId, workAssignId, hoursWorked, wageAmount, transaction,
      depositType, status, relationShipId, type, depositAmount, remarks, fileIds = [] } = req.body;
    if (fileIds.length > 0) {
      const validFiles = await InmateFile.countDocuments({
        _id: { $in: fileIds }
      });
console.log("<><>",validFiles,fileIds.length);

      if (validFiles !== fileIds.length) {
        return res.status(400).json({
          success: false,
          message: "One or more attached files are invalid"
        });
      }
    }
    const depositLim = await checkTransactionLimit(inmateId, type === "wages" ? wageAmount : depositAmount, type);

    if (!depositLim.status) {
      return res.status(400).send({ success: false, message: depositLim.message });
    }

    if (type == 'wages') {

      if (!inmateId || !workAssignId || !hoursWorked || !wageAmount || !type || !transaction) {
        return res.status(400).json({ message: "Missing required fields" });
      }
    } else if (type == 'deposit') {
      if (!inmateId || !depositType || !type || !depositAmount || !relationShipId) {
        return res.status(400).json({ message: "Missing required fields" });
      }
    } else if (type == 'withdrawal') {
      if (!inmateId || !depositType || !type || !depositAmount || !relationShipId) {
        return res.status(400).json({ message: "Missing required fields" });
      }
    } else {
      return res.status(400).json({ message: "Type is missing or incorrect" });
    }

    const inmate = await InmateSchema.findOne({ inmateId });
    if (!inmate) {
      return res.status(404).json({ message: "Inmate not found" });
    }

    let amountToAdd = 0;
    if (type === 'wages') {
      amountToAdd = wageAmount || 0;
    } else if (type === 'deposit') {
      amountToAdd = depositAmount || 0;
    } else if (type === 'withdrawal') {
      amountToAdd = depositAmount || 0;
    }

    if (type === 'withdrawal') {
      inmate.balance -= amountToAdd
    } else {
      inmate.balance += amountToAdd;
    }
    await inmate.save();

    const financial = new FinancialSchema({
      inmateId,
      custodyType: inmate.custodyType,
      workAssignId,
      hoursWorked,
      wageAmount,
      transaction,
      status,
      type,
      relationShipId,
      depositAmount,
      depositName: "Wallet Topup",
      depositType: "MANUAL_CREDIT",
      remarks,
      fileIds
    });

    const savedFinancial = await financial.save();
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'CREATE',
      targetModel: 'Financial',
      targetId: savedFinancial._id,
      description: `Created ${type} record for inmate ${inmateId}`,
      changes: { ...req.body, custodyType: inmate.custodyType }
    });

    res.status(201).json({ success: true, data: savedFinancial, message: "Financial " + type + " successfully created" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const getFinancial = async (req, res) => {
  try {
    const inmates = await FinancialSchema.find().sort({ createdAt: -1 });
    if (!inmates) {
      return res.status(404).json({ success: false, message: "No data found", data: [] })
    }
    res.status(200).json({ success: true, data: inmates, message: "Financial successfully fetched" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const getFinancialID = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const findFinancial = await FinancialSchema.findById(id);
    if (!findFinancial) {
      return res.status(404).json({ message: "No data found" });
    }
    res.status(200).json({ success: true, data: findFinancial, message: "Financial successfully fetched" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const updateFinancial = async (req, res) => {
  try {
    const { id } = req.params;
    const updateBody = req.body;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const original = await FinancialSchema.findById(id);
    if (!original) return res.status(404).json({ message: "No data found" });

    const updatedFinancial = await FinancialSchema.findByIdAndUpdate(
      id,
      updateBody,
      { new: true, runValidators: true }
    );
    if (!updatedFinancial) {
      return res.status(404).json({ message: "No data found" });
    }

    if (original.type === 'wages' || original.type === 'deposit') {
      const inmate = await InmateSchema.findOne({ inmateId: original.inmateId });
      if (inmate) {
        let oldAmount = original.type === 'wages' ? original.wageAmount : original.depositAmount;
        let newAmount = updateBody.wageAmount || updateBody.depositAmount || 0;

        const delta = newAmount - oldAmount;
        inmate.balance += delta;
        await inmate.save();
      }
    }
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE',
      targetModel: 'Financial',
      targetId: id,
      description: `Updated financial record for inmate ${updatedFinancial.inmateId}`,
      changes: updatedFinancial
    });
    res.status(200).json({ success: true, data: updatedFinancial, message: "Financial update successfully" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const deleteFinancial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const updatedFinancial = await FinancialSchema.findByIdAndDelete(id);
    if (!updatedFinancial) {
      return res.status(404).json({ message: "No data found" });
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      targetModel: 'Financial',
      targetId: updatedFinancial._id,
      description: `Deleted financial record for inmate ${updatedFinancial.inmateId}`,
      changes: updatedFinancial.toObject()
    });

    res.status(200).json({ success: true, message: "Financial successfully deleted" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const searchFinancial = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "Search query is required" });
    }

    const regex = new RegExp(query, "i"); // 'i' makes it case-insensitive

    const results = await FinancialSchema.find({
      $or: [
        { inmateId: regex },
        { firstName: regex },
        { lastName: regex },
        { cellNumber: regex },
      ]
    });

    res.status(200).json({ success: true, data: results });

  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};


module.exports = { createFinancial, getFinancial, getFinancialID, updateFinancial, deleteFinancial, searchFinancial, downloadWagesCSV };