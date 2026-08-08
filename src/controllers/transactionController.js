const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const inmateModel = require('../model/inmateModel');
const { buildLocationFilter, isSuperAdminRole } = require("../utils/locationAccess");
const { buildSearchRegex } = require("../utils/searchUtils");

const buildLocationContext = async (user) => {
  const isSuper = isSuperAdminRole(user?.role);
  const locationFilter = buildLocationFilter(user);
  const locationObjectId = locationFilter.location_id || null;
  const locationId = locationObjectId ? locationObjectId.toString() : null;

  if (!locationId && !isSuper) {
    return {
      locationId: null,
      locationObjectId: null,
      allowedInmateIds: new Set(),
      locationRestricted: true
    };
  }

  let allowedInmateIds = null;
  if (locationObjectId) {
    const inmatesAtLocation = await inmateModel
      .find({ location_id: locationObjectId })
      .select("inmateId")
      .lean();

    allowedInmateIds = new Set(inmatesAtLocation.map((inmate) => inmate.inmateId));
  }

  return {
    locationId,
    locationObjectId,
    allowedInmateIds,
    locationRestricted: false
  };
};

const filterPOSTransactionsByLocation = (transactions, context) => {
  const { locationId, allowedInmateIds, locationRestricted } = context;
  if (locationRestricted) return [];
  const hasAllowedInmates = Boolean(allowedInmateIds && allowedInmateIds.size > 0);
  if (!locationId && !hasAllowedInmates) return transactions;

  return transactions.filter((trx) => {
    if (locationId && trx.location_id?.toString() === locationId) {
      return true;
    }
    if (hasAllowedInmates && allowedInmateIds.has(trx.inmateId)) {
      return true;
    }
    return false;
  });
};

const parseBooleanQuery = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return null;
};

const filterFinancialTransactionsByLocation = (transactions, context) => {
  const { allowedInmateIds, locationObjectId, locationRestricted } = context;
  if (locationRestricted) return [];
  if ((!locationObjectId && (!allowedInmateIds || allowedInmateIds.size === 0))) return [];

  return transactions.filter((trx) => {
    const sameLocation = locationObjectId
      ? trx.location_id?.toString() === locationObjectId.toString()
      : true;
    const allowedInmate =
      allowedInmateIds && allowedInmateIds.size > 0
        ? allowedInmateIds.has(trx.inmateId)
        : true;
    return sameLocation && allowedInmate;
  });
};

const applyReversedFilter = (transactions, reversedFlag) => {
  if (reversedFlag === null) {
    return transactions;
  }
  return transactions.filter((trx) => Boolean(trx.is_reversed) === reversedFlag);
};

// Smart Search (Transaction History): matches whatever the merged
// POS/Financial transaction has already loaded at this point in the
// request - inmate id, source, type/deposit-type/relationship/remarks
// (Financial), work assignment name (Financial, populated), and product
// name/category (POS, populated). Deliberately does NOT match POS's
// `custodyType`, since that's only looked up for the current page's rows
// *after* pagination (see enrichTransaction below) - searching it would
// mean fetching every inmate's custody type up front for every request.
const matchesTransactionSearch = (trx, regex) => {
  const candidates = [
    trx.inmateId,
    trx.source,
    trx.custodyType, // present on Financial rows directly; not on POS pre-enrichment
    trx.type,
    trx.depositType,
    trx.relationShipId,
    trx.remarks,
    trx.transaction,
    trx.status,
    trx.is_reversed ? "reversed" : null,
    trx.workAssignId?.name,
    ...(Array.isArray(trx.products)
      ? trx.products.flatMap((p) => [p?.productId?.itemName, p?.productId?.category])
      : []),
  ].filter((value) => value != null && value !== "");

  return candidates.some((value) => regex.test(String(value)));
};

const getTransactionsByRange1 = async (req, res) => {
  try {
    const { range = 'daily', page = 1, limit = 10 } = req.query;


    const now = new Date();
    let startDate;

    switch (range.toLowerCase()) {
      case 'daily':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'weekly':
        startDate = new Date();
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid range. Use 'daily', 'weekly', 'monthly', or 'yearly'."
        });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageSize = parseInt(limit);

    // Fetch POS and Financial transactions
    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find({ createdAt: { $gte: startDate } })
        .populate('products.productId')
        .lean(),
      Financial.find({ createdAt: { $gte: startDate } })
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
          const inmate = await inmateModel.findOne(
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

    res.status(200).json({
      success: true,
      range,
      count: allTransactions.length,
      page: parseInt(page),
      limit: pageSize,
      totalPages: Math.ceil(allTransactions.length / pageSize),
      transactions: paginated
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

const getTransactionsByRange2 = async (req, res) => {
  try {
    const { range = 'daily', page = 1, limit = 10 } = req.query;

    const now = new Date();
    let startDate;

    // 📅 Set date range
    switch (range.toLowerCase()) {
      case 'daily':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 1); // include yesterday + today
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        const temp = new Date();
        startDate = new Date(temp.setDate(temp.getDate() - temp.getDay())); // start of the week
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageSize = parseInt(limit);

    // 📊 Fetch POS & Financial transactions (including reversed)
    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find({ createdAt: { $gte: startDate } })
        .populate('products.productId')
        .lean(),
      Financial.find({ createdAt: { $gte: startDate } })
        .populate('workAssignId')
        .lean()
    ]);

    // 🧮 Calculate totals
    const totalPosAmount = posTransactions
      .filter(t => !t.is_reversed)
      .reduce((acc, t) => acc + (t.totalAmount || 0), 0);

    const totalPosReversedAmount = posTransactions
      .filter(t => t.is_reversed)
      .reduce((acc, t) => acc + (t.totalAmount || 0), 0);

    const totalFinancialAmount = financialTransactions
      .reduce((acc, t) => acc + (t.wageAmount || 0), 0);

    // 🪄 Merge and tag source
    let allTransactions = [
      ...posTransactions.map(t => ({ ...t, source: 'POS' })),
      ...financialTransactions.map(t => ({ ...t, source: 'FINANCIAL' }))
    ];

    // 🕒 Sort newest first
    allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 📑 Pagination
    let paginated = allTransactions.slice(skip, skip + pageSize);

    // 🧠 Add custodyType for POS
    paginated = await Promise.all(
      paginated.map(async (trx) => {
        if (trx.source === 'POS') {
          const inmate = await inmateModel.findOne(
            { inmateId: trx.inmateId },
            { custodyType: 1, _id: 0 }
          ).lean();
          if (inmate) trx.custodyType = inmate.custodyType;
        }
        return trx;
      })
    );

    res.status(200).json({
      success: true,
      range,
      count: allTransactions.length,
      page: parseInt(page),
      limit: pageSize,
      totalPages: Math.ceil(allTransactions.length / pageSize),
      transactions: paginated,
      totals: {
        totalPosAmount,
        totalPosReversedAmount,
        totalFinancialAmount
      }
    });

  } catch (error) {
    console.error('❌ getTransactionsByRange error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

const getTransactionsByRange = async (req, res) => {
  try {
    console.log("<><>working..............")
    const { range = "daily", page = 1, limit = 10, inmateId, search } = req.query;
    const now = new Date();
    let startDate;
    const context = await buildLocationContext(req.user);
    if (context.locationRestricted) {
      return res.status(404).json({
        success: false,
        message: "Location must be assigned to access this data"
      });
    }
    const { locationObjectId, allowedInmateIds } = context;

    // ✅ FIXED DATE LOGIC
    switch (range.toLowerCase()) {
      case "daily":
        // last 24 hours (NOT yesterday midnight)
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;

      case "weekly":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;

      case "monthly":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;

      case "yearly":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;

      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const pageNum = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNum - 1) * pageSize;

    // ✅ FETCH DATA
    const dateFilter = { $gte: startDate };
    const posQuery = {
      $or: [
        { createdAt: dateFilter },
        { reversedAt: dateFilter }
      ],
      ...(locationObjectId ? { location_id: locationObjectId } : {})
    };

    const financialQuery = { createdAt: { $gte: startDate } };
    if (allowedInmateIds) {
      financialQuery.inmateId = { $in: Array.from(allowedInmateIds) };
    }
    if (locationObjectId) {
      financialQuery.location_id = locationObjectId;
    }

    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find(posQuery)
        .populate("products.productId")
        .lean(),

      Financial.find(financialQuery)
        .populate("workAssignId")
        .populate({
          path: "fileIds",
          select: "fileUrl fileType remarks createdAt"
        })
        .lean()
    ]);

    // 🔍 DEBUG (remove later)
    console.log("POS count:", posTransactions.length);
    console.log("Financial count:", financialTransactions.length);

    // ✅ TOTALS (FIXED)
    const reversedFlag = parseBooleanQuery(req.query.reversed);
    const locationFilteredPOS = filterPOSTransactionsByLocation(posTransactions, context);
    const filteredPOS = applyReversedFilter(locationFilteredPOS, reversedFlag);
    const filteredFinancial = filterFinancialTransactionsByLocation(financialTransactions, context);

    const totalPosAmount = locationFilteredPOS
      .filter(t => !t.is_reversed)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);

    const totalPosReversedAmount = locationFilteredPOS
      .filter(t => t.is_reversed)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);

    const totalFinancialAmount = filteredFinancial.reduce(
      (sum, t) => sum + (t.wageAmount || t.depositAmount || 0),
      0
    );

    // ✅ MERGE TRANSACTIONS
    let allTransactions = [
      ...filteredPOS.map(t => ({
        ...t,
        source: "POS",
        amount: t.totalAmount,
        eventDate: t.is_reversed
          ? t.reversedAt || t.updatedAt || t.createdAt
          : t.createdAt
      })),

      ...filteredFinancial.map(t => ({
        ...t,
        source: "FINANCIAL",
        amount: t.wageAmount || t.depositAmount || 0
      }))
    ];

    // 🔎 SMART SEARCH - applied before pagination so totalRecords/
    // totalPages reflect the filtered count, not the full range. Totals
    // above intentionally stay computed from the *unfiltered* range (they
    // describe the whole selected date range, same as they already ignore
    // pagination).
    const searchRegex = buildSearchRegex(search);
    if (searchRegex) {
      allTransactions = allTransactions.filter((trx) => matchesTransactionSearch(trx, searchRegex));
    }

    // ✅ SORT BY DATE DESC
    allTransactions.sort(
      (a, b) => new Date(b.eventDate || b.createdAt) - new Date(a.eventDate || a.createdAt)
    );

    // ✅ PAGINATION
    const paginated = allTransactions.slice(skip, skip + pageSize);

    // ✅ ADD custodyType FOR POS TRANSACTIONS
    const enrichTransaction = async (trx) => {
      if (trx.source === "POS") {
        const inmate = await inmateModel
          .findOne(
            { inmateId: trx.inmateId },
            { custodyType: 1, _id: 0 }
          )
          .lean();
        trx.custodyType = inmate?.custodyType || null;
      }
      return {
        ...trx,
        isReversed: Boolean(trx.is_reversed),
        eventDate: trx.eventDate || trx.reversedAt || trx.updatedAt || trx.createdAt
      };
    };

    const finalTransactions = await Promise.all(
      paginated.map(trx => enrichTransaction(trx))
    );

    // ✅ RESPONSE
    res.status(200).json({
      success: true,
      range,
      page: pageNum,
      limit: pageSize,
      totalRecords: allTransactions.length,
      totalPages: Math.ceil(allTransactions.length / pageSize),
      totals: {
        totalPosAmount,
        totalPosReversedAmount,
        totalFinancialAmount
      },
      transactions: finalTransactions
    });

  } catch (error) {
    console.error("❌ getTransactionsByRange error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

const getTransactionsByRangeMobile = async (req, res) => {
  try {
    const { range = "daily", page = 1, limit = 10, inmateId } = req.query;
    const now = new Date();
    let startDate;
    const context = await buildLocationContext(req.user);
    if (context.locationRestricted) {
      return res.status(403).json({
        success: false,
        message: "Location must be assigned to access this data"
      });
    }
    const { locationObjectId, allowedInmateIds } = context;

    switch (range.toLowerCase()) {
      case "daily":
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case "weekly":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "monthly":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const pageNum = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNum - 1) * pageSize;

    // ✅ IMPORTANT PART
    const dateFilter = { $gte: startDate };
    const baseQuery = {
      $or: [
        { createdAt: dateFilter },
        { reversedAt: dateFilter }
      ],
    };
    if (inmateId && inmateId.trim()) {
      baseQuery.inmateId = inmateId.trim();
    }

    const posQuery = { ...baseQuery };
    if (locationObjectId) {
      posQuery.location_id = locationObjectId;
    }

    const financialQuery = { ...baseQuery };
    if (allowedInmateIds) {
      const allowedList = Array.from(allowedInmateIds);
      if (financialQuery.inmateId) {
        if (!allowedList.includes(financialQuery.inmateId)) {
          financialQuery.inmateId = { $in: [] };
        }
      } else {
        financialQuery.inmateId = { $in: allowedList };
      }
    }
    if (locationObjectId) {
      financialQuery.location_id = locationObjectId;
    }

    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find(posQuery)
        .populate("products.productId")
        .lean(),

      Financial.find(financialQuery)
        .populate("workAssignId")
        .populate({
          path: "fileIds",
          select: "fileUrl fileType remarks createdAt"
        })
        .lean()
    ]);

    const reversedFlag = parseBooleanQuery(req.query.reversed);
    const locationFilteredPOS = filterPOSTransactionsByLocation(posTransactions, context);
    const filteredPOS = applyReversedFilter(locationFilteredPOS, reversedFlag);
    const filteredFinancial = filterFinancialTransactionsByLocation(financialTransactions, context);

    const totalPosAmount = locationFilteredPOS
      .filter(t => !t.is_reversed)
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    const totalPosReversedAmount = locationFilteredPOS
      .filter(t => t.is_reversed)
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    const totalFinancialAmount = filteredFinancial.reduce(
      (s, t) => s + (t.wageAmount || t.depositAmount || 0),
      0
    );

    let allTransactions = [
      ...filteredPOS.map(t => ({
        ...t,
        source: "POS",
        amount: t.totalAmount,
        eventDate: t.is_reversed
          ? t.reversedAt || t.updatedAt || t.createdAt
          : t.createdAt
      })),
      ...filteredFinancial.map(t => ({
        ...t,
        source: "FINANCIAL",
        amount: t.wageAmount || t.depositAmount || 0
      }))
    ];

    // ✅ SORT FIRST
    allTransactions.sort(
      (a, b) => new Date(b.eventDate || b.createdAt) - new Date(a.eventDate || a.createdAt)
    );

    // ✅ THEN paginate
    const paginated = allTransactions.slice(skip, skip + pageSize);

    res.status(200).json({
      success: true,
      range,
      page: pageNum,
      limit: pageSize,
      totalRecords: allTransactions.length,
      totalPages: Math.ceil(allTransactions.length / pageSize),
      totals: {
        totalPosAmount,
        totalPosReversedAmount,
        totalFinancialAmount
      },
      transactions: paginated
    });

  } catch (error) {
    console.error("❌ getTransactionsByRange error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};




module.exports = { getTransactionsByRange, getTransactionsByRangeMobile };
