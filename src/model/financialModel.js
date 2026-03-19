const mongoose = require('mongoose');

const financialSchema = new mongoose.Schema({
    inmateId: { type: String, required: true },
    fileIds: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "InmateFile"
        }
    ],
    custodyType: { type: String, required: true },
    transaction: { type: String },
    workAssignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    hoursWorked: { type: Number, default: 0 },
    wageAmount: { type: Number, default: 0 },
    depositName: { type: String },
    relationShipId: { type: String },
    remarks: { type: String },
    depositAmount: { type: Number, default: 0 },
    depositType: { type: String },
    type: { type: String, required: true },
    status: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Financial', financialSchema);