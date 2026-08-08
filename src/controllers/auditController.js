const AuditLog = require('../model/auditLogModel');
const userModel = require('../model/userModel');
const { requireLocationFilter } = require('../utils/locationAccess');
const { buildSearchRegex } = require('../utils/searchUtils');

const getAuditLogs = async (req, res) => {
  try {
    const locationFilter = req.locationFilter ?? requireLocationFilter(req.user);
    if (!locationFilter) return;

    let allowedUserIds = [];
    if (locationFilter.location_id) {
      const usersAtLocation = await userModel.find(locationFilter).select('_id').lean();
      allowedUserIds = usersAtLocation.map((u) => u._id);
    }

    const { userId, action, fromDate, toDate, page = 1, limit = 20, search } = req.query;

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

    const isLocationRestricted = Boolean(locationFilter.location_id);
    if (isLocationRestricted) {
      const allowedIdsSet = new Set(allowedUserIds.map((id) => id.toString()));
      if (filter.userId) {
        const requestedId = filter.userId.toString();
        if (!allowedIdsSet.has(requestedId)) {
          filter.userId = { $in: [] };
        }
      } else if (allowedUserIds.length) {
        filter.userId = { $in: allowedUserIds };
      } else {
        filter.userId = { $in: [] };
      }
    }

    // Smart Search: matches the actor's name, the action, the module
    // (targetModel), the human-readable description, or a referenced
    // inmate id inside `changes` - the same fields the "readable view"
    // table renders. AuditLog stores its own denormalized `username`
    // field (set at write time in utils/auditlogger.js), so this doesn't
    // need a $lookup/populate to search by actor name.
    const searchRegex = buildSearchRegex(search);
    if (searchRegex) {
      filter.$or = [
        { username: searchRegex },
        { action: searchRegex },
        { targetModel: searchRegex },
        { description: searchRegex },
        { 'changes.inmateId': searchRegex },
      ];
    }

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
