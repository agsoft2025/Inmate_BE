const AuditLog = require('../model/auditLogModel');

const getAuditLogs = async (req, res) => {
  try {
    const { userId, action, fromDate, toDate, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (userId) {
      filter.userId = userId;
    }

    if (action) {
      filter.action = action;
    }

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const pageNumber = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const skip = (pageNumber - 1) * pageSize;

    const totalLogs = await AuditLog.countDocuments(filter);

    const logs = await AuditLog.find(filter)
      .populate('userId', 'username fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize);

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total: totalLogs,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(totalLogs / pageSize)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      error: error.message
    });
  }
};

module.exports = { getAuditLogs };
