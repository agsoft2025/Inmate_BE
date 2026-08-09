const OfficerFeedback = require('../model/officerFeedbackModel');
const logAudit = require('../utils/auditlogger');

const VALID_STATUSES = ['confirmed', 'false_positive', 'investigate'];

// Financial Anomaly & Fraud Detection - officer review actions on a
// flagged transaction (Confirm / False Positive / Investigate), triggered
// from the risk review modal/panel on Dashboard.jsx and TransactionHistory.jsx.
const createOfficerFeedback = async (req, res) => {
  try {
    const {
      transactionId,
      transactionSource,
      inmateId,
      riskScore,
      riskLevel,
      signals,
      status,
      note,
    } = req.body;

    if (!transactionId || !transactionSource || !status) {
      return res.status(400).json({
        success: false,
        message: 'transactionId, transactionSource, and status are required',
      });
    }

    if (!['POS', 'FINANCIAL'].includes(transactionSource)) {
      return res.status(400).json({ success: false, message: 'transactionSource must be POS or FINANCIAL' });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const feedback = await OfficerFeedback.create({
      transactionId: String(transactionId),
      transactionSource,
      inmateId: inmateId || undefined,
      riskScore: typeof riskScore === 'number' ? riskScore : undefined,
      riskLevel: riskLevel || undefined,
      signals: Array.isArray(signals) ? signals : undefined,
      status,
      note: note || undefined,
      officerId: req.user?.id,
      officerUsername: req.user?.username,
      location_id: req.user?.location_id || undefined,
    });

    await logAudit({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'CREATE',
      targetModel: 'OfficerFeedback',
      targetId: feedback._id,
      description: `Reviewed flagged transaction ${transactionId} (${transactionSource}) as "${status}"`,
      changes: { transactionId, transactionSource, status, note },
    });

    return res.status(201).json({ success: true, data: feedback });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// GET /officer-feedback/:transactionId - review history for one transaction,
// newest first, so the review panel can show "already reviewed by X as Y".
const getOfficerFeedbackForTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'transactionId is required' });
    }

    const feedback = await OfficerFeedback.find({ transactionId: String(transactionId) })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

module.exports = { createOfficerFeedback, getOfficerFeedbackForTransaction };
