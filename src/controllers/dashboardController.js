const Inmate = require('../model/inmateModel');
const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const TuckShop = require('../model/tuckShopModel');
const inmateModel = require('../model/inmateModel');
const { requireLocationFilter } = require("../utils/locationAccess");
const logAudit = require('../utils/auditlogger');

const MAX_OUTREACH_MESSAGE_LENGTH = 500;

const getDashboardData = async (req, res) => {
    try {
        const locationFilter = req.locationFilter ?? requireLocationFilter(req.user);
        if (!locationFilter) return;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 1. Total inmates
        const totalInmates = await Inmate.countDocuments(locationFilter);

        // 2. Total balance across all inmates
        const totalBalanceAggPipeline = [
            { $match: locationFilter },
            { $group: { _id: null, totalBalance: { $sum: "$balance" } } }
        ];
        const totalBalanceAgg = await Inmate.aggregate(totalBalanceAggPipeline);
        const totalBalance = totalBalanceAgg[0]?.totalBalance || 0;

        const locationId = locationFilter.location_id;
        const posLocationFilter = locationId ? { location_id: locationId } : {};

        // build list of inmate IDs for the current location
        const allowedInmates = await Inmate.find(locationFilter).select('inmateId').lean();
        const allowedInmateIds = allowedInmates.map(i => i.inmateId);

        // 3. Today's POS transactions
        const posDateFilter = { $gte: todayStart };
        const todaysPOSFilter = {
            ...posLocationFilter,
            $or: [
                { createdAt: posDateFilter },
                { reversedAt: posDateFilter }
            ]
        };
        const todaysPOSTransactions = await POSShoppingCart.find(todaysPOSFilter);

        // 4. Total POS sales today
        const totalSalesToday = todaysPOSTransactions.reduce((sum, trx) => {
            return sum + (trx.is_reversed ? -trx.totalAmount : trx.totalAmount);
        }, 0);

        // 5. Tuckshop data
        const tuckItems = await TuckShop.find(posLocationFilter);
        const tuckshopStockValue = tuckItems.reduce((sum, item) => sum + (item.price * item.stockQuantity), 0);

        // 6. Low balance inmates (enriched with an average daily spend rate
        //    so the frontend can estimate "days to zero" for each inmate)
        const lowBalanceThreshold = 100;
        const lowBalanceInmatesRaw = await Inmate.find({
            ...locationFilter,
            balance: { $lt: lowBalanceThreshold }
        }).lean();

        const SPEND_LOOKBACK_DAYS = 30;
        const spendWindowStart = new Date(todayStart);
        spendWindowStart.setDate(spendWindowStart.getDate() - SPEND_LOOKBACK_DAYS);

        const lowBalanceInmateIds = lowBalanceInmatesRaw.map(i => i.inmateId);

        // Sum actual (non-reversed) POS spend per inmate over the lookback window
        const spendAgg = lowBalanceInmateIds.length
            ? await POSShoppingCart.aggregate([
                {
                    $match: {
                        inmateId: { $in: lowBalanceInmateIds },
                        is_reversed: { $ne: true },
                        createdAt: { $gte: spendWindowStart }
                    }
                },
                {
                    $group: { _id: "$inmateId", totalSpent: { $sum: "$totalAmount" } }
                }
            ])
            : [];

        const spendByInmateId = spendAgg.reduce((acc, row) => {
            acc[row._id] = row.totalSpent || 0;
            return acc;
        }, {});

        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const lowBalanceInmates = lowBalanceInmatesRaw.map(inmate => {
            const totalSpent = spendByInmateId[inmate.inmateId] || 0;

            // Don't average spend over a window longer than the inmate has
            // actually been in the system, or a recently admitted inmate's
            // rate would be underestimated.
            const admissionDate = inmate.admissionDate ? new Date(inmate.admissionDate) : null;
            const daysSinceAdmission = admissionDate
                ? Math.floor((todayStart - admissionDate) / MS_PER_DAY)
                : SPEND_LOOKBACK_DAYS;
            const spendWindowDays = Math.max(1, Math.min(SPEND_LOOKBACK_DAYS, daysSinceAdmission || SPEND_LOOKBACK_DAYS));

            const avgDailySpend = totalSpent > 0 ? totalSpent / spendWindowDays : 0;

            return {
                ...inmate,
                avgDailySpend: Math.round(avgDailySpend * 100) / 100
            };
        });

        // 7. Today's Financial transactions
        const financialTodayFilter = {
            createdAt: { $gte: todayStart },
            ...(allowedInmateIds.length ? { inmateId: { $in: allowedInmateIds } } : { _id: null })
        };
        const todaysFinancialTransactions = await Financial.find(financialTodayFilter);

        // 8. Total wages + deposits today
        const totalFinancialToday = todaysFinancialTransactions.reduce((sum, trx) => {
            return sum + (trx.depositAmount || 0) + (trx.wageAmount || 0);
        }, 0);

        // 9. Recent POS transactions
        const recentPOSFilter = {
            ...posLocationFilter
        };
        const recentPOSTransactions = await POSShoppingCart.find(recentPOSFilter)
            .sort({ updatedAt: -1 })
            .limit(10)
            .populate('products.productId');

        // 10. Recent Financial transactions
        const recentFinancialFilter = allowedInmateIds.length
            ? { inmateId: { $in: allowedInmateIds } }
            : { _id: null };
        const recentFinancialTransactions = await Financial.find(recentFinancialFilter)
            .sort({ createdAt: -1 })
            .limit(10);

        // 11. Combine and sort recent transactions

        const formattedPOS = await Promise.all(
            recentPOSTransactions.map(async (trx) => {
                const inmate = await inmateModel.findOne(
                    { inmateId: trx.inmateId },
                    { custodyType: 1, _id: 0 }
                );

                const trxObj = trx.toObject ? trx.toObject() : trx; // convert Mongoose doc to plain object
                const eventDate = trx.is_reversed
                    ? trx.reversedAt || trx.updatedAt || trx.createdAt
                    : trx.createdAt;

                return {
                    _id: trx._id,
                    type: trx.is_reversed ? 'POS (Reversed)' : 'POS',
                    totalAmount: trx.is_reversed ? -Math.abs(trx.totalAmount) : trx.totalAmount,
                    createdAt: eventDate,
                    details: {
                        ...trxObj,
                        custodyType: inmate?.custodyType || null,
                        is_reversed: Boolean(trx.is_reversed),
                        eventDate,
                        status: trx.is_reversed ? "Transaction reversed" : "Completed"
                    }
                };
            })
        );

        const formattedFinancial = recentFinancialTransactions.map(trx => ({
            _id: trx._id,
            type: 'Financial',
            totalAmount: trx.wageAmount || trx.depositAmount || 0,
            createdAt: trx.createdAt,
            details: trx
        }));

        const combinedRecentTransactions = [...formattedPOS, ...formattedFinancial]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);

        // Final response
        res.status(200).json({
            success: true,
            data: {
                totalInmates,
                totalBalance,
                todayTransactionCount: todaysPOSTransactions.length + todaysFinancialTransactions.length,
                totalSalesToday,
                lowBalanceInmates,
                tuckshop: {
                    totalItems: tuckItems.length,
                    stockValue: tuckshopStockValue
                },
                financial: {
                    todayFinancialCount: todaysFinancialTransactions.length,
                    totalFinancialToday
                },
                recentTransactions: combinedRecentTransactions
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to load dashboard data",
            error: error.message
        });
    }
};

// Predictive Low-Balance Outreach: records a staff-drafted, staff-approved
// outreach message for a low-balance inmate. A human must review/edit the
// message and click "Send" in the UI before this endpoint is ever called -
// nothing here is triggered automatically.
//
// NOTE: This codebase does not currently have a freeform-text messaging
// channel wired up (the existing WhatsApp integration in sms.service.js only
// supports a single pre-approved OTP template, not arbitrary staff-authored
// text). Until a real SMS/WhatsApp provider is connected, sending records an
// audited outreach entry that location staff can act on/follow up with.
const sendLowBalanceOutreach = async (req, res) => {
    try {
        const locationFilter = req.locationFilter ?? requireLocationFilter(req.user);
        if (!locationFilter) return;

        const { inmateId, message } = req.body;

        if (!inmateId || typeof inmateId !== 'string' || !inmateId.trim()) {
            return res.status(400).json({ success: false, message: "inmateId is required" });
        }

        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        if (!trimmedMessage) {
            return res.status(400).json({ success: false, message: "Outreach message cannot be empty" });
        }
        if (trimmedMessage.length > MAX_OUTREACH_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Outreach message must be ${MAX_OUTREACH_MESSAGE_LENGTH} characters or fewer`
            });
        }

        const inmate = await Inmate.findOne({ ...locationFilter, inmateId: inmateId.trim() });
        if (!inmate) {
            return res.status(404).json({ success: false, message: "Inmate not found" });
        }

        await logAudit({
            userId: req.user?.id,
            username: req.user?.username,
            action: 'CREATE',
            targetModel: 'LowBalanceOutreach',
            targetId: inmate._id,
            description: `Low-balance outreach message sent for inmate ${inmate.inmateId} (${inmate.firstName} ${inmate.lastName})`,
            changes: {
                message: trimmedMessage,
                balanceAtSend: inmate.balance
            }
        });

        res.status(200).json({
            success: true,
            message: "Outreach message sent",
            data: {
                inmateId: inmate.inmateId,
                message: trimmedMessage,
                sentAt: new Date()
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to send outreach message",
            error: error.message
        });
    }
};

module.exports = { getDashboardData, sendLowBalanceOutreach };
