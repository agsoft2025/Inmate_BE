const vendorPurchaseModel = require("../model/vendorPurchase")
const storeItemModel = require("../model/storeInventory")
const tuckShopModel = require("../model/tuckShopModel")
const CanteenInventory = require("../model/canteenInventory")
const { getVendorPurchaseSummary } = require("../service/storeInventoryService")
const { buildLocationFilter } = require("../utils/locationAccess");
const mongoose = require("mongoose");
const { logError } = require("../utils/safeLog");

const requireLocationId = (req, res) => {
  const locationId = req.user?.location_id;
  if (!locationId) {
    res.status(400).json({ success: false, message: "Location is required" });
    return null;
  }
  return locationId;
};


exports.addInventoryStock = async (req, res) => {
  try {
    const locationId = requireLocationId(req, res);
    if (!locationId) return;

    const {
      date,
      invoiceNo,
      vendorName,
      vendorValue,
      gatePassNumber,
      contact,
      status,
      storeItems
    } = req.body;

    if (!date || !invoiceNo || !vendorName || !vendorValue || !Array.isArray(storeItems) || storeItems.length === 0) {
      return res.status(400).json({ success: false, message: "Missing required fields or invalid storeItems" });
    }

    const locationFilter = buildLocationFilter(req.user);

    const isExistInvoice = await vendorPurchaseModel.findOne({ invoiceNo, ...locationFilter });
    if (isExistInvoice) {
      return res.status(400).json({ success: false, message: "Invoice already exists" });
    }

    const vendorPurchase = await vendorPurchaseModel.create({
      date,
      invoiceNo,
      gatePassNumber,
      vendorName,
      vendorValue,
      contact,
      status,
      location_id: locationId
    });

    const storeItemsPayload = storeItems.map(item => ({
      vendorPurchase: vendorPurchase._id,
      itemName: item.itemName,
      itemNo: item.itemNo,
      amount: item.amount,
      stock: item.stock,
      sellingPrice: item.sellingPrice,
      category: item.category,
      status: item.status,
      location_id: locationId
    }));

    const createdStoreItems = await storeItemModel.insertMany(storeItemsPayload);

    await Promise.all(
      createdStoreItems.map((storeItem) =>
        CanteenInventory.updateOne(
          { itemNo: storeItem.itemNo, location_id: locationId },
          {
            $set: {
              storeItem: storeItem._id,
              currentStock: 0,
              status: "Active",
              location_id: locationId
            },
            $setOnInsert: {
              totalStock: 0
            }
          },
          { upsert: true }
        )
      )
    );

    const bulkOps = storeItems.map(item => ({
      updateOne: {
        filter: { itemNo: item.itemNo, ...locationFilter },
        update: {
          $setOnInsert: {
            itemName: item.itemName,
            price: item.sellingPrice,
            stockQuantity: 0,
            category: item.category,
            status: item.status,
            location_id: locationId
          }
        },
        upsert: true
      }
    }));

    await tuckShopModel.bulkWrite(bulkOps);

    return res.status(201).json({
      success: true,
      message: "Inventory added successfully",
      data: {
        vendorPurchase,
        storeItems: createdStoreItems
      }
    });
  } catch (error) {
    logError("INVENTORY ERROR:", error);
    return res.status(400).json({ success: false, message: error.message || "Inventory creation failed" });
  }
};


exports.getInventoryStock = async (req, res) => {
  try {
    const locationFilter = buildLocationFilter(req.user);
    const result = await getVendorPurchaseSummary(req.query, locationFilter)
    if (result.length === 0) {
      return res.status(200).send({ success: false, data: result, message: "inventory stock not found" })
    }
    return res.status(200).send({ success: true, data: result, message: "inventory stock fetched successfully" })
  } catch (error) {
    return res.status(500).send({ success: false, message: "internal server down", error: error.message })
  }
}

exports.getInventoryStockById = async (req, res) => {
  try {
    const { id } = req.params
    const locationFilter = buildLocationFilter(req.user);
    const result = await storeItemModel.findOne({ _id: id, ...locationFilter }).populate("vendorPurchase")
    if (!result) {
      return res.status(404).send({ success: false, message: "inventory stock not found" })
    }
    return res.send({ success: true, data: result, message: "inventory stock fetched successfully" })
  } catch (error) {
    return res.status(500).send({ success: false, message: "internal server down", error: error.message })
  }
}

exports.updateInventoryProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, invoiceNo, vendorName, gatePassNumber, vendorValue, contact, status, storeItems = [] } = req.body;
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }

    // 1️⃣ Check vendor purchase
    const vendorDoc = await vendorPurchaseModel.findOne({ _id: id, ...locationFilter });
    if (!vendorDoc) {
      return res.status(404).json({ success: false, message: "Vendor purchase not found" });
    }

    // 2️⃣ Update vendor details
    await vendorPurchaseModel.findByIdAndUpdate(
      id,
      { date, invoiceNo, vendorName, gatePassNumber, vendorValue, contact, status },
      { new: true }
    );

    // 3️⃣ Upsert store items and update tuck-shop items
    for (const item of storeItems) {
      const { itemName, itemNo, amount, stock, sellingPrice, category, status } = item;

      // --- StoreInventory upsert ---
      const existingStore = await storeItemModel.findOne({ vendorPurchase: id, itemNo, ...locationFilter });
      if (existingStore) {
        await storeItemModel.findByIdAndUpdate(existingStore._id, {
          amount, sellingPrice, stock
        });
        await tuckShopModel.updateOne(
          { itemNo, ...locationFilter },
          { $set: { price: sellingPrice } }
        );
      } else {
        const itemAlreadyExist = await storeItemModel.findOne({ itemNo, ...locationFilter })
        if (!itemAlreadyExist) {
          return res.status(400).send({ success: false, message: "these item number already exist please try again" })
        }
        await storeItemModel.create({
          vendorPurchase: id,
          itemName, itemNo, amount, stock, sellingPrice, category, status,
          location_id: locationId
        });
      }

      // --- TuckShop upsert (create or update) ---
      await tuckShopModel.findOneAndUpdate(
        { itemNo, ...locationFilter },
        {
          itemName,
          category,
          price: sellingPrice,
          status,
          location_id: locationId
        },
        { upsert: true, new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Vendor and items updated, tuck-shop synced"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.transferIventoryProduct = async(req,res)=>{
 try{
  const {itemNo,transferQty} = req.body
  const tuckshopItemData = await tuckShopModel.findOne({itemNo});
  if(!itemData) return res.status(404).send({success:false,message:"item could not find"});
  const storeInventoryItem = await storeItemModel.findOne({itemNo})
  

 }catch(error){
  return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
 }
}

exports.updateInventoryProduct1 = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, invoiceNo, vendorName, gatePassNumber, vendorValue, contact, status, storeItems = [] } = req.body;

    // 1️⃣ Check vendor purchase
    const vendorDoc = await vendorPurchaseModel.findById(id);
    if (!vendorDoc) {
      return res.status(404).json({ success: false, message: "Vendor purchase not found" });
    }

    // 2️⃣ Update vendor fields (we can do this after validations if preferred)
    await vendorPurchaseModel.findByIdAndUpdate(
      id,
      { date, invoiceNo, gatePassNumber, vendorName, vendorValue, contact, status },
      { new: true }
    );

    // 3️⃣ Validate all storeItems before any DB write
    const validationErrors = [];

    for (const [index, item] of storeItems.entries()) {
      const { itemNo, itemName, amount, stock, sellingPrice, category, status } = item;

      // Required fields
      if (!itemNo || !itemName) {
        validationErrors.push({
          itemIndex: index,
          message: "itemNo and itemName are required."
        });
        continue;
      }

      // Check duplicates in DB belonging to a different vendor
      const conflictItem = await storeItemModel.findOne({
        itemNo,
        vendorPurchase: { $ne: id }
      });

      if (conflictItem) {
        validationErrors.push({
          itemNo,
          message: `Item number ${itemNo} already exists for another vendor purchase.`
        });
      }
    }

    // If we have any errors, stop and return them all at once
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed for one or more items.",
        errors: validationErrors
      });
    }

    // 4️⃣ No validation errors → proceed with upserts
    for (const item of storeItems) {
      const { itemName, itemNo, amount, stock, sellingPrice, category, status } = item;

      const existingStore = await storeItemModel.findOne({ vendorPurchase: id, itemNo });

      if (existingStore) {
        await storeItemModel.findByIdAndUpdate(existingStore._id, {
          itemName,
          amount,
          stock,
          sellingPrice,
          category,
          status
        });
      } else {
        await storeItemModel.create({
          vendorPurchase: id,
          itemName,
          itemNo,
          amount,
          stock,
          sellingPrice,
          category,
          status
        });
      }

      // TuckShop sync
      await tuckShopModel.findOneAndUpdate(
        { itemNo },
        { itemName, category, price: sellingPrice, status },
        { upsert: true, new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Vendor and items updated successfully; tuck-shop synced."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


exports.transferInventoryToCanteenInventory = async (req, res) => {
  try {
    const {
      itemNo,
      transferQty,
      itemName,
      price,
      category,
      status,
    } = req.body;
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }

    if (!itemNo || !transferQty) {
      return res.status(400).json({
        success: false,
        message: "itemNo and transferQty are required",
      });
    }

    // ✅ CASE 1: Direct set if full product info present
    if (itemName && price && category && status) {
      // Upsert & set stockQuantity to transferQty directly
      const result = await tuckShopModel.updateOne(
        { itemNo, ...locationFilter },
        {
          $set: {
            itemName,
            category,
            price,
            status,
            description: "",
            stockQuantity: transferQty,
            location_id: locationId,
          },
        },
        { upsert: true }
      );

      await storeItemModel.updateMany({ itemNo, ...locationFilter }, { $set: { itemName, category, sellingPrice: price } })

      return res.status(200).json({
        success: true,
        mode: "direct-set",
        message: `Stock of ${itemName} set to ${transferQty} in canteen successfully`,
        data: result,
      });
    }

    // ✅ CASE 2: Store inventory transfer (same as before)
    const storeItems = await storeItemModel
      .find({ itemNo, stock: { $gt: 0 }, ...locationFilter })
      .sort({ createdAt: -1 });

    if (!storeItems.length) {
      return res.status(400).json({
        success: false,
        message: "No stock available in store for this item",
      });
    }

    const totalAvailable = storeItems.reduce((sum, i) => sum + i.stock, 0);
    if (totalAvailable < transferQty) {
      return res.status(400).json({
        success: false,
        message: `Only ${totalAvailable} units available, cannot transfer ${transferQty}`,
      });
    }

    let remaining = transferQty;
    const bulkOps = [];
    for (const doc of storeItems) {
      // (removed debug full-document dump)
      if (remaining <= 0) break;
      if (doc.stock <= remaining) {
        bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { stock: 0 } } } });
        remaining -= doc.stock;
      } else {
        bulkOps.push({
          updateOne: { filter: { _id: doc._id }, update: { $inc: { stock: -remaining } } },
        });
        remaining = 0;
      }
    }
    await storeItemModel.bulkWrite(bulkOps);

    const { itemName: sName, category: sCategory, sellingPrice } = storeItems[0];

    // Set canteen stock directly to transferQty (not increment)
   const tuckIncData = await tuckShopModel.findOne({ itemNo, ...locationFilter })
   const stockUpdate = tuckIncData.stockQuantity + transferQty
   
    await tuckShopModel.updateOne(
      { itemNo, ...locationFilter },
      {
        $set: {
          itemName: sName,
          category: sCategory || "General",
          price: sellingPrice,
          status: "Active",
          description: "",
          stockQuantity: stockUpdate, // ← direct set
          location_id: locationId,
        },
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      mode: "from-store",
      message: `Stock of ${sName} set to ${transferQty} in canteen from store`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


exports.deleteStoreData = async (req, res) => {
  try {
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const { id } = req.params;

    // 1️⃣ Delete the StoreInventory record
    const result = await storeItemModel.findOneAndDelete({ _id: id, ...locationFilter });
    if (!result) {
      return res
        .status(404)
        .send({ success: false, message: "Inventory stock not found" });
    }

    return res.send({
      success: true,
      data: result,
      message: "Inventory stock and tuck-shop item deleted successfully"
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.deleteInventoryItem = async (req, res) => {
  try {
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const { id } = req.params;

    // 1️⃣ Check vendor exists
    const vendor = await vendorPurchaseModel.findOne({ _id: id, ...locationFilter });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor purchase not found"
      });
    }

    // 2️⃣ Find all related store inventory items first
    const storeItems = await storeItemModel.find({ vendorPurchase: id, ...locationFilter });

    // 4️⃣ Delete all related store inventory items
    await storeItemModel.deleteMany({ vendorPurchase: id, ...locationFilter });

    // 5️⃣ Delete the vendor purchase itself
    await vendorPurchaseModel.findOneAndDelete({ _id: id, ...locationFilter });

    return res.status(200).json({
      success: true,
      message: "Vendor purchase, store items, and tuck-shop items deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.getAllCanteenItem1 = async (req, res) => {
  try {
    const {
      page,
      limit,
      sortField = "createdAt",
      sortOrder = "desc",
      itemName,
      category,
      status,
    } = req.query;

    /* 1️⃣ Build filter for TuckShop */
    const filter = {};
    if (itemName) filter.itemName = { $regex: itemName, $options: "i" };
    if (category) filter.category = { $regex: `^${category}$`, $options: "i" };
    if (status) filter.status = status;

    /* 2️⃣ Build base query */
    const query = tuckShopModel.find(filter);

    /* 3️⃣ Sorting */
    const sort = {};
    sort[sortField] = sortOrder.toLowerCase() === "asc" ? 1 : -1;
    query.sort(sort);

    /* 4️⃣ Pagination */
    let paginated = false;
    if (page && limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query.skip(skip).limit(parseInt(limit));
      paginated = true;
    }

    const items = await query.exec();
    if (!items.length) {
      return res.status(404).json({ success: false, message: "No data found" });
    }

    /* 5️⃣ Aggregate total stock ONLY for the returned items */
    const itemNos = items.map(i => i.itemNo);      // gather itemNo's for match
    const inventoryTotals = await storeItemModel.aggregate([
      { $match: { itemNo: { $in: itemNos } } },    // <— key fix: match first
      {
        $group: {
          _id: {
            itemName: "$itemName",
            itemNo: "$itemNo",
            category: "$category",
          },
          totalQty: { $sum: "$stock" },
        },
      },
    ]);

    /* 6️⃣ Lookup map */
    const totalMap = new Map();
    inventoryTotals.forEach(doc => {
      const key = `${doc._id.itemName}|${doc._id.itemNo}|${doc._id.category}`;
      totalMap.set(key, doc.totalQty);
    });

    /* 7️⃣ Attach totalQty to each tuck item */
    const withTotals = items.map(item => {
      const key = `${item.itemName}|${item.itemNo}|${item.category}`;
      return { ...item.toObject(), totalQty: totalMap.get(key) || 0 };
    });

    /* 8️⃣ If paginated, send meta info */
    if (paginated) {
      const totalCount = await tuckShopModel.countDocuments(filter);
      return res.status(200).json({
        success: true,
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        data: withTotals,
      });
    }

    /* 9️⃣ Otherwise return all */
    return res.status(200).json({ success: true, data: withTotals });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "internal server dow",
      error: error,
    });
  }
};


////////////////////////////////////////////////////////
exports.getAllCanteenItem1 = async (req, res) => {
  try {
    const {
      page,
      limit,
      sortField = "createdAt",
      sortOrder = "desc",
      itemName,
      category,
      status,
    } = req.query;

    /* 1️⃣ Build filter for TuckShop */
    const filter = {};
    if (itemName) filter.itemName = { $regex: itemName, $options: "i" };
    if (category) filter.category = { $regex: `^${category}$`, $options: "i" };
    if (status) filter.status = status;

    /* 2️⃣ Base query */
    const query = tuckShopModel.find(filter);

    /* 3️⃣ Sorting */
    const sort = {};
    sort[sortField] = sortOrder.toLowerCase() === "asc" ? 1 : -1;
    query.sort(sort);

    /* 4️⃣ Pagination */
    let paginated = false;
    let pageNum = 1, limitNum = 0;
    if (page && limit) {
      pageNum = parseInt(page) || 1;
      limitNum = parseInt(limit) || 10;
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      paginated = true;
    }

    /* 5️⃣ Fetch tuck shop items */
    const items = await query.exec();
    if (!items.length) {
      return res.status(200).json({ success: true, message: "No data found", data: [] });
    }

    /* 6️⃣ Combine store stock for these items */
    const itemNos = items.map(i => i.itemNo);
    const storeTotals = await storeItemModel.aggregate([
      { $match: { itemNo: { $in: itemNos } } },
      { $group: { _id: "$itemNo", totalStock: { $sum: "$stock" } } },
    ]);

    const storeMap = new Map();
    storeTotals.forEach(s => storeMap.set(s._id, s.totalStock));


    const withTotals = items.map(item => {
      const shopQty = Number(item.stockQuantity) || 0;
      const storeQty = Number(storeMap.get(String(item.itemNo))) || 0;
      return {
        ...item.toObject(),
        totalQty: shopQty + storeQty,
      };
    });

    /* 8️⃣ Send response */
    if (paginated) {
      const totalCount = await tuckShopModel.countDocuments(filter);
      return res.status(200).json({
        success: true,
        page: pageNum,
        limit: limitNum,
        totalCount,
        data: withTotals,
      });
    }

    return res.status(200).json({ success: true, data: withTotals });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.getAllCanteenItem = async (req, res) => {
  try {
    const {
      page,
      limit,
      sortField = "createdAt",
      sortOrder = "desc",
      itemName,
      category,
      status,
    } = req.query;

    const locationFilter = buildLocationFilter(req.user);

    /* 1️⃣ Build filter for TuckShop */
    const filter = {};
    if (itemName) filter.itemName = { $regex: itemName, $options: "i" };
    if (category) filter.category = { $regex: `^${category}$`, $options: "i" };
    if (status) filter.status = status;
    const baseFilter = { ...filter, ...locationFilter };

    /* 2️⃣ Base query */
    const query = tuckShopModel.find(baseFilter);

    /* 3️⃣ Sorting */
    const sort = {};
    sort[sortField] = sortOrder.toLowerCase() === "asc" ? 1 : -1;
    query.sort(sort);

    /* 4️⃣ Pagination */
    let paginated = false;
    let pageNum = 1, limitNum = 0;
    if (page && limit) {
      pageNum = parseInt(page) || 1;
      limitNum = parseInt(limit) || 10;
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      paginated = true;
    }

    /* 5️⃣ Fetch tuck shop items */
    const items = await query.exec();
    if (!items.length) {
      return res.status(200).json({ success: true, message: "No data found", data: [] });
    }

    /* 6️⃣ Combine store stock for these items */
    const itemNos = items.map(i => i.itemNo.toUpperCase());

    const storePipeline = [];
    if (locationFilter && Object.keys(locationFilter).length > 0) {
      storePipeline.push({ $match: locationFilter });
    }
    storePipeline.push(
      { $addFields: { itemNoUpper: { $toUpper: "$itemNo" } } },
      { $match: { itemNoUpper: { $in: itemNos } } },
      { $group: { _id: "$itemNoUpper", totalStock: { $sum: "$stock" } } }
    );

    const storeTotals = await storeItemModel.aggregate(storePipeline);

    const storeMap = new Map();
    storeTotals.forEach(s => storeMap.set(s._id, s.totalStock));

    const withTotals = items.map(item => {
      const shopQty = Number(item.stockQuantity) || 0;
      const storeQty = Number(storeMap.get(item.itemNo.toUpperCase())) || 0;
      return { ...item.toObject(), totalQty: shopQty + storeQty };
    });

    /* 8️⃣ Send response */
    if (paginated) {
      const totalCount = await tuckShopModel.countDocuments(baseFilter);
      return res.status(200).json({
        success: true,
        page: pageNum,
        limit: limitNum,
        totalCount,
        data: withTotals,
      });
    }

    return res.status(200).json({ success: true, data: withTotals });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.deleteCanteenItem = async (req, res) => {
  try {
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const { id: itemNo } = req.params

    if (!itemNo) {
      return res.status(400).json({
        success: false,
        message: "itemNo is required to delete an item",
      });
    }

    // Delete from tuck shop
    const tuckResult = await tuckShopModel.deleteOne({ itemNo, ...locationFilter });

    // Delete from store inventory
    const storeResult = await storeItemModel.deleteMany({ itemNo, ...locationFilter });

    return res.status(200).json({
      success: true,
      message: `Item ${itemNo} deleted successfully from canteen and store inventory`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

////////////////////////////////////////////////////////



exports.getCanteenItemListOptions = async (req, res) => {
  try {
    const { itemNo } = req.query
    const filter = { status: "Active" };
    if (itemNo) {
      filter.itemNo = { $regex: itemNo, $options: "i" };
    }
    const locationFilter = buildLocationFilter(req.user);
    const baseFilter = { ...filter, ...locationFilter };
    const items = await tuckShopModel.find(baseFilter);
    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, message: "internal server down", error: error });
  }
}

// create canteen stock
exports.createCanteenStock = async (req, res) => {
  try {
    const { itemName, category, itemNo, stockQuantity, sellingPrice, status } = req.body;
    const locationFilter = buildLocationFilter(req.user);
    const locationId = req.user?.location_id;
    if (!locationId) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }
    const inventoryItem = await storeItemModel.findOne({ itemNo, ...locationFilter });
    if (inventoryItem) {
      return res.status(404).json({ success: false, message: "item already exists" });
    }
    const tuckshopItem = await tuckShopModel.findOne({ itemNo, ...locationFilter });
    if (tuckshopItem) {
      return res.status(404).json({ success: false, message: "item already exists in tuckshop" });
    }
    const storeItem = await storeItemModel.create({
      itemName,
      category,
      itemNo,
      stock: 0,
      sellingPrice,
      status,
      location_id: locationId
    })

    await tuckShopModel.create({
      itemName,
      price: sellingPrice,
      stockQuantity: stockQuantity,
      category,
      itemNo,
      status,
      location_id: locationId
    })
    return res.status(200).json({ success: true, message: "canteen stock created successfully" });

  } catch (error) {
    return res.status(500).json({ success: false, message: "internal server down", error: error });
  }
}
