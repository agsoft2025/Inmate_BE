const POSShoppingCart = require("../model/posShoppingCart");
const TuckShop = require("../model/tuckShopModel");
const Inmate = require("../model/inmateModel");
const mongoose = require("mongoose");
const logAudit = require("../utils/auditlogger");
const { checkTransactionLimit, checkProductsLimit } = require("../utils/inmateTransactionLimiter");
const userModel = require("../model/userModel");
const InmateLocation = require("../model/inmateLocationModel");
const inmateModel = require("../model/inmateModel");
const InmatePaymentMandate = require("../model/InmatePaymentMandate");
const razorpay = require("../config/razorpay");
const PaymentLog = require("../model/PaymentLog");
// const createPOSCart = async (req, res) => {
//   const startTime = Date.now();
//   try {
//     const { inmateId, products } = req.body;

//     // 1️⃣ User & location checks
//     const userData = await userModel.findById(req.user.id).populate("location_id");
//     if (!userData?.location_id) return res.status(404).json({ success: false, message: "User has no location" });
//     if (userData.location_id.purchaseStatus === "denied")
//       return res.status(403).json({ success: false, message: "Application under maintenance" });

//     // 2️⃣ Validate products
//     if (!inmateId || !Array.isArray(products) || products.length === 0)
//       return res.status(400).json({ success: false, message: "Missing required fields" });

//     for (const item of products) {
//       if (!item.productId || !item.quantity)
//         return res.status(400).json({ success: false, message: "Each product must have productId and quantity" });
//     }

//     // 3️⃣ Check inmate
//     const inmate = await Inmate.findOne({ inmateId });
//     if (!inmate) return res.status(400).json({ success: false, message: "Inmate ID does not exist" });

//     // 🔥 4️⃣ FIND STORED MANDATE
//     const paymentMandate = await InmatePaymentMandate.findOne({ inmateId: inmate._id }).sort({ createdAt: -1 });
//     if (!paymentMandate?.mandateId || !paymentMandate.customerId) {
//       return res.status(400).json({ success: false, message: "No active mandate found! Setup auto-pay first." });
//     }

//     const mandateId = paymentMandate.mandateId; // Subscription ID used as mandate ID
//     const customerId = paymentMandate.customerId;

//     // 5️⃣ Validate mandate
//     let mandateDetails = null;
//     try {
//       mandateDetails = await razorpay.subscriptions.fetch(mandateId);

//       if ( mandateDetails.status !== 'authenticated') {
//         return res.status(400).json({ success: false, message: "Mandate is not active or authenticated" });
//       }
//       if (mandateDetails.customer_id !== customerId) {
//         return res.status(400).json({ success: false, message: "Mandate does not belong to this customer" });
//       }
//     } catch (err) {
//       console.error("❌ MANDATE VALIDATION FAILED:", err.message);
//       return res.status(500).json({ success: false, message: "Failed to validate mandate" });
//     }

//     // 6️⃣ Check stock & calculate total
//     let totalAmount = 0;
//     const productDetails = [];
//     for (const item of products) {
//       const tuckItem = await TuckShop.findById(item.productId);
//       if (!tuckItem) return res.status(404).json({ success: false, message: `Product ${item.productId} not found` });
//       if (tuckItem.stockQuantity < item.quantity) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient stock for "${tuckItem.itemName}". Available: ${tuckItem.stockQuantity}, Requested: ${item.quantity}`
//         });
//       }
//       totalAmount += tuckItem.price * item.quantity;
//       productDetails.push({
//         productId: tuckItem._id,
//         itemName: tuckItem.itemName,
//         quantity: item.quantity,
//         price: tuckItem.price,
//         subtotal: tuckItem.price * item.quantity
//       });
//     }


//     // 7️⃣ Check limits
//     const depositLim = await checkTransactionLimit(inmateId, totalAmount, "spend");
//     if (!depositLim.status) return res.status(400).json({ success: false, message: depositLim.message });

//     const checkRechargeTransactionLim = await checkProductsLimit(inmateId, products);
//     if (!checkRechargeTransactionLim.status) return res.status(400).json({ success: false, message: checkRechargeTransactionLim.message });

//     // 8️⃣ Create POS cart
//     const newCart = new POSShoppingCart({
//       inmateId: inmate._id,
//       totalAmount,
//       products: productDetails,
//       status: "pending"
//     });
//     const savedCart = await newCart.save();

//     // 🔥 9️⃣ INSTANT MANDATE PAYMENT PROCESSING
//     const amountInPaise = Math.round(totalAmount * 100);

//     // Charge using Razorpay subscription charge API
//     let paymentResult = null;
//     try {
//       const chargePayload = {
//         amount: amountInPaise,
//         notes: {
//           cartId: savedCart._id.toString(),
//           inmate_id: inmateId,
//           type: "instant_purchase",
//           location_id: userData.location_id._id.toString()
//         }
//       };

//       paymentResult = await razorpay.subscriptions.charge(mandateId, chargePayload);
//     } catch (chargeError) {
//       console.error("❌ SUBSCRIPTION CHARGE FAILED:", chargeError.message || chargeError);

//       // Fallback to payment link if charge fails
//       try {
//         const callbackUrl = process.env.BASE_URL ? `${process.env.BASE_URL.replace(/\/$/, '')}/api/payment/callback` : null;
//         if (!callbackUrl) throw new Error('Missing BASE_URL env for payment link callback_url');

//         const paymentLinkPayload = {
//           amount: amountInPaise,
//           currency: "INR",
//           customer: { id: customerId },
//           type: "link",
//           description: `Instant Tuckshop Purchase - ${inmateId}`,
//           reminder_enable: false,
//           notify: { sms: false, email: false },
//           notes: {
//             cartId: savedCart._id.toString(),
//             mandate_id: mandateId,
//             type: "instant_purchase_fallback",
//             inmate_id: inmateId
//           },
//           callback_url: callbackUrl,
//           callback_method: "get"
//         };

//         const paymentLink = await razorpay.paymentLink.create(paymentLinkPayload);

//         paymentResult = {
//           id: paymentLink.id,
//           status: paymentLink.status || "created",
//           amount: amountInPaise,
//           currency: "INR",
//           method: "payment_link",
//           notes: paymentLink.notes || {},
//           short_url: paymentLink.short_url || paymentLink.longurl || null
//         };
//       } catch (linkError) {
//         throw new Error("Failed to process mandate payment: " + (linkError.message || 'unknown'));
//       }
//     }

//     // 10️⃣ VALIDATE PAYMENT STATUS
//     const successStates = ['captured', 'paid'];
//     if (!paymentResult || !successStates.includes(paymentResult.status)) {
//       console.error("❌ PAYMENT NOT COMPLETED:", paymentResult?.status);

//       savedCart.status = "failed";
//       await savedCart.save();

//       return res.status(400).json({
//         success: false,
//         message: "Payment processing failed. Please try again.",
//         paymentStatus: paymentResult?.status || "unknown",
//         paymentLink: paymentResult?.method === 'payment_link' ? (paymentResult.short_url || null) : undefined
//       });
//     }


//     // 11️⃣ DEDUCT STOCK
//     for (const item of productDetails) {
//       await TuckShop.findByIdAndUpdate(item.productId, { $inc: { stockQuantity: -item.quantity } });
//     }

//     // 12️⃣ UPDATE CART STATUS
//     savedCart.status = "paid";
//     savedCart.paymentId = paymentResult.id;
//     savedCart.paymentStatus = paymentResult.status;
//     savedCart.paymentMethod = paymentResult.method || "mandate";
//     await savedCart.save();

//     // 13️⃣ CREATE PAYMENT LOG
//     await PaymentLog.create({
//       inmateId: inmate._id,
//       mandateId,
//       customerId,
//       paymentId: paymentResult.id,
//       amount: totalAmount,
//       currency: "INR",
//       status: paymentResult.status,
//       method: paymentResult.method || "mandate",
//       notes: {
//         cartId: savedCart._id.toString(),
//         type: "tuckshop_purchase",
//         location: userData.location_id.name || userData.location_id._id.toString()
//       }
//     });

//     // 14️⃣ AUDIT LOG
//     await logAudit({
//       userId: req.user.id,
//       username: req.user.username,
//       inmateId: inmate._id,
//       action: "CREATE_AND_PAY",
//       targetModel: "POSShoppingCart",
//       targetId: savedCart._id,
//       description: `⚡ INSTANT tuckshop purchase ₹${totalAmount} for ${inmateId}`,
//       changes: {
//         totalAmount,
//         products: productDetails,
//         paymentId: paymentResult.id,
//         method: paymentResult.method || "mandate"
//       }
//     });

//     // 15️⃣ NOTIFICATION

//     const timeTaken = Date.now() - startTime;

//     return res.status(201).json({
//       success: true,
//       data: {
//         cart: {
//           id: savedCart._id,
//           inmateId,
//           totalAmount,
//           products: productDetails,
//           status: savedCart.status,
//           createdAt: savedCart.createdAt
//         },
//         payment: {
//           id: paymentResult.id,
//           status: paymentResult.status,
//           method: paymentResult.method || "mandate",
//           amount: totalAmount,
//           payment_link: paymentResult.method === 'payment_link' ? (paymentResult.short_url || null) : undefined
//         },
//         processingTime: `${timeTaken}ms`
//       },
//       message: `⚡ INSTANT SUCCESS! ₹${totalAmount} delivered to ${inmateId} - NO OTP REQUIRED!`,
//       timestamp: new Date().toISOString()
//     });

//   } catch (error) {
//     console.error("❌ CRITICAL ERROR in createPOSCart:", {
//       message: error.message || "No error message provided",
//       stack: error.stack || "No stack trace provided",
//       errorDetails: error,
//       timestamp: new Date().toISOString(),
//       userId: req.user?.id,
//       inmateId: req.body?.inmateId
//     });

//     // Rollback any partial changes (mark pending cart as failed)
//     if (req.body?.inmateId) {
//       try {
//         const inmate = await Inmate.findOne({ inmateId: req.body.inmateId });
//         if (inmate) {
//           const recentCart = await POSShoppingCart.findOne({
//             inmateId: inmate._id,
//             status: "pending",
//             createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
//           });

//           if (recentCart) {
//             recentCart.status = "failed";
//             await recentCart.save();
//           }
//         }
//       } catch (rollbackError) {
//         console.error("❌ ROLLBACK FAILED:", rollbackError.message);
//       }
//     }

//     const timeTaken = Date.now() - startTime;
//     return res.status(500).json({
//       success: false,
//       message: "Server error during payment processing",
//       error: process.env.NODE_ENV === "development" ? (error.message || "Unknown error") : "Internal server error",
//       processingTime: `${timeTaken}ms`
//     });
//   }
// };

const createPOSCart = async (req, res) => {
  try {
    const { inmateId, totalAmount, products } = req.body;
    const userData = await userModel.findById(req.user.id).populate("location_id")
    location_id = userData.location_id
    if (!userData.location_id) {
      return res.status(404).send({ success: false, message: "This user has no location" })
    }
    if (userData.location_id.purchaseStatus === "denied") {
      return res.status(403).send({ success: false, message: "Our application is undergoing maintenance. Please try again in a little while" })
    }
    const depositLim = await checkTransactionLimit(inmateId, totalAmount, type = "spend");
    if (!depositLim.status) {
      return res.status(400).send({ success: false, message: depositLim.message });
    }
    const checkRechargeTransactionLim = await checkProductsLimit(inmateId, products)
    if (!checkRechargeTransactionLim.status) {
      return res.status(400).send({ success: false, message: checkRechargeTransactionLim.message });
    }

    if (!inmateId || totalAmount === undefined || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    for (const item of products) {
      if (!item.productId || !item.quantity) {
        return res.status(400).json({ message: "Each product must have productId and quantity" });
      }
    }

    // Check inmate existence
    const existingInmate = await Inmate.findOne({ inmateId });
    const paymentMandate = await InmatePaymentMandate.findOne({ inmateId: existingInmate.inmateId }).sort({ createdAt: -1 });
    
    // if (!paymentMandate?.mandateId || !paymentMandate.customerId) {
    //   return res.status(400).json({ success: false, message: "No active mandate found! Setup auto-pay first." });
    // }
    if (!existingInmate) {
      return res.status(400).json({ success: false, message: "Inmate ID does not exist" });
    }

    // Check sufficient balance
    if (existingInmate.balance < totalAmount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // Check stock availability
    for (const item of products) {
      const tuckItem = await TuckShop.findById(item.productId);
      if (!tuckItem) {
        return res.status(404).json({ message: `Product with ID ${item.productId} not found` });
      }

      if (tuckItem.stockQuantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for item "${tuckItem.itemName}". Available: ${tuckItem.stockQuantity}, Requested: ${item.quantity}`
        });
      }
    }

    // Deduct stock from TuckShop
    for (const item of products) {
      await TuckShop.findByIdAndUpdate(item.productId, {
        $inc: { stockQuantity: -item.quantity }
      });
    }

    // Create POS cart
    const newCart = new POSShoppingCart({ inmateId, totalAmount, products });
    const savedCart = await newCart.save();

    // Deduct balance
    existingInmate.balance -= totalAmount;
    await existingInmate.save();

    // await WalletTransaction.create({
    //   inmateId: existingInmate._id,
    //   amount: totalAmount,
    //   type: 'DEDUCT',
    //   referenceId: savedCart._id.toString(),
    //   description: `Tuckshop purchase - ${products.length} items`
    // });

    // Audit log
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      inmateId: inmateId,
      action: 'CREATE',
      targetModel: 'POSShoppingCart',
      targetId: savedCart._id,
      description: `Created POS cart for inmate ${inmateId}`,
      changes: { totalAmount, products, inmateId, custodyType: existingInmate.custodyType }
    });

    res.status(201).json({ success: true, data: savedCart, message: "Cart created successfully" });

  } catch (error) {
    console.log("<><>error post cart",error)
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// const axios = require('axios');
// const https = require('https');

// const createPOSCart3 = async (req, res) => {
//   const startTime = Date.now();

//   // Basic auth credentials for Razorpay REST API
//   const base64Credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

//   try {
//     const { inmateId, products } = req.body;

//     // 1️⃣ User & location checks
//     const userData = await userModel.findById(req.user.id).populate("location_id");
//     if (!userData?.location_id) return res.status(404).json({ success: false, message: "User has no location" });
//     if (userData.location_id.purchaseStatus === "denied")
//       return res.status(403).json({ success: false, message: "Application under maintenance" });

//     // 2️⃣ Validate products
//     if (!inmateId || !Array.isArray(products) || products.length === 0)
//       return res.status(400).json({ success: false, message: "Missing required fields" });

//     for (const item of products) {
//       if (!item.productId || !item.quantity)
//         return res.status(400).json({ success: false, message: "Each product must have productId and quantity" });
//     }

//     // 3️⃣ Check inmate
//     const inmate = await Inmate.findOne({ inmateId });
//     if (!inmate) return res.status(400).json({ success: false, message: "Inmate ID does not exist" });

//     // 🔥 4️⃣ FIND STORED MANDATE
//     const paymentMandate = await InmatePaymentMandate.findOne({ inmateId: inmate._id }).sort({ createdAt: -1 });
//     if (!paymentMandate?.mandateId || !paymentMandate.customerId) {
//       return res.status(400).json({ success: false, message: "No active mandate found! Setup auto-pay first." });
//     }

//     const mandateId = paymentMandate.mandateId; // Subscription ID
//     const customerId = paymentMandate.customerId;

//     // 5️⃣ Validate mandate
//     let mandateDetails = null;
//     try {
//       mandateDetails = await razorpay.subscriptions.fetch(mandateId);

//       if (mandateDetails.status !== 'active' && mandateDetails.status !== 'authenticated') {
//         return res.status(400).json({ success: false, message: "Mandate is not active or authenticated" });
//       }
//       if (mandateDetails.customer_id !== customerId) {
//         return res.status(400).json({ success: false, message: "Mandate does not belong to this customer" });
//       }
//     } catch (err) {
//       console.error("❌ MANDATE VALIDATION FAILED:", err.message);
//       return res.status(500).json({ success: false, message: "Failed to validate mandate" });
//     }

//     // 6️⃣ Check stock & calculate total
//     let totalAmount = 0;
//     const productDetails = [];
//     for (const item of products) {
//       const tuckItem = await TuckShop.findById(item.productId);
//       if (!tuckItem) return res.status(404).json({ success: false, message: `Product ${item.productId} not found` });
//       if (tuckItem.stockQuantity < item.quantity) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient stock for "${tuckItem.itemName}". Available: ${tuckItem.stockQuantity}, Requested: ${item.quantity}`
//         });
//       }
//       totalAmount += tuckItem.price * item.quantity;
//       productDetails.push({
//         productId: tuckItem._id,
//         itemName: tuckItem.itemName,
//         quantity: item.quantity,
//         price: tuckItem.price,
//         subtotal: tuckItem.price * item.quantity
//       });
//     }

//     // 7️⃣ Check limits
//     const depositLim = await checkTransactionLimit(inmateId, totalAmount, "spend");
//     if (!depositLim.status) return res.status(400).json({ success: false, message: depositLim.message });

//     const checkRechargeTransactionLim = await checkProductsLimit(inmateId, products);
//     if (!checkRechargeTransactionLim.status) return res.status(400).json({ success: false, message: checkRechargeTransactionLim.message });

//     // 8️⃣ Create POS cart
//     const newCart = new POSShoppingCart({
//       inmateId: inmate._id,
//       totalAmount,
//       products: productDetails,
//       status: "pending"
//     });
//     const savedCart = await newCart.save();
//     console.log("🛒 CART CREATED:", savedCart._id);

//     // 🔥 9️⃣ INSTANT MANDATE PAYMENT PROCESSING
//     const amountInPaise = Math.round(totalAmount * 100); // e.g., 5000 paise for ₹50
//     console.log("💰 AMOUNT:", totalAmount, "→", amountInPaise, "paise");

//     // STEP 1: CREATE ORDER
//     const orderOptions = {
//       amount: amountInPaise,
//       currency: "INR",
//       receipt: `tuck_${Date.now()}_${savedCart._id.toString().slice(0, 8)}`,
//       notes: {
//         cartId: savedCart._id.toString(),
//         mandate_id: mandateId,
//         inmate_id: inmateId,
//         type: "instant_purchase",
//         location_id: userData.location_id._id.toString()
//       }
//     };

//     console.log("📝 CREATING ORDER:", JSON.stringify(orderOptions, null, 2));
//     const order = await razorpay.orders.create(orderOptions);
//     console.log("⚡ ORDER CREATED:", order.id);

//     // STEP 2: PROCESS MANDATE PAYMENT (using REST API with payments/create)
//     let paymentResult = null;
//     try {
//       const paymentPayload = {
//         amount: amountInPaise,
//         currency: "INR",
//         order_id: order.id,
//         customer_id: customerId,
//         token: mandateId, 
//         recurring: true, 
//         method: mandateDetails.payment_method || "upi",
//         description: `Tuckshop purchase for ${inmateId} - ₹${totalAmount}`,
//         notes: {
//           cartId: savedCart._id.toString(),
//           mandate_id: mandateId,
//           order_id: order.id,
//           type: "instant_mandate_capture",
//           inmate_id: inmateId
//         }
//       };

//       console.log("📝 CREATING PAYMENT (REST):", JSON.stringify(paymentPayload, null, 2));
//       const paymentResponse = await axios.post(
//         'https://api.razorpay.com/v1/payments/create',
//         paymentPayload,
//         {
//           headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
//           timeout: 15000,
//           httpsAgent: new https.Agent({ keepAlive: false })
//         }
//       );

//       console.log(".....................................................................");
//       console.log("<><>paymentResponse", paymentResponse.data);
//       console.log(".....................................................................");

//       paymentResult = paymentResponse.data;
//       console.log("💳 PAYMENT CREATED (REST):", paymentResult.id, "Status:", paymentResult.status);

//       // Capture the payment if authorized
//       if (paymentResult.status === 'authorized') {
//         const captureResponse = await axios.post(
//           `https://api.razorpay.com/v1/payments/${paymentResult.id}/capture`,
//           { amount: amountInPaise, currency: "INR" },
//           {
//             headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
//             timeout: 10000,
//             httpsAgent: new https.Agent({ keepAlive: false })
//           }
//         );

//         paymentResult = captureResponse.data;
//         console.log("🔒 PAYMENT CAPTURED (REST):", paymentResult.id, "Status:", paymentResult.status);
//       }
//     } catch (paymentError) {
//       console.error("❌ PAYMENT FAILED (REST):", {
//         message: paymentError.message,
//         response: paymentError.response?.data || 'No response data',
//         stack: paymentError.stack
//       });

//       // Fallback to payment link
//       try {
//         const callbackUrl = process.env.BASE_URL ? `${process.env.BASE_URL.replace(/\/$/, '')}/api/payment/callback` : null;
//         if (!callbackUrl) throw new Error('Missing BASE_URL env for payment link callback_url');

//         const paymentLinkPayload = {
//           amount: amountInPaise,
//           currency: "INR",
//           customer_id: customerId,
//           description: `Instant Tuckshop Purchase - ${inmateId}`,
//           notes: {
//             cartId: savedCart._id.toString(),
//             mandate_id: mandateId,
//             type: "instant_purchase_fallback",
//             inmate_id: inmateId
//           },
//           callback_url: callbackUrl
//         };

//         const paymentLinkResponse = await axios.post(
//           'https://api.razorpay.com/v1/payment_links',
//           paymentLinkPayload,
//           {
//             headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
//             timeout: 15000,
//             httpsAgent: new https.Agent({ keepAlive: false })
//           }
//         );

//         const paymentLink = paymentLinkResponse.data;
//         console.log("🔗 PAYMENT LINK CREATED (fallback):", paymentLink.id);

//         paymentResult = {
//           id: paymentLink.id,
//           status: paymentLink.status || "created",
//           amount: amountInPaise,
//           currency: "INR",
//           method: "payment_link",
//           notes: paymentLink.notes || {},
//           short_url: paymentLink.short_url
//         };
//       } catch (linkError) {
//         console.error("❌ PAYMENT LINK FAILED (fallback):", {
//           message: linkError.message,
//           response: linkError.response?.data || 'No response data',
//           stack: linkError.stack
//         });
//         throw new Error("Failed to process mandate payment: " + (linkError.message || 'unknown'));
//       }
//     }

//     // 10️⃣ VALIDATE PAYMENT STATUS
//     const successStates = ['captured', 'paid'];
//     if (!paymentResult || !successStates.includes(paymentResult.status)) {
//       console.error("❌ PAYMENT NOT COMPLETED:", paymentResult?.status);

//       savedCart.status = "failed";
//       await savedCart.save();

//       return res.status(400).json({
//         success: false,
//         message: "Payment processing failed. Please try again.",
//         paymentStatus: paymentResult?.status || "unknown",
//         paymentLink: paymentResult?.method === 'payment_link' ? paymentResult.short_url : undefined
//       });
//     }

//     console.log("✅ PAYMENT SUCCESS:", paymentResult.id, paymentResult.status);

//     // 11️⃣ DEDUCT STOCK
//     for (const item of productDetails) {
//       await TuckShop.findByIdAndUpdate(item.productId, { $inc: { stockQuantity: -item.quantity } });
//       console.log(`📦 STOCK DEDUCTED: ${item.itemName} x${item.quantity}`);
//     }

//     // 12️⃣ UPDATE CART STATUS
//     savedCart.status = "paid";
//     savedCart.paymentId = paymentResult.id;
//     savedCart.paymentStatus = paymentResult.status;
//     savedCart.paymentMethod = paymentResult.method || "mandate";
//     await savedCart.save();
//     console.log("✅ CART UPDATED TO PAID:", savedCart._id);

//     // 13️⃣ CREATE PAYMENT LOG
//     await PaymentLog.create({
//       inmateId: inmate._id,
//       mandateId,
//       customerId,
//       paymentId: paymentResult.id,
//       amount: totalAmount,
//       currency: "INR",
//       status: paymentResult.status,
//       method: paymentResult.method || "mandate",
//       notes: {
//         cartId: savedCart._id.toString(),
//         type: "tuckshop_purchase",
//         location: userData.location_id.name || userData.location_id._id.toString()
//       }
//     });
//     console.log("📝 PAYMENT LOG CREATED");

//     // 14️⃣ AUDIT LOG
//     await logAudit({
//       userId: req.user.id,
//       username: req.user.username,
//       inmateId: inmate._id,
//       action: "CREATE_AND_PAY",
//       targetModel: "POSShoppingCart",
//       targetId: savedCart._id,
//       description: `⚡ INSTANT tuckshop purchase ₹${totalAmount} for ${inmateId}`,
//       changes: {
//         totalAmount,
//         products: productDetails,
//         paymentId: paymentResult.id,
//         method: paymentResult.method || "mandate"
//       }
//     });

//     // 15️⃣ NOTIFICATION
//     console.log("📱 NOTIFICATION: Order delivered to", inmateId);

//     const timeTaken = Date.now() - startTime;
//     console.log(`⚡ TOTAL PROCESSING TIME: ${timeTaken}ms`);

//     return res.status(201).json({
//       success: true,
//       data: {
//         cart: {
//           id: savedCart._id,
//           inmateId,
//           totalAmount,
//           products: productDetails,
//           status: savedCart.status,
//           createdAt: savedCart.createdAt
//         },
//         payment: {
//           id: paymentResult.id,
//           status: paymentResult.status,
//           method: paymentResult.method || "mandate",
//           amount: totalAmount,
//           payment_link: paymentResult.method === 'payment_link' ? paymentResult.short_url : undefined
//         },
//         processingTime: `${timeTaken}ms`
//       },
//       message: `⚡ INSTANT SUCCESS! ₹${totalAmount} delivered to ${inmateId} - NO OTP REQUIRED!`,
//       timestamp: new Date().toISOString()
//     });

//   } catch (error) {
//     console.error("❌ CRITICAL ERROR in createPOSCart:", {
//       message: error.message || "No error message provided",
//       stack: error.stack || "No stack trace provided",
//       errorDetails: error,
//       timestamp: new Date().toISOString(),
//       userId: req.user?.id,
//       inmateId: req.body?.inmateId
//     });

//     // Rollback any partial changes (mark pending cart as failed)
//     if (req.body?.inmateId) {
//       try {
//         const inmate = await Inmate.findOne({ inmateId: req.body.inmateId });
//         if (inmate) {
//           const recentCart = await POSShoppingCart.findOne({
//             inmateId: inmate._id,
//             status: "pending",
//             createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
//           });

//           if (recentCart) {
//             recentCart.status = "failed";
//             await recentCart.save();
//             console.log("🔄 ROLLBACK: Cart marked as failed:", recentCart._id);
//           }
//         }
//       } catch (rollbackError) {
//         console.error("❌ ROLLBACK FAILED:", rollbackError.message);
//       }
//     }

//     const timeTaken = Date.now() - startTime;
//     return res.status(500).json({
//       success: false,
//       message: "Server error during payment processing",
//       error: process.env.NODE_ENV === "development" ? (error.message || "Unknown error") : "Internal server error",
//       processingTime: `${timeTaken}ms`
//     });
//   }
// };

const axios = require('axios');
const https = require('https');

const createPOSCartLatest = async (req, res) => {
  const startTime = Date.now();

  // Basic auth credentials for Razorpay REST API
  const base64Credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

  // Test authentication
  try {
    const testResponse = await axios.get('https://api.razorpay.com/v1/payments', {
      headers: { Authorization: `Basic ${base64Credentials}` },
      timeout: 15000,
      httpsAgent: new https.Agent({ keepAlive: false })
    });
    console.log("🔍 TEST AUTH SUCCESS:", testResponse.data);
  } catch (testError) {
    console.error("🔍 TEST AUTH FAILED:", {
      message: testError.message,
      response: testError.response?.data || 'No response data'
    });
  }

  try {
    const { inmateId, products } = req.body;

    // 1️⃣ User & location checks
    const userData = await userModel.findById(req.user.id).populate("location_id");
    if (!userData?.location_id) return res.status(404).json({ success: false, message: "User has no location" });
    if (userData.location_id.purchaseStatus === "denied")
      return res.status(403).json({ success: false, message: "Application under maintenance" });

    // 2️⃣ Validate products
    if (!inmateId || !Array.isArray(products) || products.length === 0)
      return res.status(400).json({ success: false, message: "Missing required fields" });

    for (const item of products) {
      if (!item.productId || !item.quantity)
        return res.status(400).json({ success: false, message: "Each product must have productId and quantity" });
    }

    // 3️⃣ Check inmate
    const inmate = await Inmate.findOne({ inmateId });
    if (!inmate) return res.status(400).json({ success: false, message: "Inmate ID does not exist" });
    const paymentMandate = await InmatePaymentMandate.findOne({ inmateId: inmate.inmateId }).sort({ createdAt: -1 });
    if (!paymentMandate?.mandateId || !paymentMandate.customerId) {
      return res.status(400).json({ success: false, message: "No active mandate found! Setup auto-pay first." });
    }

    const mandateId = paymentMandate.mandateId; // Subscription ID
    const customerId = paymentMandate.customerId;
    console.log("🔥 USING MANDATE:", mandateId, "CUSTOMER:", customerId);

    // 5️⃣ Validate mandate
    let mandateDetails = null;
    try {
      mandateDetails = await razorpay.subscriptions.fetch(mandateId);
      console.log("<><>mandateDetails", JSON.stringify(mandateDetails, null, 2));

      if (mandateDetails.status !== 'active' && mandateDetails.status !== 'authenticated') {
        return res.status(400).json({ success: false, message: "Mandate is not active or authenticated" });
      }
      if (mandateDetails.customer_id !== customerId) {
        return res.status(400).json({ success: false, message: "Mandate does not belong to this customer" });
      }
    } catch (err) {
      console.error("❌ MANDATE VALIDATION FAILED:", err.message);
      return res.status(500).json({ success: false, message: "Failed to validate mandate" });
    }

    // 6️⃣ Check stock & calculate total
    let totalAmount = 0;
    const productDetails = [];
    for (const item of products) {
      const tuckItem = await TuckShop.findById(item.productId);
      if (!tuckItem) return res.status(404).json({ success: false, message: `Product ${item.productId} not found` });
      if (tuckItem.stockQuantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${tuckItem.itemName}". Available: ${tuckItem.stockQuantity}, Requested: ${item.quantity}`
        });
      }
      totalAmount += tuckItem.price * item.quantity;
      productDetails.push({
        productId: tuckItem._id,
        itemName: tuckItem.itemName,
        quantity: item.quantity,
        price: tuckItem.price,
        subtotal: tuckItem.price * item.quantity
      });
    }

    console.log(`🛒 CART TOTAL: ₹${totalAmount}`);

    // 7️⃣ Check limits
    const depositLim = await checkTransactionLimit(inmateId, totalAmount, "spend");
    if (!depositLim.status) return res.status(400).json({ success: false, message: depositLim.message });

    const checkRechargeTransactionLim = await checkProductsLimit(inmateId, products);
    if (!checkRechargeTransactionLim.status) return res.status(400).json({ success: false, message: checkRechargeTransactionLim.message });

    // 8️⃣ Create POS cart
    const newCart = new POSShoppingCart({
      inmateId: inmate._id,
      totalAmount,
      products: productDetails,
      status: "pending"
    });
    const savedCart = await newCart.save();
    console.log("🛒 CART CREATED:", savedCart._id);

    // 🔥 9️⃣ INSTANT MANDATE PAYMENT PROCESSING
    const amountInPaise = Math.round(totalAmount * 100); // e.g., 5000 paise for ₹50
    console.log("💰 AMOUNT:", totalAmount, "→", amountInPaise, "paise");

    // STEP 1: CREATE ORDER
    const orderOptions = {
      amount: amountInPaise,
      currency: "INR",
      receipt: `tuck_${Date.now()}_${savedCart._id.toString().slice(0, 8)}`,
      notes: {
        cartId: savedCart._id.toString(),
        mandate_id: mandateId,
        inmate_id: inmateId,
        type: "instant_purchase",
        location_id: userData.location_id._id.toString()
      }
    };

    console.log("📝 CREATING ORDER:", JSON.stringify(orderOptions, null, 2));
    const order = await razorpay.orders.create(orderOptions);
    console.log("⚡ ORDER CREATED:", order.id);

    // STEP 2: PROCESS MANDATE PAYMENT (using REST API with payments)
    let paymentResult = null;
    try {
      const paymentPayload = {
        amount: amountInPaise,
        currency: "INR",
        order_id: order.id,
        customer_id: customerId,
        token: mandateId, // Subscription ID as token
        recurring: true, // Indicate recurring payment using mandate
        method: mandateDetails.payment_method || "upi",
        description: `Tuckshop purchase for ${inmateId} - ₹${totalAmount}`,
        notes: {
          cartId: savedCart._id.toString(),
          mandate_id: mandateId,
          order_id: order.id,
          type: "instant_mandate_capture",
          inmate_id: inmateId
        }
      };

      console.log("📝 CREATING PAYMENT (REST):", JSON.stringify(paymentPayload, null, 2));
      console.log("<><>base64Credentials",base64Credentials)
      const paymentResponse = await axios.post(
        'https://api.razorpay.com/v1/payments',
        paymentPayload,
        {
          headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
          timeout: 15000,
          httpsAgent: new https.Agent({ keepAlive: false })
        }
      );

      console.log(".....................................................................");
      console.log("<><>paymentResponse", paymentResponse.data);
      console.log(".....................................................................");

      paymentResult = paymentResponse.data;
      console.log("💳 PAYMENT CREATED (REST):", paymentResult.id, "Status:", paymentResult.status);

      // Capture the payment if authorized
      if (paymentResult.status === 'authorized') {
        const captureResponse = await axios.post(
          `https://api.razorpay.com/v1/payments/${paymentResult.id}/capture`,
          { amount: amountInPaise, currency: "INR" },
          {
            headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
            timeout: 10000,
            httpsAgent: new https.Agent({ keepAlive: false })
          }
        );

        paymentResult = captureResponse.data;
        console.log("🔒 PAYMENT CAPTURED (REST):", paymentResult.id, "Status:", paymentResult.status);
      }
    } catch (paymentError) {
      console.error("❌ PAYMENT FAILED (REST):", {
        message: paymentError.message,
        response: paymentError.response?.data || 'No response data',
        stack: paymentError.stack
      });

      // Fallback to payment link
      try {
        const callbackUrl = process.env.BASE_URL ? `${process.env.BASE_URL.replace(/\/$/, '')}/api/payment/callback` : null;
        if (!callbackUrl) throw new Error('Missing BASE_URL env for payment link callback_url');

        const paymentLinkPayload = {
          amount: amountInPaise,
          currency: "INR",
          customer_id: customerId,
          description: `Instant Tuckshop Purchase - ${inmateId}`,
          notes: {
            cartId: savedCart._id.toString(),
            mandate_id: mandateId,
            type: "instant_purchase_fallback",
            inmate_id: inmateId
          },
          callback_url: callbackUrl
        };

        const paymentLinkResponse = await axios.post(
          'https://api.razorpay.com/v1/payment_links',
          paymentLinkPayload,
          {
            headers: { Authorization: `Basic ${base64Credentials}`, 'Content-Type': 'application/json' },
            timeout: 15000,
            httpsAgent: new https.Agent({ keepAlive: false })
          }
        );

        const paymentLink = paymentLinkResponse.data;
        console.log("🔗 PAYMENT LINK CREATED (fallback):", paymentLink.id);

        paymentResult = {
          id: paymentLink.id,
          status: paymentLink.status || "created",
          amount: amountInPaise,
          currency: "INR",
          method: "payment_link",
          notes: paymentLink.notes || {},
          short_url: paymentLink.short_url
        };
      } catch (linkError) {
        console.error("❌ PAYMENT LINK FAILED (fallback):", {
          message: linkError.message,
          response: linkError.response?.data || 'No response data',
          stack: linkError.stack
        });
        throw new Error("Failed to process mandate payment: " + (linkError.message || 'unknown'));
      }
    }

    // 10️⃣ VALIDATE PAYMENT STATUS
    const successStates = ['captured', 'paid'];
    if (!paymentResult || !successStates.includes(paymentResult.status)) {
      console.error("❌ PAYMENT NOT COMPLETED:", paymentResult?.status);

      savedCart.status = "failed";
      await savedCart.save();

      return res.status(400).json({
        success: false,
        message: "Payment processing failed. Please try again.",
        paymentStatus: paymentResult?.status || "unknown",
        paymentLink: paymentResult?.method === 'payment_link' ? paymentResult.short_url : undefined
      });
    }

    console.log("✅ PAYMENT SUCCESS:", paymentResult.id, paymentResult.status);

    // 11️⃣ DEDUCT STOCK
    for (const item of productDetails) {
      await TuckShop.findByIdAndUpdate(item.productId, { $inc: { stockQuantity: -item.quantity } });
      console.log(`📦 STOCK DEDUCTED: ${item.itemName} x${item.quantity}`);
    }

    // 12️⃣ UPDATE CART STATUS
    savedCart.status = "paid";
    savedCart.paymentId = paymentResult.id;
    savedCart.paymentStatus = paymentResult.status;
    savedCart.paymentMethod = paymentResult.method || "mandate";
    await savedCart.save();
    console.log("✅ CART UPDATED TO PAID:", savedCart._id);

    // 13️⃣ CREATE PAYMENT LOG
    await PaymentLog.create({
      inmateId: inmate._id,
      mandateId,
      customerId,
      paymentId: paymentResult.id,
      amount: totalAmount,
      currency: "INR",
      status: paymentResult.status,
      method: paymentResult.method || "mandate",
      notes: {
        cartId: savedCart._id.toString(),
        type: "tuckshop_purchase",
        location: userData.location_id.name || userData.location_id._id.toString()
      }
    });
    console.log("📝 PAYMENT LOG CREATED");

    // 14️⃣ AUDIT LOG
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      inmateId: inmate._id,
      action: "CREATE_AND_PAY",
      targetModel: "POSShoppingCart",
      targetId: savedCart._id,
      description: `⚡ INSTANT tuckshop purchase ₹${totalAmount} for ${inmateId}`,
      changes: {
        totalAmount,
        products: productDetails,
        paymentId: paymentResult.id,
        method: paymentResult.method || "mandate"
      }
    });

    // 15️⃣ NOTIFICATION
    console.log("📱 NOTIFICATION: Order delivered to", inmateId);

    const timeTaken = Date.now() - startTime;
    console.log(`⚡ TOTAL PROCESSING TIME: ${timeTaken}ms`);

    return res.status(201).json({
      success: true,
      data: {
        cart: {
          id: savedCart._id,
          inmateId,
          totalAmount,
          products: productDetails,
          status: savedCart.status,
          createdAt: savedCart.createdAt
        },
        payment: {
          id: paymentResult.id,
          status: paymentResult.status,
          method: paymentResult.method || "mandate",
          amount: totalAmount,
          payment_link: paymentResult.method === 'payment_link' ? paymentResult.short_url : undefined
        },
        processingTime: `${timeTaken}ms`
      },
      message: `⚡ INSTANT SUCCESS! ₹${totalAmount} delivered to ${inmateId} - NO OTP REQUIRED!`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ CRITICAL ERROR in createPOSCart:", {
      message: error.message || "No error message provided",
      stack: error.stack || "No stack trace provided",
      errorDetails: error,
      timestamp: new Date().toISOString(),
      userId: req.user?.id,
      inmateId: req.body?.inmateId
    });

    // Rollback any partial changes (mark pending cart as failed)
    if (req.body?.inmateId) {
      try {
        const inmate = await Inmate.findOne({ inmateId: req.body.inmateId });
        if (inmate) {
          const recentCart = await POSShoppingCart.findOne({
            inmateId: inmate._id,
            status: "pending",
            createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
          });

          if (recentCart) {
            recentCart.status = "failed";
            await recentCart.save();
            console.log("🔄 ROLLBACK: Cart marked as failed:", recentCart._id);
          }
        }
      } catch (rollbackError) {
        console.error("❌ ROLLBACK FAILED:", rollbackError.message);
      }
    }

    const timeTaken = Date.now() - startTime;
    return res.status(500).json({
      success: false,
      message: "Server error during payment processing",
      error: process.env.NODE_ENV === "development" ? (error.message || "Unknown error") : "Internal server error",
      processingTime: `${timeTaken}ms`
    });
  }
};












const getAllPOSCarts = async (req, res) => {
  try {
    const carts = await POSShoppingCart.find().populate("products.productId").sort({ createdAt: -1 });

    if (!carts || carts.length === 0) {
      return res.status(404).json({ success: false, message: "No carts found", data: [] });
    }

    res.status(200).json({ success: true, data: carts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const getPOSCartById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid cart ID format" });
    }

    const cart = await POSShoppingCart.findById(id).populate("products.productId");

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    res.status(200).json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const updatePOSCart = async (req, res) => {
  try {
    const { id } = req.params;
    const updateBody = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const updatedCart = await POSShoppingCart.findByIdAndUpdate(id, updateBody, {
      new: true,
      runValidators: true,
    });

    if (!updatedCart) {
      return res.status(404).json({ message: "POS cart not found" });
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE',
      targetModel: 'POSShoppingCart',
      targetId: updatedCart._id,
      description: `Updated POS cart for inmate ${updatedCart.inmateID}`,
      changes: updateBody
    });

    res.status(200).json({ success: true, data: updatedCart, message: "POS cart updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const deletePOSCart = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const deletedCart = await POSShoppingCart.findByIdAndDelete(id);

    if (!deletedCart) {
      return res.status(404).json({ message: "POS cart not found" });
    }
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      targetModel: 'POSShoppingCart',
      targetId: deletedCart._id,
      description: `Deleted POS cart for inmate ${deletedCart.inmateID}`,
      changes: deletedCart
    });
    res.status(200).json({ success: true, message: "POS cart deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const reversePOSCart = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role != "ADMIN") return res.status(404).send({ success: false, message: "Only admins are allowed to use this feature" })
    const posCartData = await POSShoppingCart.findById(id);
    if (!posCartData) {
      return res.status(404).json({ success: false, message: "POS cart not found" });
    }

    if (posCartData.is_reversed) {
      return res.status(400).json({ success: false, message: "This order is already reversed" });
    }

    const inmateData = await Inmate.findOne({ inmateId: posCartData.inmateId });
    if (!inmateData) {
      return res.status(404).json({ success: false, message: "Inmate not found" });
    }

    for (const item of posCartData.products) {
      await TuckShop.findByIdAndUpdate(
        item.productId,
        { $inc: { stockQuantity: item.quantity } },
        { new: true }
      );
    }

    inmateData.balance += posCartData.totalAmount;
    await inmateData.save();

    posCartData.is_reversed = true;
    await posCartData.save();

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: "DELETE",
      targetModel: "POSShoppingCart",
      targetId: posCartData._id,
      description: `Reversed POS cart for inmate ${posCartData.inmateId} (Custody Type: ${inmateData.custodyType})`,
      changes: {
        ...posCartData.toObject(),
        custodyType: inmateData.custodyType
      }
    });

    return res.json({
      success: true,
      message: "POS order reversed successfully",
      data: {
        posCartData,
        updatedInmateBalance: inmateData.balance
      }
    });
  } catch (error) {
    console.error("Reverse POS error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};
module.exports = { createPOSCart, getPOSCartById, getAllPOSCarts, updatePOSCart, deletePOSCart, reversePOSCart };
