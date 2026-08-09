const mongoose = require('mongoose');

// Financial Anomaly & Fraud Detection - a reviewing officer's decision on a
// flagged transaction (POS or Financial). One transaction can accumulate
// multiple feedback entries over time (e.g. re-reviewed later) - the most
// recent one is treated as the transaction's current review status by the
// frontend.
const officerFeedbackSchema = new mongoose.Schema(
  {
    // POS/Financial _id, stored as a string so this collection doesn't need
    // to know which of the two source models a given id belongs to.
    transactionId: { type: String, required: true, index: true },
    transactionSource: { type: String, enum: ['POS', 'FINANCIAL'], required: true },
    inmateId: { type: String },

    // Snapshot of the risk assessment at review time, so the history stays
    // meaningful even if scoring rules change later.
    riskScore: { type: Number },
    riskLevel: { type: String, enum: ['low', 'medium', 'high', 'clear'] },
    signals: [{ code: String, weight: Number, label: String }],

    status: {
      type: String,
      enum: ['confirmed', 'false_positive', 'investigate'],
      required: true,
    },
    note: { type: String, trim: true },

    officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    officerUsername: { type: String },
    location_id: { type: mongoose.Schema.Types.ObjectId, ref: 'InmateLocation' },
  },
  { timestamps: true }
);

officerFeedbackSchema.index({ transactionId: 1, createdAt: -1 });

module.exports = mongoose.model('OfficerFeedback', officerFeedbackSchema);
