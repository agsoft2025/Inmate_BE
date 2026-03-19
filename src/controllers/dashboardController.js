const Inmate = require('../model/inmateModel');
const POSShoppingCart = require('../model/posShoppingCart');
const Financial = require('../model/financialModel');
const TuckShop = require('../model/tuckShopModel');
const inmateModel = require('../model/inmateModel');

const getDashboardData = async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 1. Total inmates
        const totalInmates = await Inmate.countDocuments();

        // 2. Total balance across all inmates
        const totalBalanceAgg = await Inmate.aggregate([
            { $group: { _id: null, totalBalance: { $sum: "$balance" } } }
        ]);
        const totalBalance = totalBalanceAgg[0]?.totalBalance || 0;

        // 3. Today's POS transactions
        const todaysPOSTransactions = await POSShoppingCart.find({
            createdAt: { $gte: todayStart }
        });

        // 4. Total POS sales today
        const totalSalesToday = todaysPOSTransactions.reduce((sum, trx) => sum + trx.totalAmount, 0);

        // 5. Tuckshop data
        const tuckItems = await TuckShop.find();
        const tuckshopStockValue = tuckItems.reduce((sum, item) => sum + (item.price * item.stockQuantity), 0);

        // 6. Low balance inmates
        const lowBalanceThreshold = 100;
        const lowBalanceInmates = await Inmate.find({ balance: { $lt: lowBalanceThreshold } });

        // 7. Today's Financial transactions
        const todaysFinancialTransactions = await Financial.find({
            createdAt: { $gte: todayStart }
        });

        // 8. Total wages + deposits today
        const totalFinancialToday = todaysFinancialTransactions.reduce((sum, trx) => {
            return sum + (trx.depositAmount || 0) + (trx.wageAmount || 0);
        }, 0);

        // 9. Recent POS transactions
        const recentPOSTransactions = await POSShoppingCart.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('products.productId');

        // 10. Recent Financial transactions
        const recentFinancialTransactions = await Financial.find()
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

                return {
                    _id: trx._id,
                    type: 'POS',
                    totalAmount: trx.totalAmount,
                    createdAt: trx.createdAt,
                    details: {
                        ...trxObj,
                        custodyType: inmate?.custodyType || null
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
