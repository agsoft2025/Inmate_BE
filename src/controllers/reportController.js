const Inmate = require('../model/inmateModel');
const Financial = require('../model/financialModel');
const POSShoppingCart = require('../model/posShoppingCart');
const TuckShop = require("../model/tuckShopModel");
const logAudit = require("../utils/auditlogger");
const { Parser } = require('json2csv');
const moment = require('moment');
const { getVendorPurchaseSummary } = require('../service/storeInventoryService');
const tuckShopModel = require('../model/tuckShopModel');
const storeInventory = require('../model/storeInventory');

exports.quickStatistics = async (req, res) => {
    try {
        const tmpDate = new Date();
        const y = tmpDate.getFullYear();
        const m = tmpDate.getMonth();
        const todayStart = new Date(y, m, 1);
        todayStart.setHours(0, 0, 0, 0);
        let monthluyDeposits = 0;
        let monthlyWagesPaid = 0;

        const totalBalanceAgg = await Inmate.aggregate([
            { $group: { _id: null, totalBalance: { $sum: "$balance" } } }
        ]);
        const totalSystemBalance = totalBalanceAgg[0]?.totalBalance || 0;

        const todaysFinancialTransactions = await Financial.find({
            createdAt: { $gte: todayStart }
        });

        todaysFinancialTransactions.forEach(finance => {
            if (finance.type == 'wages') {
                monthlyWagesPaid += finance.wageAmount
            } else if (finance.type == 'deposit') {
                monthluyDeposits += finance.depositAmount
            }
        });


        res.status(200).json({ success: true, data: { totalSystemBalance, monthlyWagesPaid, monthluyDeposits }, message: "Inmate successfully fetched" });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
}

exports.intimateBalanceReport1 = async (req, res) => {
    try {
        const { startDate, endDate, dateRange, format = "json", inmateId } = req.body;

        if ((!dateRange && (!startDate || !endDate))) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        let fromDate, toDate = new Date();
        toDate.setHours(23, 59, 59, 999);

        if (dateRange) {
            fromDate = new Date();
            fromDate.setHours(0, 0, 0, 0);

            switch (dateRange.toLowerCase()) {
                case '7daysago':
                    fromDate.setDate(fromDate.getDate() - 7);
                    break;
                case '1monthago':
                    fromDate.setMonth(fromDate.getMonth() - 1);
                    break;
                case '3monthsago':
                    fromDate.setMonth(fromDate.getMonth() - 3);
                    break;
                default:
                    return res.status(400).json({ message: "Invalid dateRange format" });
            }
        } else {
            fromDate = new Date(startDate);
            toDate = new Date(endDate);
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(23, 59, 59, 999);
        }

        let inmates = [];

        if (inmateId) {
            const inmate = await Inmate.findOne({ inmateId }).lean();
            if (!inmate) {
                return res.status(404).json({ success: false, message: "Inmate not found" });
            }

            inmate.financialHistory = await Financial.find({ inmateId }).lean();
            inmate.shoppingHistory = await POSShoppingCart.find({ inmateId }).populate('products.productId').lean();

            inmate.createdAt = moment(inmate.createdAt).format('DD-MM-YYYY hh:mm:ss A');
            inmate.admissionDate = moment(inmate.admissionDate).format('DD-MM-YYYY');
            inmate.dateOfBirth = moment(inmate.dateOfBirth).format('DD-MM-YYYY');

            inmate.financialHistory.forEach(f => f.createdAt = moment(f.createdAt).format('DD-MM-YYYY hh:mm:ss A'));
            inmate.shoppingHistory.forEach(s => s.createdAt = moment(s.createdAt).format('DD-MM-YYYY hh:mm:ss A'));

            inmates.push(inmate);
        } else {
            inmates = await Inmate.find({
                createdAt: { $gte: fromDate, $lte: toDate }
            }).lean();

            if (!inmates.length) {
                return res.status(404).json({ success: false, message: "No inmates found" });
            }
        }

        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'GENERATE',
            targetModel: 'Intimate_Balance_Report',
            targetId: null,
            description: `Generated Intimate_Balance_Report`,
            changes: req.body
        });

        if (format === "csv") {
            let csvData = [];

            for (let inmate of inmates) {
                if (inmate.financialHistory && inmate.financialHistory.length) {
                    inmate.financialHistory.forEach(f => {
                        csvData.push({
                            inmateId: inmate.inmateId || '',
                            inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                            cellNumber: inmate.cellNumber || '',
                            balance: inmate.balance || 0,
                            dateOfBirth: inmate.dateOfBirth || '',
                            admissionDate: inmate.admissionDate || '',
                            crimeType: inmate.crimeType || '',
                            status: inmate.status || '',
                            recordType: 'Financial',
                            transaction: f.type.charAt(0).toUpperCase() + f.type.slice(1) || '',
                            transactionMode: f.depositType || '',
                            relationship: f.relationShipId || '',
                            transactionAmount: f.depositAmount || 0,
                            amount: f.depositAmount || f.wageAmount || 0,
                            transactionDate: f.createdAt || '',
                            productName: '',
                            quantity: '',
                            unitPrice: ''
                        });
                    });
                }

                if (inmate.shoppingHistory && inmate.shoppingHistory.length) {
                    inmate.shoppingHistory.forEach(s => {
                        s.products.forEach(p => {
                            csvData.push({
                                inmateId: inmate.inmateId || '',
                                inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                                cellNumber: inmate.cellNumber || '',
                                balance: inmate.balance || 0,
                                dateOfBirth: inmate.dateOfBirth || '',
                                admissionDate: inmate.admissionDate || '',
                                crimeType: inmate.crimeType || '',
                                status: inmate.status || '',
                                recordType: 'Shopping',
                                transaction: '',
                                transactionMode: '',
                                relationship: '',
                                amount: (p.productId?.price || 0) * (p.quantity || 0), // Item total
                                transactionDate: s.createdAt || '',
                                productName: p.productId?.itemName || '', // Ensure correct field name
                                quantity: p.quantity || 0,
                                unitPrice: p.productId?.price || 0
                            });
                        });
                    });
                }
                if ((!inmate.financialHistory || inmate.financialHistory.length === 0) &&
                    (!inmate.shoppingHistory || inmate.shoppingHistory.length === 0)) {
                    csvData.push({
                        inmateId: inmate.inmateId || '',
                        inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                        cellNumber: inmate.cellNumber || '',
                        balance: inmate.balance || 0,
                        dateOfBirth: inmate.dateOfBirth || '',
                        admissionDate: inmate.admissionDate || '',
                        crimeType: inmate.crimeType || '',
                        status: inmate.status || '',
                        recordType: 'Basic Info',
                        transaction: '',
                        transactionMode: '',
                        relationship: '',
                        amount: '',
                        transactionDate: '',
                        productName: '',
                        quantity: '',
                        unitPrice: ''
                    });
                }
            }

            const fields = [
                { label: 'Inmate ID', value: 'inmateId' },
                { label: 'Inmate Name', value: 'inmateName' },
                { label: 'Cell Number', value: 'cellNumber' },
                { label: 'Balance', value: 'balance' },
                { label: 'Date of Birth', value: 'dateOfBirth' },
                { label: 'Admission Date', value: 'admissionDate' },
                { label: 'Crime Type', value: 'crimeType' },
                { label: 'Status', value: 'status' },
                { label: 'Record Type', value: 'recordType' },
                { label: 'Transaction Type', value: 'transaction' },
                { label: 'Transaction Mode', value: 'transactionMode' },
                { label: 'Relationship', value: 'relationship' },
                { label: 'Amount', value: 'amount' },
                { label: 'Transaction Date', value: 'transactionDate' },
                { label: 'Product Name', value: 'productName' },
                { label: 'Quantity', value: 'quantity' },
                { label: 'Unit Price', value: 'unitPrice' }
            ];

            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(csvData);

            res.setHeader('Content-Disposition', 'attachment; filename=intimate_balance_report.csv');
            res.setHeader('Content-Type', 'text/csv');
            return res.status(200).end(csv);
        }

        res.status(200).json({ success: true, data: inmates, message: "Inmate(s) successfully fetched" });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

exports.intimateBalanceReport = async (req, res) => {
    try {
        const { startDate, endDate, dateRange, format = "json", inmateId } = req.body;

        if ((!dateRange && (!startDate || !endDate))) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        let fromDate, toDate = new Date();
        toDate.setHours(23, 59, 59, 999);

        if (dateRange) {
            fromDate = new Date();
            fromDate.setHours(0, 0, 0, 0);

            switch (dateRange.toLowerCase()) {
                case '7daysago':
                    fromDate.setDate(fromDate.getDate() - 7);
                    break;
                case '1monthago':
                    fromDate.setMonth(fromDate.getMonth() - 1);
                    break;
                case '3monthsago':
                    fromDate.setMonth(fromDate.getMonth() - 3);
                    break;
                default:
                    return res.status(400).json({ message: "Invalid dateRange format" });
            }
        } else {
            fromDate = new Date(startDate);
            toDate = new Date(endDate);
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(23, 59, 59, 999);
        }

        let inmates = [];

        if (inmateId) {
            const inmate = await Inmate.findOne({ inmateId }).lean();
            if (!inmate) {
                return res.status(404).json({ success: false, message: "Inmate not found" });
            }

            inmate.financialHistory = await Financial.find({ inmateId }).lean();
            inmate.shoppingHistory = await POSShoppingCart.find({ inmateId }).populate('products.productId').lean();

            inmate.createdAt = moment(inmate.createdAt).format('DD-MM-YYYY hh:mm:ss A');
            inmate.admissionDate = moment(inmate.admissionDate).format('DD-MM-YYYY');
            inmate.dateOfBirth = moment(inmate.dateOfBirth).format('DD-MM-YYYY');

            inmate.financialHistory.forEach(f => f.createdAt = moment(f.createdAt).format('DD-MM-YYYY hh:mm:ss A'));
            inmate.shoppingHistory.forEach(s => s.createdAt = moment(s.createdAt).format('DD-MM-YYYY hh:mm:ss A'));

            inmates.push(inmate);
        } else {
            inmates = await Inmate.find({
                createdAt: { $gte: fromDate, $lte: toDate }
            }).lean();
            if (!inmates.length) {
                return res.status(404).json({ success: false, message: "No inmates found" });
            }

            for (let inmate of inmates) {
                inmate.financialHistory = await Financial.find({ inmateId: inmate.inmateId }).lean();
                inmate.shoppingHistory = await POSShoppingCart.find({ inmateId: inmate.inmateId })
                    .populate('products.productId')
                    .lean();
                inmate.createdAt = moment(inmate.createdAt).format('DD-MM-YYYY hh:mm:ss A');
                inmate.admissionDate = moment(inmate.admissionDate).format('DD-MM-YYYY');
                inmate.dateOfBirth = moment(inmate.dateOfBirth).format('DD-MM-YYYY');

                inmate.financialHistory.forEach(f => f.createdAt = moment(f.createdAt).format('DD-MM-YYYY hh:mm:ss A'));
                inmate.shoppingHistory.forEach(s => s.createdAt = moment(s.createdAt).format('DD-MM-YYYY hh:mm:ss A'));
            }
        }

        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'GENERATE',
            targetModel: 'Intimate_Balance_Report',
            targetId: null,
            description: `Generated Intimate_Balance_Report`,
            changes: req.body
        });

        if (format === "csv") {
            let csvData = [];

            for (let inmate of inmates) {
                if (inmate.financialHistory && inmate.financialHistory.length) {
                    inmate.financialHistory.forEach(f => {
                        csvData.push({
                            inmateId: inmate.inmateId || '',
                            inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                            cellNumber: inmate.cellNumber || '',
                            balance: inmate.balance || 0,
                            dateOfBirth: inmate.dateOfBirth || '',
                            admissionDate: inmate.admissionDate || '',
                            crimeType: inmate.crimeType || '',
                            status: inmate.status || '',
                            recordType: 'Financial',
                            transaction: f.type.charAt(0).toUpperCase() + f.type.slice(1) || '',
                            transactionMode: f.depositType || '',
                            relationship: f.relationShipId || '',
                            transactionAmount: f.depositAmount || 0,
                            amount: f.depositAmount || f.wageAmount || 0,
                            transactionDate: f.createdAt || '',
                            productName: '',
                            quantity: '',
                            unitPrice: ''
                        });
                    });
                }

                if (inmate.shoppingHistory && inmate.shoppingHistory.length) {
                    inmate.shoppingHistory.forEach(s => {
                        s.products.forEach(p => {
                            csvData.push({
                                inmateId: inmate.inmateId || '',
                                inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                                cellNumber: inmate.cellNumber || '',
                                balance: inmate.balance || 0,
                                dateOfBirth: inmate.dateOfBirth || '',
                                admissionDate: inmate.admissionDate || '',
                                crimeType: inmate.crimeType || '',
                                status: inmate.status || '',
                                recordType: 'Shopping',
                                transaction: '',
                                transactionMode: '',
                                relationship: '',
                                amount: (p.productId?.price || 0) * (p.quantity || 0), // Item total
                                transactionDate: s.createdAt || '',
                                productName: p.productId?.itemName || '', // Ensure correct field name
                                quantity: p.quantity || 0,
                                unitPrice: p.productId?.price || 0
                            });
                        });
                    });
                }
                if ((!inmate.financialHistory || inmate.financialHistory.length === 0) &&
                    (!inmate.shoppingHistory || inmate.shoppingHistory.length === 0)) {
                    csvData.push({
                        inmateId: inmate.inmateId || '',
                        inmateName: (inmate.firstName || '') + ' ' + (inmate.lastName || ''),
                        cellNumber: inmate.cellNumber || '',
                        balance: inmate.balance || 0,
                        dateOfBirth: inmate.dateOfBirth || '',
                        admissionDate: inmate.admissionDate || '',
                        crimeType: inmate.crimeType || '',
                        status: inmate.status || '',
                        recordType: 'Basic Info',
                        transaction: '',
                        transactionMode: '',
                        relationship: '',
                        amount: '',
                        transactionDate: '',
                        productName: '',
                        quantity: '',
                        unitPrice: ''
                    });
                }
            }

            const fields = [
                { label: 'Inmate ID', value: 'inmateId' },
                { label: 'Inmate Name', value: 'inmateName' },
                { label: 'Cell Number', value: 'cellNumber' },
                { label: 'Balance', value: 'balance' },
                { label: 'Date of Birth', value: 'dateOfBirth' },
                { label: 'Admission Date', value: 'admissionDate' },
                { label: 'Crime Type', value: 'crimeType' },
                { label: 'Status', value: 'status' },
                { label: 'Record Type', value: 'recordType' },
                { label: 'Transaction Type', value: 'transaction' },
                { label: 'Transaction Mode', value: 'transactionMode' },
                { label: 'Relationship', value: 'relationship' },
                { label: 'Amount', value: 'amount' },
                { label: 'Transaction Date', value: 'transactionDate' },
                { label: 'Product Name', value: 'productName' },
                { label: 'Quantity', value: 'quantity' },
                { label: 'Unit Price', value: 'unitPrice' }
            ];

            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(csvData);

            res.setHeader('Content-Disposition', 'attachment; filename=intimate_balance_report.csv');
            res.setHeader('Content-Type', 'text/csv');
            return res.status(200).end(csv);
        }

        res.status(200).json({ success: true, data: inmates, message: "Inmate(s) successfully fetched" });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

exports.transactionSummaryReport = async (req, res) => {
    try {
        const { dateRange = "yearly", format = "json", department } = req.body;

        const now = new Date();
        let startDate;

        switch (dateRange.toLowerCase()) {
            case "daily":
                startDate = new Date(now.setHours(0, 0, 0, 0));
                break;
            case "weekly":
                startDate = new Date();
                startDate.setDate(now.getDate() - now.getDay());
                startDate.setHours(0, 0, 0, 0);
                break;
            case "monthly":
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case "yearly":
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: "Invalid dateRange. Use 'daily', 'weekly', 'monthly', or 'yearly'."
                });
        }

        // Fetch data
        const [posTransactions, financialTransactions] = await Promise.all([
            POSShoppingCart.find({ createdAt: { $gte: startDate } })
                .populate("products.productId")
                .lean(),
            Financial.find({ createdAt: { $gte: startDate } }).lean()
        ]);

        // Merge data
        const allTransactions = [
            ...posTransactions.map(tx => ({
                inmateId: tx.inmateId,
                transaction: "POS Purchase",
                source: "POS",
                amount: tx.totalAmount,
                type: "POS",
                createdAt: tx.createdAt
            })),
            ...financialTransactions.map(tx => ({
                inmateId: tx.inmateId,
                transaction: tx.transaction || "",
                source: "FINANCIAL",
                amount: tx.depositAmount || tx.wageAmount || 0,
                type: tx.type,
                createdAt: tx.createdAt
            }))
        ];

        // Sort transactions by newest first
        allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // CSV Export
        if (format === "csv") {
            const fields = ["inmateId", "transaction", "source", "amount", "type", "createdAt"];
            const parser = new Parser({ fields });
            const csv = parser.parse(allTransactions);

            res.setHeader("Content-Disposition", "attachment; filename=transaction_report.csv");
            res.setHeader("Content-Type", "text/csv");
            return res.status(200).send(csv);
        }

        // JSON Response
        return res.status(200).json({
            success: true,
            totalItems: allTransactions.length,
            transactions: allTransactions
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};

exports.tuckShopSalesReport = async (req, res) => {
    try {
        let { startDate, endDate, dateRange, format = 'json' } = req.body;

        if ((!dateRange && (!startDate || !endDate))) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        let fromDate, toDate = new Date();
        toDate.setHours(23, 59, 59, 999);

        if (dateRange) {
            fromDate = new Date();
            fromDate.setHours(0, 0, 0, 0);

            switch (dateRange) {
                case '7daysago':
                    fromDate.setDate(fromDate.getDate() - 6);
                    break;
                case '1monthago':
                    fromDate.setMonth(fromDate.getMonth() - 1);
                    break;
                case '3monthsago':
                    fromDate.setMonth(fromDate.getMonth() - 3);
                    break;
                default:
                    return res.status(400).json({ message: "Invalid dateRange format" });
            }
        } else {
            fromDate = new Date(startDate);
            toDate = new Date(endDate);
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(23, 59, 59, 999);
        }

        const transactions = await POSShoppingCart.find({
            createdAt: { $gte: fromDate, $lte: toDate }
        })
            .populate('products.productId', 'itemName price category')
            .lean();

        if (!transactions || transactions.length === 0) {
            return res.status(404).json({ success: false, message: "No transaction data found" });
        }

        const formattedData = [];
        transactions.forEach(tx => {
            tx.products.forEach(prod => {
                formattedData.push({
                    inmateId: tx.inmateId,
                    productName: prod.productId?.itemName || 'N/A',
                    category: prod.productId?.category || 'N/A',
                    quantity: prod.quantity,
                    price: prod.productId?.price || 0,
                    totalAmount: tx.totalAmount,
                    createdAt: moment(tx.createdAt).format('DD-MM-YYYY hh:mm:ss A')
                });
            });
        });

        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'GENERATE',
            targetModel: 'TuckShop_Transaction_Report',
            targetId: null,
            description: `Generated TuckShop_Transaction_Report`,
            changes: req.body
        });

        if (format === 'csv') {
            const fields = [
                'inmateId',
                'productName',
                'category',
                'quantity',
                'price',
                'totalAmount',
                'createdAt'
            ];

            const parser = new Parser({ fields });
            const csv = parser.parse(formattedData);

            res.setHeader('Content-Disposition', 'attachment; filename=tuckshop_transaction_report.csv');
            res.setHeader('Content-Type', 'text/csv');
            return res.status(200).end(csv);
        }

        return res.status(200).json({ success: true, data: formattedData });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

exports.wageDistributionReport = async (req, res) => {
    try {
        let { startDate, endDate, dateRange, format = 'json', department } = req.body;

        if (!department) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // --- Determine date range ---
        let fromDate, toDate = new Date();
        toDate.setHours(23, 59, 59, 999);

        if (dateRange) {
            fromDate = new Date();
            fromDate.setHours(0, 0, 0, 0);

            switch (dateRange) {
                case '7daysago':
                    fromDate.setDate(fromDate.getDate() - 6);
                    break;
                case '1monthago':
                    fromDate.setMonth(fromDate.getMonth() - 1);
                    break;
                case '3monthsago':
                    fromDate.setMonth(fromDate.getMonth() - 3);
                    break;
                default:
                    return res.status(400).json({ message: "Invalid dateRange value" });
            }
        } else if (startDate && endDate) {
            fromDate = new Date(startDate);
            toDate = new Date(endDate);
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(23, 59, 59, 999);
        } else {
            return res.status(400).json({ message: "Please provide either dateRange or startDate & endDate" });
        }

        // --- Query wage transactions ---
        const query = {
            createdAt: { $gte: fromDate, $lte: toDate },
            type: 'wages',
        };

        if (department !== "all") {
            query.workAssignId = department;
        }

        const items = await Financial.find(query).populate('workAssignId').lean();
        items.forEach(item => {
            item.createdAt = moment(item.createdAt).format('DD-MM-YYYY hh:mm:ss A');
            item.department = item.workAssignId?.name || '';
        });

        if (!items || items.length === 0) {
            return res.status(404).json({ success: false, message: "No wage data found in selected range" });
        }

        // --- Audit Log ---
        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'GENERATE',
            targetModel: 'Wage_Distribution_Report',
            targetId: null,
            description: `Generated Wage_Distribution_Report`,
            changes: req.body
        });

        // --- CSV output ---
        if (format === 'csv') {

            const fields = [
                { label: 'Inmate ID', value: 'inmateId' },
                { label: 'Wage Type', value: 'transaction' },
                { label: 'Transaction Type', value: 'type' },
                { label: 'Department', value: 'department' },
                { label: 'Worked Hours', value: 'hoursWorked' },
                { label: 'Wage Amount', value: 'wageAmount' },
                { label: 'Transaction Time', value: 'createdAt' },
                { label: 'Status', value: 'status' },
            ];

            const parser = new Parser({ fields });
            const csv = parser.parse(items);

            res.setHeader('Content-Disposition', 'attachment; filename=wage_distribution_report.csv');
            res.setHeader('Content-Type', 'text/csv');
            return res.status(200).end(csv);
        }

        // --- Default JSON response ---
        res.status(200).json({ success: true, data: items });

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
}

exports.inventoryStockHistoryReport1 = async (req, res) => {
  try {
    let { startDate, endDate, dateRange, format = 'json' } = req.body;

    // --- Validate input ---
    if (!dateRange && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either dateRange or startDate & endDate'
      });
    }

    // --- Determine time window ---
    let fromDate, toDate = new Date();
    toDate.setHours(23, 59, 59, 999);

    if (dateRange) {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);

      switch (dateRange.toLowerCase()) {
        case '7daysago':
          fromDate.setDate(fromDate.getDate() - 6);
          break;
        case '1monthago':
          fromDate.setMonth(fromDate.getMonth() - 1);
          break;
        case '3monthsago':
          fromDate.setMonth(fromDate.getMonth() - 3);
          break;
        default:
          return res.status(400).json({ success: false, message: 'Invalid dateRange value' });
      }
    } else {
      fromDate = new Date(startDate);
      toDate = new Date(endDate);
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);
    }

    // --- Fetch inventory data (you can add your own filters inside getVendorPurchaseSummary) ---
    const inventoryData = await getVendorPurchaseSummary({
      ...req.query,
      fromDate,
      toDate
    });

    if (!inventoryData || inventoryData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No inventory stock history found in selected range'
      });
    }
    // Format each record (example fields—adjust to match your schema)
    const formatted = inventoryData.map(item => ({
      itemName: item.itemName,
      category: item.category,
      stockQuantity: item.stockQuantity,
      price: item.price,
      totalQty: item.totalQty,
      status: item.status,
      updatedAt: moment(item.updatedAt).format('DD-MM-YYYY hh:mm:ss A')
    }));

    const extractedItems = inventoryData.flatMap(entry =>
  entry.items.map(itm =>
    ({
    vendorId: entry.vendorPurchase._id,
    invoiceNo: entry.vendorPurchase.invoiceNo,
    vendorName: entry.vendorPurchase.vendorName,
    vendorValue: entry.vendorPurchase.vendorValue,
    status: entry.vendorPurchase.status,
    date: entry.vendorPurchase.date,
    itemName: itm.itemName,
    quantity: itm.stock,
    price: itm.sellingPrice
  })
  )
);

    // --- CSV export if requested ---
    if (format === 'csv') {
      const fields = [
        'itemName',
        'category',
        'stockQuantity',
        'price',
        'totalQty',
        'status',
        'updatedAt'
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(formatted);

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=inventory_stock_history.csv'
      );
      res.setHeader('Content-Type', 'text/csv');
      return res.status(200).end(csv);
    }

    // --- Default JSON ---
    return res.status(200).json({
      success: true,
      totalItems: formatted.length,
      data: formatted
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.inventoryStockHistoryReport = async (req, res) => {
  try {
    const {
      page,
      limit,
      sortField = "createdAt",
      sortOrder = "desc",
      itemName,
      category,
      status,
      startDate,
      endDate,
      dateRange,
      format = 'json'
    } = req.body;

    // --- Build filter ---
    const filter = {};
    if (itemName) filter.itemName = { $regex: itemName, $options: "i" };
    if (category) filter.category = { $regex: `^${category}$`, $options: "i" };
    if (status) filter.status = status;

    // --- Handle date filtering ---
    if (startDate || endDate || dateRange) {
      let fromDate, toDate = new Date();
      toDate.setHours(23, 59, 59, 999);

      if (dateRange) {
        fromDate = new Date();
        fromDate.setHours(0, 0, 0, 0);
        switch (dateRange.toLowerCase()) {
          case "7daysago":
            fromDate.setDate(fromDate.getDate() - 6);
            break;
          case "1monthago":
            fromDate.setMonth(fromDate.getMonth() - 1);
            break;
          case "3monthsago":
            fromDate.setMonth(fromDate.getMonth() - 3);
            break;
          default:
            return res.status(400).json({ success: false, message: "Invalid dateRange value" });
        }
      } else {
        fromDate = new Date(startDate);
        toDate = new Date(endDate);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
      }

      filter.updatedAt = { $gte: fromDate, $lte: toDate };
    }

    // --- Base query ---
    const query = tuckShopModel.find(filter);

    // --- Sorting ---
    const sort = {};
    sort[sortField] = sortOrder.toLowerCase() === "asc" ? 1 : -1;
    query.sort(sort);

    // --- Pagination ---
    let paginated = false;
    let pageNum = 1, limitNum = 0;
    if (page && limit) {
      pageNum = parseInt(page) || 1;
      limitNum = parseInt(limit) || 10;
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      paginated = true;
    }

    // --- Fetch items ---
    const items = await query.exec();
    if (!items.length) {
      return res.status(200).json({ success: true, message: "No data found", data: [] });
    }

    // --- Compute totalQty from storeItemModel ---
    const itemNos = items.map(i => i.itemNo);
    const storeTotals = await storeInventory.aggregate([
      { $match: { itemNo: { $in: itemNos } } },
      { $group: { _id: "$itemNo", totalStock: { $sum: "$stock" } } },
    ]);

    const storeMap = new Map();
    storeTotals.forEach(s => storeMap.set(s._id, s.totalStock));

    const withTotalQty = items.map(item => ({
      ...item.toObject(),
      totalQty: item.stockQuantity + (storeMap.get(item.itemNo) || 0),
      updatedAt: moment(item.updatedAt).format('DD-MM-YYYY hh:mm:ss A')
    }));

    // --- Total count ---
    const totalCount = await tuckShopModel.countDocuments(filter);

    // --- CSV export ---
    if (format === 'csv') {
      const fields = [
        'itemName',
        'price',
        'stockQuantity',
        'totalQty',
        'category',
        'itemNo',
        'status',
        'createdAt',
        'updatedAt'
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(withTotalQty);

      res.setHeader('Content-Disposition', 'attachment; filename=inventory_stock_history.csv');
      res.setHeader('Content-Type', 'text/csv');
      return res.status(200).end(csv);
    }

    // --- Default JSON response ---
    if (paginated) {
      return res.status(200).json({
        success: true,
        page: pageNum,
        limit: limitNum,
        totalCount,
        data: withTotalQty
      });
    }

    return res.status(200).json({
      success: true,
      totalCount,
      data: withTotalQty
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};