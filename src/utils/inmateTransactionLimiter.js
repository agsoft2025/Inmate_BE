const financialModel = require("../model/financialModel");
const InmateLocation = require("../model/inmateLocationModel");
const inmateModel = require("../model/inmateModel");
const posShoppingCart = require("../model/posShoppingCart");
const tuckShopModel = require("../model/tuckShopModel");

// exports.checkTransactionLimit = async (inmateId, amount, type) => {
//   try {
//        // First day of the current month
//     const monthStart = new Date();
//     monthStart.setDate(1); // Set to first day
//     monthStart.setHours(0, 0, 0, 0); // Start of the day

//     var typeFilter;
//      const typeFilter =
//       type === "deposit" || type === "wages"
//         ? { $in: ["deposit", "wages"] }
//         : type;

//     const transactions = await financialModel.find({
//       inmateId: inmateId,
//       type: typeFilter,
//       createdAt: { $gte: monthStart }
//     });

//     let totalAmount = 0;
//     if (type === "wages" || type === "deposit") {
//        totalAmount = transactions.reduce((sum, tx) => {
//         return sum + (tx.wageAmount || 0) + (tx.depositAmount || 0);
//       }, 0);

//     } else if (type === "spend") {
//       totalAmount = transactions.reduce((sum, tx) => sum + (tx.spendAmount || 0), 0);
//     }
//     const inmateData = await inmateModel.findOne({ inmateId }).populate('location_id');
//     if (!inmateData || !inmateData.location_id) {
//       return { status: false, message: "Inmate or location data not found" };
//     }

//     const location = inmateData.location_id;
//     const newTotal = totalAmount + amount;

//     if (type === "deposit" || type === "wages") {
//       if (location.depositLimit !== undefined && newTotal > location.depositLimit) {
//         return {
//           status: false,
//           message: `Deposit limit exceeded. Limit: ₹${location.depositLimit}, Attempted: ₹${newTotal}`
//         };
//       }
//     } else if (type === "spend") {
//       if (location.spendLimit !== undefined && newTotal > location.spendLimit) {
//         return {
//           status: false,
//           message: `Spend limit exceeded. Limit: ₹${location.spendLimit}, Attempted: ₹${newTotal}`
//         };
//       }
//     }

//     return {
//       status: true,
//       message: "Transaction allowed"
//     };

//   } catch (error) {
//     return { status: false, message: "Internal server error" };
//   }
// };

exports.checkTransactionLimit = async (inmateId, amount, type) => {
  try {
       // First day of the current month
    const monthStart = new Date();
    monthStart.setDate(1); // Set to first day
    monthStart.setHours(0, 0, 0, 0); // Start of the day

     const typeFilter =
      type === "deposit" || type === "wages"
        ? { $in: ["deposit", "wages"] }
        : type;
        
    const transactions = await financialModel.find({
      inmateId: inmateId,
      type: typeFilter,
      createdAt: { $gte: monthStart }
    });

    let totalAmount = 0;
    if (type === "wages" || type === "deposit") {
       totalAmount = transactions.reduce((sum, tx) => {
        return sum + (tx.wageAmount || 0) + (tx.depositAmount || 0);
      }, 0);

    } else if (type === "spend") {
      totalAmount = transactions.reduce((sum, tx) => sum + (tx.spendAmount || 0), 0);
    }
    const inmateData = await inmateModel.findOne({ inmateId }).populate('location_id');
    if (!inmateData || !inmateData.location_id) {
      return { status: false, message: "Inmate or location data not found" };
    }
    if(inmateData.is_blocked === "true"){
      return { status: false, message: `Inmate ${inmateData.inmateId} is currently blocked` };
    }

    const location = inmateData.location_id;
    
    const normalizedCustody = inmateData.custodyType
      .toLowerCase()
      .replace(/\s+/g, "_");
    const limitObj = location.custodyLimits?.find(
      (c) => {
        return c.custodyType.toLowerCase() === normalizedCustody
      }    );
     if (!limitObj) {
      return {
        status: false,
        message: `No limits configured for custody type "${normalizedCustody}"`,
      };
    }

    const newTotal = totalAmount + amount;

    if ((type === "deposit" || type === "wages") && limitObj.depositLimit != null) {
      if (newTotal > limitObj.depositLimit) {
        return {
          status: false,
          message: `Deposit limit exceeded for ${normalizedCustody}. Limit: ₹${limitObj.depositLimit}, Attempted total: ₹${newTotal}`,
        };
      }
    }

    if (type === "spend" && limitObj.spendLimit != null) {
      if (newTotal > limitObj.spendLimit) {
        return {
          status: false,
          message: `Spend limit exceeded for ${limitObj.custodyType}. Limit: ₹${limitObj.spendLimit}, Attempted total: ₹${newTotal}`,
        };
      }
    }

    return {
      status: true,
      message: "Transaction allowed"
    };

  } catch (error) {
    return { status: false, message: "Internal server error" };
  }
};

exports.checkProductsLimit = async (inmateId, newProducts = []) => {
  try {
    // First day of current month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const carts = await posShoppingCart.find({
      inmateId,
      is_reversed: false,
      createdAt: { $gte: monthStart },
    }).populate({
      path: "products.productId",
      model: "TuckShop",
      select: "name price category type", // adjust fields as needed
    });

    // 2️⃣ Calculate total recharge amount so far
    let rechargeTotal = 0;
    for (const cart of carts) {
      for (const p of cart.products) {
        const prod = p.productId;
        if (!prod) continue;

        const isRecharge =
          (prod.category && prod.category.toLowerCase() === "recharge") ||
          (prod.type && prod.type.toLowerCase() === "recharge") ||
          (prod.name && prod.name.toLowerCase().includes("recharge"));

        if (isRecharge) {
          rechargeTotal += (prod.price || 0) * (p.quantity || 1);
        }
      }
    }

    // 3️⃣ Add the current purchase request (if passed)
    // newProducts is expected like: [{ productId, quantity }]
    if (newProducts.length) {
      const ids = newProducts.map(p => p.productId);
      const newProdDocs = await tuckShopModel.find({ _id: { $in: ids } });
      for (const p of newProducts) {
        const prodDoc = newProdDocs.find(d => d._id.toString() === p.productId);
        if (!prodDoc) continue;
        const isRecharge =
          (prodDoc.category && prodDoc.category.toLowerCase() === "recharge") ||
          (prodDoc.type && prodDoc.type.toLowerCase() === "recharge") ||
          (prodDoc.name && prodDoc.name.toLowerCase().includes("recharge"));
        if (isRecharge) {
          rechargeTotal += (prodDoc.price || 0) * (p.quantity || 1);
        }
      }
    }
    // 4️⃣ Optional: Inmate block check
    const inmate = await inmateModel.findOne({ inmateId });
    if (!inmate) {
      return { status: false, message: "Inmate not found" };
    }
    if (inmate.is_blocked === "true") {
      return {
        status: false,
        message: `Inmate ${inmate.inmateId} is currently blocked`,
      };
    }

    // 5️⃣ Limit check
    const LIMIT = 500;
    if (rechargeTotal > LIMIT) {
      return {
        status: false,
        message: `Recharge limit exceeded. Limit: ₹${LIMIT}, Attempted total: ₹${rechargeTotal}`,
      };
    }

    return { status: true, message: "Recharge purchase allowed" };
  } catch (error) {
    console.error("checkProductsLimit error:", error);
    return { status: false, message: "Internal server error" };
  }
};

