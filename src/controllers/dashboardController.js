const Inmate = require('../model/inmateModel');
const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const TuckShop = require('../model/tuckShopModel');
const inmateModel = require('../model/inmateModel');
const { requireLocationFilter } = require("../utils/locationAccess");
const logAudit = require('../utils/auditlogger');

const MAX_OUTREACH_MESSAGE_LENGTH = 500;

// Week-over-week delta: builds a { percent, direction } object comparing a
// current stat-card value against its value from the same point last week.
// Returns null when there isn't a meaningful baseline to compare against
// (missing data), so the frontend can gracefully hide the trend badge.
// direction is 'up' | 'down' | 'flat'. When the baseline was zero and the
// current value is non-zero, percent is null (a % change from zero is
// undefined) but direction is still reported as 'up'/'down'.
function buildWeekOverWeek(current, previous) {
    if (current === null || current === undefined || previous === null || previous === undefined) {
        return null;
    }
    if (previous === 0) {
        if (current === 0) return { percent: 0, direction: 'flat' };
        return { percent: null, direction: current > 0 ? 'up' : 'down' };
    }
    const rawPercent = ((current - previous) / Math.abs(previous)) * 100;
    if (rawPercent === 0) return { percent: 0, direction: 'flat' };
    return {
        percent: Math.round(Math.abs(rawPercent) * 10) / 10,
        direction: rawPercent > 0 ? 'up' : 'down'
    };
}

const getDashboardData = async (req, res) => {
    try {
        const locationFilter = req.locationFilter ?? requireLocationFilter(req.user);
        if (!locationFilter) return;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const now = new Date();

        // How far into "today" we currently are - used so the "same time
        // last week" comparison window covers an equal-length period rather
        // than comparing a partial today against a full day last week.
        const elapsedMs = now.getTime() - todayStart.getTime();
        const weekAgoStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekAgoSameElapsed = new Date(weekAgoStart.getTime() + elapsedMs);

        // 1. Total inmates
        const totalInmates = await Inmate.countDocuments(locationFilter);

        // 1b. Total inmates as of a week ago (for the week-over-week badge)
        const totalInmatesWeekAgo = await Inmate.countDocuments({
            ...locationFilter,
            createdAt: { $lt: weekAgoStart }
        });

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

        // 2b. Estimated wallet balance a week ago, for the week-over-week
        // badge. There's no stored historical balance snapshot, so this is
        // reconstructed from the last 7 days of balance-affecting activity:
        // non-reversed POS spend debits the balance (a reversal within the
        // window credits it back), deposits/wages credit it, withdrawals
        // debit it. This is a best-effort estimate, not an exact figure.
        const last7DaysPOSFilter = {
            ...posLocationFilter,
            $or: [
                { createdAt: { $gte: weekAgoStart } },
                { reversedAt: { $gte: weekAgoStart } }
            ]
        };
        const last7DaysPOSTransactions = await POSShoppingCart.find(last7DaysPOSFilter);
        const netPOSDebitLast7Days = last7DaysPOSTransactions.reduce((sum, trx) => {
            return sum + (trx.is_reversed ? -trx.totalAmount : trx.totalAmount);
        }, 0);

        const last7DaysFinancialFilter = {
            createdAt: { $gte: weekAgoStart },
            ...(allowedInmateIds.length ? { inmateId: { $in: allowedInmateIds } } : { _id: null })
        };
        const last7DaysFinancialTransactions = await Financial.find(last7DaysFinancialFilter);
        const netFinancialCreditLast7Days = last7DaysFinancialTransactions.reduce((sum, trx) => {
            const depositEffect = trx.type === 'withdrawal' ? -(trx.depositAmount || 0) : (trx.depositAmount || 0);
            return sum + depositEffect + (trx.wageAmount || 0);
        }, 0);

        const totalBalanceWeekAgo = totalBalance + netPOSDebitLast7Days - netFinancialCreditLast7Days;

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

        // 6. Low balance inmates
        const lowBalanceThreshold = 100;
        const lowBalanceInmates = await Inmate.find({
            ...locationFilter,
            balance: { $lt: lowBalanceThreshold }
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

        // 8b. Same time-of-day window, exactly a week earlier - used to
        // compare "today so far" against "the same point last week" for the
        // Today's Transactions / Today's Sales week-over-week badges.
        const lastWeekWindowFilter = { $gte: weekAgoStart, $lt: weekAgoSameElapsed };
        const lastWeekPOSFilter = {
            ...posLocationFilter,
            $or: [
                { createdAt: lastWeekWindowFilter },
                { reversedAt: lastWeekWindowFilter }
            ]
        };
        const lastWeekPOSTransactions = await POSShoppingCart.find(lastWeekPOSFilter);
        const lastWeekSalesTotal = lastWeekPOSTransactions.reduce((sum, trx) => {
            return sum + (trx.is_reversed ? -trx.totalAmount : trx.totalAmount);
        }, 0);

        const lastWeekFinancialFilter = {
            createdAt: lastWeekWindowFilter,
            ...(allowedInmateIds.length ? { inmateId: { $in: allowedInmateIds } } : { _id: null })
        };
        const lastWeekFinancialTransactions = await Financial.find(lastWeekFinancialFilter);
        const lastWeekTransactionCount = lastWeekPOSTransactions.length + lastWeekFinancialTransactions.length;

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

        const todayTransactionCount = todaysPOSTransactions.length + todaysFinancialTransactions.length;

        // 12. Week-over-week deltas for the 4 summary stat cards. Each is
        // null when there's no meaningful baseline (e.g. brand-new location
        // with nothing recorded a week ago) - the frontend hides the badge
        // in that case rather than showing a misleading percentage.
        const weekOverWeek = {
            totalInmates: buildWeekOverWeek(totalInmates, totalInmatesWeekAgo),
            totalBalance: buildWeekOverWeek(totalBalance, totalBalanceWeekAgo),
            todayTransactionCount: buildWeekOverWeek(todayTransactionCount, lastWeekTransactionCount),
            totalSalesToday: buildWeekOverWeek(totalSalesToday, lastWeekSalesTotal)
        };

        // Final response
        res.status(200).json({
            success: true,
            data: {
                totalInmates,
                totalBalance,
                todayTransactionCount,
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
                recentTransactions: combinedRecentTransactions,
                weekOverWeek
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
// outreach message for a low-balance inmate. The app does not currently have
// a general-purpose messaging provider wired here, so "send" means the
// outreach was validated and written to the audit trail for staff follow-up.
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
