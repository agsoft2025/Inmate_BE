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

const razorpaySchema = new mongoose.Schema({
    keyId: {
        type: String,
        trim: true
    },
    keySecret: {
        type: String,
        trim: true,
        select: false
    },
    webhookSecret: {
        type: String,
        trim: true,
        select: false
    },
    accountNumber: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const inmateLocationSchema = new mongoose.Schema(
    {
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
        razorpay:razorpaySchema,
        globalSyncStatus: {
            type: String,
            enum: ["pending", "success", "failed"],
            default: "pending",
            index: true
        },
        globalSyncError: String,
        // Optional: a location mirrored down from the Global panel has no local
        // creator yet (the Super Admin attaches an admin afterwards). Locally
        // created locations still always set these.
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        }
    },
    {
        timestamps: true,
    }
);
const InmateLocation = mongoose.model('InmateLocation', inmateLocationSchema);
module.exports = InmateLocation
