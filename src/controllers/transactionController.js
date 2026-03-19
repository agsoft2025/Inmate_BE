const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const inmateModel = require('../model/inmateModel');

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
    const { range = "daily", page = 1, limit = 10,inmateId } = req.query;
    const now = new Date();
    let startDate;

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
    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find({ createdAt: { $gte: startDate } })
        .populate("products.productId")
        .lean(),

      Financial.find({ createdAt: { $gte: startDate } })
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
    const totalPosAmount = posTransactions
      .filter(t => !t.is_reversed)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);

    const totalPosReversedAmount = posTransactions
      .filter(t => t.is_reversed)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);

    const totalFinancialAmount = financialTransactions.reduce(
      (sum, t) => sum + (t.wageAmount || t.depositAmount || 0),
      0
    );

    // ✅ MERGE TRANSACTIONS
    let allTransactions = [
      ...posTransactions.map(t => ({
        ...t,
        source: "POS",
        amount: t.totalAmount
      })),

      ...financialTransactions.map(t => ({
        ...t,
        source: "FINANCIAL",
        amount: t.wageAmount || t.depositAmount || 0
      }))
    ];

    // ✅ SORT BY DATE DESC
    allTransactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // ✅ PAGINATION
    const paginated = allTransactions.slice(skip, skip + pageSize);

    // ✅ ADD custodyType FOR POS TRANSACTIONS
    const finalTransactions = await Promise.all(
      paginated.map(async trx => {
        if (trx.source === "POS") {
          const inmate = await inmateModel
            .findOne(
              { inmateId: trx.inmateId },
              { custodyType: 1, _id: 0 }
            )
            .lean();

          trx.custodyType = inmate?.custodyType || null;
        }

        return trx;
      })
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
    const baseQuery = { createdAt: { $gte: startDate } };
    if (inmateId && inmateId.trim()) {
      baseQuery.inmateId = inmateId.trim();
    }

    const [posTransactions, financialTransactions] = await Promise.all([
      POSShoppingCart.find(baseQuery)
        .populate("products.productId")
        .lean(),

      Financial.find(baseQuery)
        .populate("workAssignId")
        .populate({
          path: "fileIds",
          select: "fileUrl fileType remarks createdAt"
        })
        .lean()
    ]);

    const totalPosAmount = posTransactions
      .filter(t => !t.is_reversed)
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    const totalPosReversedAmount = posTransactions
      .filter(t => t.is_reversed)
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    const totalFinancialAmount = financialTransactions.reduce(
      (s, t) => s + (t.wageAmount || t.depositAmount || 0),
      0
    );

    let allTransactions = [
      ...posTransactions.map(t => ({
        ...t,
        source: "POS",
        amount: t.totalAmount
      })),
      ...financialTransactions.map(t => ({
        ...t,
        source: "FINANCIAL",
        amount: t.wageAmount || t.depositAmount || 0
      }))
    ];

    // ✅ SORT FIRST
    allTransactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
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






module.exports = { getTransactionsByRange ,getTransactionsByRangeMobile};
