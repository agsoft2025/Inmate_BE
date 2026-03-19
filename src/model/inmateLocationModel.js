const mongoose = require('mongoose');

const custodyLimitSchema = new mongoose.Schema({
    custodyType: {
        type: String,
        required: true,
        enum: ['remand_prison', 'under_trail', 'contempt_of_court']
    },
    spendLimit: { type: Number, default: 0 },
    depositLimit: { type: Number, default: 0 },
    purchaseStatus: { type: String, default: 'approved' }
}, { _id: false });

const inmateLocationSchema = new mongoose.Schema(
    {
        singleton: {
            type: Boolean,
            default: true,
            unique: true,
            immutable: true
        },
        locationName: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        name: { type: String, required: true },
        globalLocationId: {
            type: mongoose.Schema.Types.ObjectId,
            index: true
        },
        baseUrl: { type: String },
        custodyLimits: {
            type: [custodyLimitSchema],
            validate: v => v.length > 0
        },
        globalSyncStatus: {
            type: String,
            enum: ["pending", "success", "failed"],
            default: "pending",
            index: true
        },
        globalSyncError: String,
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        }
    },
    {
        timestamps: true,
    }
);
const InmateLocation = mongoose.model('InmateLocation', inmateLocationSchema);
module.exports = InmateLocation
