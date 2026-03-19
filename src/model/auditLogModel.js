const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String },
  action: { type: String, enum: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT','GENERATE','BULK_UPSERT'], required: true },
  targetModel: { type: String }, 
  targetId: { type: mongoose.Schema.Types.ObjectId },
  description: { type: String },
  changes: { type: mongoose.Schema.Types.Mixed }, 
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
