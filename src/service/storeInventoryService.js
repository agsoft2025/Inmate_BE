// services/storeInventoryService.js
const mongoose = require("mongoose");
const StoreItem = require("../model/storeInventory");

exports.getVendorPurchaseSummary1 = async (query) => {
  const {
    search, 
    startDate,
    endDate,
    sortField = "vendorPurchase.date",
    sortOrder = -1,
    page = 1,
    limit = 10,
  } = query;

  const pageNum  = Number(page)  || 1;
  const limitNum = Number(limit) || 10;

  // Date range filter
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate)   dateFilter.$lte = new Date(endDate);

  const pipeline = [
    {
      // Optional match for itemName if search provided
      $match: search
        ? { itemName: { $regex: search, $options: "i" } }
        : {}
    },

    {
      $lookup: {
        from: "vendorpurchases",
        localField: "vendorPurchase",
        foreignField: "_id",
        as: "vendorPurchase",
      },
    },
    { $unwind: "$vendorPurchase" },

    {
      // Combined search on invoiceNo OR vendorName OR itemName
      $match: {
        ...(search && {
          $or: [
            { "vendorPurchase.invoiceNo": { $regex: search, $options: "i" } },
            { "vendorPurchase.vendorName": { $regex: search, $options: "i" } },
            { itemName: { $regex: search, $options: "i" } }
          ],
        }),
        ...(Object.keys(dateFilter).length && {
          "vendorPurchase.date": dateFilter,
        }),
      },
    },

    {
      $group: {
        _id: "$vendorPurchase._id",
        vendorPurchase: { $first: "$vendorPurchase" },
        totalAmount: { $sum: "$amount" },
        items: {
          $push: {
            _id: "$_id",
            itemName: "$itemName",
            itemNo: "$itemNo",
            amount: "$amount",
            stock: "$stock",
            sellingPrice: "$sellingPrice",
            category: "$category",
            status: "$status",
            createdAt: "$createdAt",
            updatedAt: "$updatedAt",
          },
        },
      },
    },

    { $project: { _id: 0, vendorPurchase: 1, totalAmount: 1, items: 1 } },

    { $sort: { [sortField]: sortOrder } },
    { $skip: (pageNum - 1) * limitNum },
    { $limit: limitNum },
  ];

  return await StoreItem.aggregate(pipeline);
};

exports.getVendorPurchaseSummary = async (query) => {
  const {
    search, 
    startDate,
    endDate,
    sortField = "vendorPurchase.date",
    sortOrder = -1,
    page = 1,
    limit = 10,
  } = query;

  const pageNum  = Number(page)  || 1;
  const limitNum = Number(limit) || 10;

  // Date range filter
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate)   dateFilter.$lte = new Date(endDate);

  const pipeline = [
    {
      // Optional match for itemName if search provided
      $match: search
        ? { itemName: { $regex: search, $options: "i" } }
        : {}
    },

    {
      $lookup: {
        from: "vendorpurchases",
        localField: "vendorPurchase",
        foreignField: "_id",
        as: "vendorPurchase",
      },
    },
    { $unwind: "$vendorPurchase" },

    {
      // Combined search on invoiceNo OR vendorName OR itemName
      $match: {
        ...(search && {
          $or: [
            { "vendorPurchase.invoiceNo": { $regex: search, $options: "i" } },
            { "vendorPurchase.vendorName": { $regex: search, $options: "i" } },
            { itemName: { $regex: search, $options: "i" } }
          ],
        }),
        ...(Object.keys(dateFilter).length && {
          "vendorPurchase.date": dateFilter,
        }),
      },
    },

    {
      $group: {
        _id: "$vendorPurchase._id",
        vendorPurchase: { $first: "$vendorPurchase" },
        totalAmount: { $sum: "$amount" },
        items: {
          $push: {
            _id: "$_id",
            itemName: "$itemName",
            itemNo: "$itemNo",
            amount: "$amount",
            stock: "$stock",
            sellingPrice: "$sellingPrice",
            category: "$category",
            status: "$status",
            createdAt: "$createdAt",
            updatedAt: "$updatedAt",
          },
        },
      },
    },

    { $project: { _id: 0, vendorPurchase: 1, totalAmount: 1, items: 1 } },

    { $sort: { [sortField]: sortOrder } },
    { $skip: (pageNum - 1) * limitNum },
    { $limit: limitNum },
  ];
  return await StoreItem.aggregate(pipeline);
};





