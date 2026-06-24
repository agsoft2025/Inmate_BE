const Inmate = require('../model/inmateModel');
const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const TuckShop = require('../model/tuckShopModel');
const inmateModel = require('../model/inmateModel');
const { requireLocationFilter } = require("../utils/locationAccess");

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

module.exports = { getDashboardData };
