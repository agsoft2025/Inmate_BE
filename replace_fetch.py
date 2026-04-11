from pathlib import Path
path = Path('src/controllers/transactionController.js')
text = path.read_text(encoding='utf-8')
old = "    // ✅ FETCH DATA\n    const [posTransactions, financialTransactions] = await Promise.all([\n      POSShoppingCart.find({ createdAt: { $gte: startDate } })\n        .populate(\"products.productId\")\n        .lean(),\n\n      Financial.find({ createdAt: { $gte: startDate } })\n        .populate(\"workAssignId\")\n        .populate({\n          path: \"fileIds\",\n          select: \"fileUrl fileType remarks createdAt\"\n        })\n        .lean()\n    ]);"
new = "    // ✅ FETCH DATA\n    const posQuery = { createdAt: { $gte: startDate } };\n    if (locationObjectId) {\n      posQuery.location_id = locationObjectId;\n    }\n\n    const financialQuery = { createdAt: { $gte: startDate } };\n    if (allowedInmateIds) {\n      financialQuery.inmateId = { $in: Array.from(allowedInmateIds) };\n    }\n\n    const [posTransactions, financialTransactions] = await Promise.all([\n      POSShoppingCart.find(posQuery)\n        .populate(\"products.productId\")\n        .lean(),\n\n      Financial.find(financialQuery)\n        .populate(\"workAssignId\")\n        .populate({\n          path: \"fileIds\",\n          select: \"fileUrl fileType remarks createdAt\"\n        })\n        .lean()\n    ]);"
if old not in text:
    raise SystemExit('pattern not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
