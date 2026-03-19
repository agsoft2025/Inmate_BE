// src/utils/auditLogger.js
const AuditLog = require('../model/auditLogModel');

const logAudit = async ({ userId, username, action, targetModel, targetId, description, changes }) => {
  try {
    await AuditLog.create({
      userId,
      username,
      action,
      targetModel,
      targetId,
      description,
      changes
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};

module.exports = logAudit;
