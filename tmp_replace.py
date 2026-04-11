from pathlib import Path
path = Path('src/controllers/inventoryController.js')
text = path.read_text(encoding='utf-8')
start = text.index('exports.addInventoryStock = async (req, res) => {')
end = text.index('};', start) + 2
new_block = '''exports.addInventoryStock = async (req, res) => {
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
    console.error("INVENTORY ERROR:", error);
    return res.status(400).json({ success: false, message: error.message || "Inventory creation failed" });
  }
};
'''
path.write_text(text[:start] + new_block + text[end:], encoding='utf-8')
