const InmateSchema = require("../model/inmateModel");
const mongoose = require("mongoose");
const logAudit = require("../utils/auditlogger");
const Inmate = require('../model/inmateModel');
const bcrypt = require("bcrypt")

const { Parser } = require('json2csv');
const formatDateToYYYYMMDD = require("../utils/dateFormat");
const financialModel = require("../model/financialModel");
const userModel = require("../model/userModel");
const { logError } = require("../utils/safeLog");
const InmateLocation = require("../model/inmateLocationModel");
const { resolveLocationId, LocationAccessError, requireLocationFilter } = require("../utils/locationAccess");
const { normalizeIndianMobile, isValidIndianMobile } = require("../utils/phoneUtils");
const { buildSearchRegex } = require("../utils/searchUtils");
const { allowlistSortField } = require("../utils/queryValidation");
const { pick } = require("../utils/safeLog");

// Only these Inmate fields may be used to sort the list endpoint - a
// client-supplied sortField is otherwise used as a raw dynamic object key
// ({ [sortField]: order }), letting the client pick any/unindexed field.
const INMATE_SORTABLE_FIELDS = [
  "createdAt", "updatedAt", "inmateId", "firstName", "lastName",
  "status", "custodyType", "admissionDate", "dateOfBirth", "balance",
];

// Only these fields may be set via PUT /inmate/:id - `updateBody` used to
// be the entire raw req.body, so a client could also set `balance`,
// `location_id`, `user_id`, `isDeleted`, etc. (real schema fields) in the
// same request, or - since a body with no client-supplied field is passed
// straight through as the update document - use MongoDB update operators
// like $inc/$rename/$unset directly instead of a plain field object.
const INMATE_UPDATABLE_FIELDS = [
  "inmateId", "firstName", "lastName", "phonenumber", "status",
  "custodyType", "crimeType", "cellNumber", "dateOfBirth", "admissionDate",
  "isBlocked", "blockedReason",
];

const STATUS_MAP = {
  active: "Active",
  "on bail": "On Bail",
  "on parole": "On Parole",
  released: "Released",
  transfer: "Transfer"
};

const normalizeStatus = (status = "") => {
  if (!status || typeof status !== "string") return "Active";
  const normalized = status.trim().toLowerCase();
  return STATUS_MAP[normalized] || "Active";
};
const POSShoppingCart = require('../model/posShoppingCart');
const { faceRecognitionService, faceRecognitionExcludeUserService, resolveFaceMatch } = require("../service/faceRecognitionService");
const normalizePhoneNumber = (value) => {
  if (!value) return value;
  return String(value)
    .replace(/[^0-9]/g, "")
    .replace(/^91/, "")
    .replace(/^0+/, "")
    .trim();
};

const getLocationFilterOrAbort = (req, res) => {
  try {
    return requireLocationFilter(req.user);
  } catch (error) {
    if (error instanceof LocationAccessError) {
      res.status(error.status).json({ success: false, message: error.message });
      return null;
    }
    throw error;
  }
};

const downloadInmatesCSV1 = async (req, res) => {
  try {
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inmates = await Inmate.find(locationFilter).lean();

    if (!inmates || inmates.length === 0) {
      return res.status(404).json({ message: 'No inmates found to export' });
    }

    const fields = [
      'inmateId',
      'firstName',
      'lastName',
      'cellNumber',
      'balance',
      'dateOfBirth',
      'admissionDate',
      'crimeType',
      'status',
      'location_id',
      'custodyType'
    ];

    const formattedInmates = inmates.map(inmate => ({
      ...inmate,
      dateOfBirth: formatDateToYYYYMMDD(inmate.dateOfBirth),
      admissionDate: formatDateToYYYYMMDD(inmate.admissionDate),
    }));

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedInmates);

    res.setHeader('Content-Disposition', 'attachment; filename=inmates.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).end(csv);

  } catch (err) {
    res.status(500).json({ message: 'Failed to export CSV', error: err.message });
  }
};


const downloadInmatesCSV = async (req, res) => {
  try {
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inmates = await Inmate.find(locationFilter).lean();

    if (!inmates || inmates.length === 0) {
      return res.status(404).json({ message: 'No inmates found to export' });
    }

    const fields = [
      'inmateId',
      'firstName',
      'lastName',
      'cellNumber',
      'balance',
      'dateOfBirth',
      'admissionDate',
      'crimeType',
      'phonenumber',
      'status',
      // 'location_id',
      'custodyType'
    ];

    // Format each date field to dd-mm-yy
    const formattedInmates = inmates.map(inmate => ({
      ...inmate,
      dateOfBirth: formatDateToYYYYMMDD(inmate.dateOfBirth),
      admissionDate: formatDateToYYYYMMDD(inmate.admissionDate),
    }));

    const parser = new Parser({ fields });
    const csv = parser.parse(formattedInmates);

    res.setHeader('Content-Disposition', 'attachment; filename="inmates.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).send(csv);

  } catch (err) {
    res.status(500).json({
      message: 'Failed to export CSV',
      error: err.message
    });
  }
};

const createInmate = async (req, res) => {
  try {
    const { inmateId, firstName, lastName, cellNumber, dateOfBirth, admissionDate, status, crimeType, custodyType, locationId, descriptor ,phonenumber} = req.body;     
    let assignedLocationId;
    try {
      assignedLocationId = await resolveLocationId(req.user, locationId);
    } catch (error) {
      if (error instanceof LocationAccessError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      throw error;
    }

    if (!assignedLocationId) {
      return res.status(400).json({ message: "location is required" });
    }
    if (descriptor) {
      const checkFaceMatch = await faceRecognitionService(descriptor)
      if (checkFaceMatch.status) {
        return res.status(400).send({ success: false, message: `A face record already exists for user ${checkFaceMatch.username}` })
      }
    }

    if (!inmateId || !firstName || !lastName || !phonenumber) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!isValidIndianMobile(phonenumber)) {
      return res.status(400).json({ message: "Invalid phone number" });
    }

    const normalizedPhone = normalizeIndianMobile(phonenumber);
    const existingInmateID = await InmateSchema.findOne({
      inmateId,
      location_id: assignedLocationId,
    });

    if (existingInmateID) {
      return res.status(400).json({ success: false, message: "Inmate ID already exist" })
    }

    const existingPhone = await InmateSchema.findOne({
      phonenumber: normalizedPhone,
      location_id: assignedLocationId,
    });

    if (existingPhone) {
      return res.status(400).json({ success: false, message: "Phone number already exists for this location" });
    }

    const inmate = new InmateSchema({
      inmateId,
      firstName,
      lastName,
      custodyType,
      cellNumber,
      dateOfBirth,
      admissionDate,
      status: normalizeStatus(status),
      crimeType,
      phonenumber: normalizedPhone,
      location_id: assignedLocationId
    });

    const savedInmate = await inmate.save()
    if (savedInmate) {
      const hashedPassword = await bcrypt.hash(inmateId, 10);
      const newUser = new userModel({ username: inmateId, fullname: inmateId, inmateId, password: hashedPassword, role: "INMATE", location_id: assignedLocationId, descriptor });
      const savedUser = await newUser.save();
      const updatedInmate = await InmateSchema.findByIdAndUpdate(
        savedInmate._id,
        { user_id: savedUser._id },
        { new: true }
      );

    }
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: "CREATE",
      targetModel: "Inmate",
      targetId: savedInmate._id,
      description: `Created inmate ${inmateId}`,
      changes: savedInmate.toObject()
    });
    res.status(201).json({ success: true, data: savedInmate, message: "Inmate successfully created" });
  } catch (error) {
    if (error instanceof LocationAccessError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    logError("createInmate error:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const getInmates = async (req, res) => {
  try {
    const { page = 1, limit = 10, sortField = 'createdAt', sortOrder, totalRecords } = req.query;
    const order = sortOrder === 'asc' ? 1 : -1;
    const safeSortField = allowlistSortField(sortField, INMATE_SORTABLE_FIELDS, 'createdAt');

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    let inmatesQuery = Inmate.find(locationFilter)
      .populate('location_id', 'locationName')
      .populate('user_id', 'descriptor')
      .sort({ [safeSortField]: order });

    let currentPage = Number(page);
    let perPage = Number(limit);

    // ✅ If totalRecords=true, return everything without skip/limit
    if (!totalRecords || totalRecords !== 'true') {
      const skip = (currentPage - 1) * perPage;
      inmatesQuery = inmatesQuery.skip(skip).limit(perPage);
    }

    const [inmates, totalItems] = await Promise.all([
      inmatesQuery,
      Inmate.countDocuments(locationFilter)
    ]);

    if (!inmates.length) {
      return res.status(404).json({
        success: false,
        message: 'No data found',
        data: []
      });
    }

    res.json({
      success: true,
      data: inmates,
      // Only include pagination info if we paginated
      currentPage: totalRecords === 'true' ? null : currentPage,
      totalPages: totalRecords === 'true' ? 1 : Math.ceil(totalItems / perPage),
      totalItems,
      message: 'Inmates fetched successfully'
    });
  } catch (error) {
    logError("getInmates error:", error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


const getInmatesID = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    let findInmate;

    if (mongoose.Types.ObjectId.isValid(id)) {
      findInmate = await InmateSchema.findOne({ ...locationFilter, _id: id });
    } else {
      findInmate = await InmateSchema.findOne({ ...locationFilter, inmateId: id });
    }
    if (!findInmate) {
      return res.status(404).json({ message: "No data found" });
    }
    res.status(200).json({ success: true, data: findInmate, message: "Inmate successfully fetched" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const updateInmate = async (req, res) => {
  try {
    const { id } = req.params;
    // Only an explicit allowlist of Inmate fields may be set here -
    // previously the entire raw req.body was passed to findOneAndUpdate(),
    // which let a client also set balance/location_id/user_id/isDeleted
    // (real schema fields), or send MongoDB update operators directly as
    // the whole update document. See INMATE_UPDATABLE_FIELDS above.
    const updateBody = pick(req.body, INMATE_UPDATABLE_FIELDS);
    const { inmateId, descriptor } = req.body;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;

    if (inmateId) {
      const duplicateFilter = {
        ...locationFilter,
        inmateId,
        _id: { $ne: id }
      };
      const existingInmateID = await InmateSchema.findOne(duplicateFilter);
      if (existingInmateID) {
        return res.status(400).json({ success: false, message: "Inmate ID already exist" });
      }
    }

    const inmateToUpdate = await InmateSchema.findOne({ ...locationFilter, _id: id }).populate("user_id");
    if (!inmateToUpdate) {
      return res.status(404).json({ message: "No data found" });
    }

    if (descriptor) {
      const userIdForFace = inmateToUpdate.user_id?._id;
      const checkFaceMatch = await faceRecognitionExcludeUserService(descriptor, userIdForFace);
      if (checkFaceMatch.status) {
        return res.status(400).send({ success: false, message: `A face record already exists for user ${checkFaceMatch.username}` });
      }
    }

    if (updateBody.phonenumber) {
      if (!isValidIndianMobile(updateBody.phonenumber)) {
        return res.status(400).json({ message: "Invalid phone number" });
      }
      updateBody.phonenumber = normalizeIndianMobile(updateBody.phonenumber);
      const duplicatePhone = await InmateSchema.findOne({
        phonenumber: updateBody.phonenumber,
        ...locationFilter,
        _id: { $ne: id },
      });
      if (duplicatePhone) {
        return res.status(400).json({ success: false, message: "Phone number already in use in this location" });
      }
    }

    const updatedInmate = await InmateSchema.findOneAndUpdate(
      { ...locationFilter, _id: id },
      updateBody,
      { new: true, runValidators: true }
    );
    if (!updatedInmate) {
      return res.status(404).json({ message: "No data found" });
    }

    const hashedPassword = await bcrypt.hash(inmateId, 10);
    const userPayload = {
      username: inmateId,
      fullname: inmateId,
      password: hashedPassword,
    };
    if (descriptor) {
      userPayload.descriptor = descriptor;
    }

    await userModel.findByIdAndUpdate(
      updatedInmate.user_id,
      userPayload,
      { new: true }
    );

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: "UPDATE",
      targetModel: "Inmate",
      targetId: updatedInmate._id,
      description: `Updated inmate ${updatedInmate.inmateId}`,
      changes: req.body
    });
    res.status(200).json({ success: true, data: updatedInmate, message: "Inmate update successfully" });
  } catch (error) {
    if (error instanceof LocationAccessError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    logError("updateInmate error:", error);

    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const deleteInmate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const deletedInmate = await InmateSchema.findOneAndDelete({ ...locationFilter, _id: id });
    if (!deletedInmate) {
      return res.status(404).json({ message: "No data found" });
    }
    const inmateDelete = await userModel.deleteOne({ inmateId: deletedInmate.inmateId })

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      targetModel: 'Inmate',
      targetId: deletedInmate._id,
      description: `Deleted inmate ${deletedInmate.inmateId}`,
      changes: deletedInmate.toObject()
    });
    res.status(200).json({ success: true, message: "Inmate successfully deleted" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const searchInmates = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "Search query is required" });
    }

    // buildSearchRegex() escapes regex metacharacters before building the
    // RegExp - a raw `new RegExp(query, "i")` let a search term like
    // "(a+)+$" turn into a catastrophic-backtracking pattern evaluated by
    // MongoDB against every candidate document.
    const regex = buildSearchRegex(query);

    const baseFilter = getLocationFilterOrAbort(req, res);
    if (!baseFilter) return;
    const filter = {
      ...baseFilter,
      $or: [
        { inmateId: regex },
        { firstName: regex },
        { lastName: regex },
        { cellNumber: regex },
      ],
    };

    const results = await InmateSchema.find(filter);
    const totalMatching = await InmateSchema.countDocuments(filter); 
    const totalInmates = await InmateSchema.countDocuments(baseFilter);

    res.status(200).json({
      success: true,
      data: results,
      totalPages: totalMatching,
      totalItems: results.length,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const getInmateUsingInmateID = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" })
    }
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const findInmate = await InmateSchema.findOne({ ...locationFilter, inmateId: id }).populate('location_id')
    if (!findInmate) {
      return res.status(404).json({ message: "No data found" });
    }
    res.status(200).json({ success: true, data: findInmate, message: "Inmate successfully fetched" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
}

const getInmateTransactionData = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, days } = req.query;

    if (!id) {
      return res.status(400).json({ message: "ID is missing" });
    }

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inmateData = await InmateSchema.findOne({ ...locationFilter, inmateId: id });
    if (!inmateData) {
      return res.status(404).send({ success: false, message: "No data found" });
    }

    let filter = {
      inmateId: id,
      ...(locationFilter.location_id ? { location_id: locationFilter.location_id } : {})
    };

    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
      filter.createdAt = { $gte: daysAgo };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageSize = parseInt(limit);

    // Fetch POS and Financial transactions
    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find(filter)
        .populate('products.productId')
        .lean(),
      financialModel.find(filter)
        .populate('workAssignId')
        .lean()
    ]);

    // Merge and tag
    let allTransactions = [
      ...posTransactions.map(t => ({ ...t, source: 'POS' })),
      ...financialTransactions.map(t => ({ ...t, source: 'FINANCIAL' }))
    ];

    // Sort newest first
    allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    let paginated = allTransactions.slice(skip, skip + pageSize);

    // Add custodyType only for POS transactions
    paginated = await Promise.all(
      paginated.map(async (trx) => {
        if (trx.source === 'POS') {
          const inmate = await InmateSchema.findOne(
            { inmateId: trx.inmateId },
            { custodyType: 1, _id: 0 }
          ).lean();

          if (inmate) {
            trx.custodyType = inmate.custodyType;
          }
        }
        return trx;
      })
    );

    if (!allTransactions.length) {
      return res.status(404).send({ success: false, message: "No data found" });
    }

    // res.status(200).send({
    //   success: true,
    //   data: paginated,
    //   pagination: {
    //     total: allTransactions.length,
    //     page: parseInt(page),
    //     limit: pageSize,
    //     totalPages: Math.ceil(allTransactions.length / pageSize),
    //   },
    //   message: "Fetched inmate transactions",
    // });

    res.status(200).json({
      success: true,
      count: allTransactions.length,
      page: parseInt(page),
      limit: pageSize,
      totalPages: Math.ceil(allTransactions.length / pageSize),
      transactions: paginated,
      message: "Fetched inmate transactions",
    });



  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }




  // try {
  //   const { id } = req.params;
  //   const { page = 1, limit = 10, days } = req.query;

  //   if (!id) {
  //     return res.status(400).json({ message: "ID is missing" });
  //   }

  //   const pageNum = parseInt(page, 10);
  //   const limitNum = parseInt(limit, 10);
  //   const skip = (pageNum - 1) * limitNum;

  //   let filter = { inmateId: id };

  //   if (days) {
  //     const daysAgo = new Date();
  //     daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
  //     filter.createdAt = { $gte: daysAgo };
  //   }

  //   const inmateDataTransaction = await financialModel
  //     .find(filter)
  //     .populate('workAssignId', 'name isActive')
  //     .sort({ createdAt: -1 })
  //     .skip(skip)
  //     .limit(limitNum);

  //   const totalCount = await financialModel.countDocuments(filter);

  //   if (!inmateDataTransaction.length) {
  //     return res.status(404).send({ success: false, message: "No data found" });
  //   }

  //   res.status(200).send({
  //     success: true,
  //     data: inmateDataTransaction,
  //     pagination: {
  //       total: totalCount,
  //       page: pageNum,
  //       limit: limitNum,
  //       totalPages: Math.ceil(totalCount / limitNum),
  //     },
  //     message: "Fetched inmate transactions",
  //   });

  // } catch (error) {
  //   res.status(500).json({
  //     success: false,
  //     message: "Internal server error",
  //     error: error.message,
  //   });
  // }
};


const fetchInmateDataUsingFace = async (req, res) => {
  try {
    const { descriptor } = req.body
    if (!descriptor) {
      return res.status(404).send({ success: false, message: "could not find face" })
    }
    const allUsers = await userModel.find({}, { descriptor: 1, username: 1, role: 1, fullname: 1 })

    // Account-takeover fix: use the same ambiguity-aware resolver as
    // login - if a second enrolled user is also close enough to plausibly
    // be the presented face, refuse to guess (misidentifying an inmate at
    // the POS terminal has real financial impact - wrong wallet debited).
    const { matched, ambiguous, bestMatch, distance } = resolveFaceMatch(descriptor, allUsers);

    if (ambiguous) {
      return res.status(400).json({
        message: "Face match is ambiguous. Please search for the inmate manually.",
        distance,
      });
    }
    if (!matched) {
      // Face Verification Hardening: include the closest distance we found
      // (when any candidate existed) so the frontend can show a more useful
      // "why did this fail?" reason than a bare generic message.
      return res.status(400).json({ message: "Face not recognized", distance: bestMatch ? distance : null });
    }
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const userData = await Inmate.findOne({
      ...locationFilter,
      user_id: bestMatch._id
    });

    if (!userData) {
      return res.status(404).send({ success: false, message: "data fetch successfully" })
    }

    return res.status(200).send({ success: true, data: userData, message: "data fetch successfully", distance })
  } catch (error) {
    return res.status(500).send({ success: false, message: "internal server down", error: error.message })
  }
}
module.exports = { createInmate, getInmates, getInmatesID, updateInmate, deleteInmate, searchInmates, downloadInmatesCSV, getInmateUsingInmateID, getInmateTransactionData, fetchInmateDataUsingFace };
