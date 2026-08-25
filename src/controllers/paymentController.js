const Transaction = require("../model/transactionModel");
const inmateModel = require("../model/inmateModel");
const { createOrder } = require("../service/razorpay.service");
const financialModel = require("../model/financialModel");
const InmateLocation = require("../model/inmateLocationModel");
const axios = require("axios")
const crypto = require("crypto");
const userModel = require("../model/userModel");
const { logError, pick } = require("../utils/safeLog");
const { requireLocationFilter, LocationAccessError } = require("../utils/locationAccess");

// Resolves the caller's authorized location scope the same way every other
// facility-scoped controller in this app does. /payment doesn't mount
// attachLocationFilter (it also has to work for the mobile app's
// header-token-authenticated INMATE sessions, which authenticateToken
// already populates req.user.location_id/inmateId for identically), so this
// is computed inline rather than assumed to already be on req.
const getLocationFilterOrAbort = (req, res) => {
  try {
    return req.locationFilter ?? requireLocationFilter(req.user);
  } catch (error) {
    if (error instanceof LocationAccessError) {
      res.status(error.status).json({ success: false, message: error.message });
      return null;
    }
    throw error;
  }
};

const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

// An INMATE-role caller may only ever create/verify/subscribe a payment for
// their own inmate record, never another inmate's - staff (ADMIN/SUPER
// ADMIN/POS) are unrestricted beyond the facility scope already enforced by
// the locationFilter-based inmate lookup at each call site below.
const assertOwnRecordIfInmate = (req, res, resolvedInmateId) => {
  if (normalizeRole(req.user?.role) === "INMATE" && req.user?.inmateId !== resolvedInmateId) {
    res.status(403).json({ success: false, message: "Access denied: you may only manage your own payments" });
    return false;
  }
  return true;
};

// Razorpay's own id formats - a cheap, safe defense-in-depth check before
// these values are used to build the HMAC input or hit the DB/Razorpay API.
const ORDER_ID_RE = /^order_[A-Za-z0-9]+$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]+$/;

exports.inmateCreatePayment = async (req, res) => {
  try {
    const { inmateId, amount } = req.body;

    if (typeof inmateId !== "string" || !inmateId) {
      return res.status(400).json({ success: false, message: "A valid inmateId is required" });
    }
    // The amount a depositor chooses for their own wallet top-up is
    // legitimately client-supplied (there's no server-known "correct" value
    // to compute it against, unlike a POS cart total) - but its type/range
    // still has to be validated, since this exact number is what
    // inmateVerifyPayment will later credit to the wallet.
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ success: false, message: "A valid positive amount is required" });
    }

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;

    // Scoped to the caller's own facility - same pattern used everywhere
    // else in this app - so a request can't create a payment against
    // another facility's inmate just by sending that inmate's business id.
    const inmate = await inmateModel.findOne({ inmateId, ...locationFilter });
    if (!inmate) {
      return res.status(400).json({ success: false, message: "Inmate not found" });
    }
    if (!assertOwnRecordIfInmate(req, res, inmate.inmateId)) return;

    // Force-selects razorpay.keySecret/webhookSecret (select:false by
    // default on the model) because createOrder() below needs them to call
    // the Razorpay SDK - never log `razorpayConfig`/`locationData.razorpay`.
    const locationData = await InmateLocation.findById(inmate.location_id).select("+razorpay.keySecret");
    const razorpayConfig = locationData?.razorpay;
    if (!razorpayConfig || !razorpayConfig.isActive) {
      return res.status(400).json({ success: false, message: "Payment gateway not configured for this location" });
    }

    const receipt = `order_INM_${inmate.inmateId}_${Date.now().toString().slice(-6)}`;
    const order = await createOrder(amountNum, receipt, razorpayConfig);

    // ✅ SAME Transaction table as student
    const transaction = await Transaction.create({
      inmate_id: inmate.inmateId,
      order_id: order.id,
      amount: amountNum,
      user_id: inmate.user_id,   // who initiated payment
      status: "created"
    });

    res.status(200).json({
      success: true,
      order,
      transactionId: transaction._id
    });
  } catch (error) {
    logError("inmateCreatePayment error:", error);
    res.status(500).json({ success: false, message: "Order creation failed" });
  }
};

// exports.inmateVerifyPayment = async (req, res) => {
//   try {
//     const {
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//       inmateId,
//     } = req.body;

//     // 🔐 Verify signature
//     const body = razorpay_order_id + "|" + razorpay_payment_id;
//     const expectedSignature = crypto
//       .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
//       .update(body)
//       .digest("hex");

//     if (expectedSignature !== razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Invalid signature" });
//     }

//     // 💳 Update transaction
//     const transaction = await Transaction.findOneAndUpdate(
//       { order_id: razorpay_order_id },
//       {
//         payment_id: razorpay_payment_id,
//         status: "paid"
//       },
//       { new: true }
//     );

//     if (!transaction) {
//       return res.status(404).json({ success: false, message: "Transaction not found" });
//     }

//     // 🧾 Ledger entry (THIS is Financial)
//     await Financial.create({
//       inmateId: inmateId,
//       custodyType: "DEPOSIT",
//       transaction: transaction._id.toString(),
//       type: "CREDIT",
//       status: "SUCCESS",
//       depositName: "Wallet Topup",
//       depositAmount: transaction.amount,
//       depositType: "ONLINE_PAYMENT"
//     });

//     res.json({
//       success: true,
//       message: "Inmate wallet credited successfully"
//     });

//   } catch (error) {
//     console.error("Verify error:", error);
//     res.status(500).json({ success: false, message: "Payment verification failed" });
//   }
// };

exports.inmateVerifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      inmateId,
    } = req.body;

    // Every one of these is used either as a Mongo filter value below
    // (razorpay_order_id, inmateId) or concatenated into the HMAC input
    // (razorpay_order_id/razorpay_payment_id) - require them to be strings
    // up front rather than letting a non-string (e.g. {"$ne": null})
    // reach findOne()/findOneAndUpdate() as an operator object. Also check
    // Razorpay's own id formats as a cheap extra guard before either value
    // is used to build the HMAC input.
    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      typeof inmateId !== "string" ||
      !inmateId ||
      !ORDER_ID_RE.test(razorpay_order_id) ||
      !PAYMENT_ID_RE.test(razorpay_payment_id)
    ) {
      return res.status(400).json({ success: false, message: "Invalid payment verification payload" });
    }

    // 💳 Step 1: Fetch the transaction FIRST - it's the authoritative
    // record of which inmate/facility/amount this order was actually
    // created for. Every check below is against this record, never against
    // whatever the client resends in this request.
    const transaction = await Transaction.findOne({
      order_id: razorpay_order_id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    // The client-resent `inmateId` must agree with the inmate this
    // transaction was actually created for. Previously this value was used
    // directly as the wallet-credit target below instead of
    // `transaction.inmate_id` - a caller could redirect a real, validly-
    // signed payment's credit to an unrelated inmate's wallet just by
    // sending a different `inmateId` at verify time than at create time.
    if (inmateId !== transaction.inmate_id) {
      return res.status(400).json({ success: false, message: "inmateId does not match this transaction" });
    }

    const inmate = await inmateModel.findOne({ inmateId: transaction.inmate_id });
    if (!inmate) {
      return res.status(404).json({ success: false, message: "Inmate not found" });
    }

    // Facility-scope + self-service authorization, same as
    // inmateCreatePayment - a facility mismatch and a nonexistent
    // transaction are deliberately indistinguishable (both 404).
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    if (
      locationFilter.location_id &&
      String(inmate.location_id) !== String(locationFilter.location_id)
    ) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    if (!assertOwnRecordIfInmate(req, res, inmate.inmateId)) return;

    // 🔐 Step 2: Verify the Razorpay signature using the SAME per-location
    // credentials the order was created with (inmateCreatePayment) - not a
    // global fallback secret. A facility with its own Razorpay sub-account
    // signs its callbacks with its own key_secret; verifying with any other
    // secret either always fails (rejecting real payments) or verifies
    // against the wrong key entirely, undermining what the signature check
    // is actually meant to guarantee.
    const locationData = await InmateLocation.findById(inmate.location_id).select("+razorpay.keySecret");
    const keySecret = locationData?.razorpay?.keySecret;
    if (!keySecret) {
      return res.status(400).json({ success: false, message: "Payment gateway not configured for this location" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body)
      .digest("hex");

    // Constant-time comparison - a plain `!==` string compare leaks timing
    // information about how many leading hex characters matched, which is
    // avoidable for essentially free.
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    const providedBuf = Buffer.from(razorpay_signature, "hex");
    const signatureValid =
      expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!signatureValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature"
      });
    }

    // ✅ Step 3: Atomically mark the transaction as paid. Using an
    // update filtered on `status: {$ne: "paid"}` (rather than reading the
    // status, checking it in application code, and only then writing) makes
    // the check-and-set a single atomic DB operation - two requests racing
    // on the same still-"created" transaction (a duplicated or replayed
    // verify callback arriving twice in close succession) can no longer
    // both observe "not yet paid" and both credit the wallet.
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { _id: transaction._id, status: { $ne: "paid" } },
      { $set: { payment_id: razorpay_payment_id, status: "paid" } },
      { new: true }
    );

    if (!updatedTransaction) {
      return res.status(400).json({
        success: false,
        message: "Payment already processed"
      });
    }

    // 💰 Step 4: Increase inmate wallet balance (ATOMIC), using the
    // transaction's own recorded amount and inmate - never anything from
    // this request.
    const updatedInmate = await inmateModel.findOneAndUpdate(
      { inmateId: transaction.inmate_id },
      { $inc: { balance: updatedTransaction.amount } },
      { new: true }
    );

    if (!updatedInmate) {
      return res.status(404).json({
        success: false,
        message: "Inmate not found"
      });
    }

    // 🧾 Step 5: Ledger entry (Financial)
    await financialModel.create({
      inmateId: transaction.inmate_id,
      custodyType: "DEPOSIT",
      transaction: updatedTransaction._id.toString(),
      type: "CREDIT",
      status: "SUCCESS",
      depositName: "Wallet Topup",
      depositAmount: updatedTransaction.amount,
      depositType: "ONLINE_PAYMENT"
    });

    res.json({
      success: true,
      message: "Payment verified & wallet credited",
      balance: updatedInmate.balance
    });

  } catch (error) {
    logError("Verify error:", error);
    res.status(500).json({
      success: false,
      message: "Payment verification failed"
    });
  }
};

// global server
// 1️⃣ Create Razorpay Order global server
exports.createOrder = async (req, res) => {
  try {
    const { inmateId, amount,month } = req.body;
    if (typeof inmateId !== "string" || !inmateId) {
      return res.status(400).send({ status: false, message: "A valid inmateId is required" });
    }
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inmateData = await inmateModel.findOne({ inmateId, ...locationFilter })
    if(!inmateData){
      return res.status(400).send({status:false,message:"could not find inmateId"});
    }
    if (!assertOwnRecordIfInmate(req, res, inmateData.inmateId)) return;
    const shortReceipt = `order_${inmateData.inmateId}_${Date.now().toString().slice(-6)}`;
    // subscription_type:  ["MONTHLY", "QUARTERLY", "YEARLY"]
    const locationData = await InmateLocation.find()
    const payload = {
      amount,
      shortReceipt, inmateData,
      locationId: locationData[0].globalLocationId,
      subscription_type: "MONTHLY",
      inmate_info:inmateData,
      month:Number(month)
    }
    console.log("createOrder: sending global payment request", pick(payload, ["amount", "shortReceipt", "subscription_type", "month"]));
     orderData = await axios.post(`${process.env.GLOBAL_URL}/api/payment/create`, payload)
     orderData = orderData.data
    if(orderData?.subscription){
      return res.status(200).send({status:true,message:orderData.message})
    }
    const order = orderData.order
    // const transaction = new Transaction({
    //   student_id: studentId,
    //   order_id: order.id,
    //   amount,
    //   user_id: studentData.user_id
    // });
    // await transaction.save();
    res.status(200).json({ success: true, order, message:orderData?.data?.message || "default message" });
  } catch (error) {
    logError("createOrder error:", error);
    res.status(500).json({ success: false, message: 'Order creation failed' });
  }
};

// 2️⃣ Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, inmateId,month } = req.body;
    console.log("verifyPayment: request received", pick(req.body, ["inmateId", "month", "razorpay_order_id", "razorpay_payment_id"]));
     if (typeof inmateId !== "string" || !inmateId) {
      return res.status(400).json({ success: false, message: "A valid inmateId is required" });
    }
     if (![1, 3, 6, 12].includes(Number(month))) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription duration",
      });
    }
    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string"
    ) {
      return res.status(400).json({ success: false, message: "Invalid payment verification payload" });
    }

    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inamteData = await inmateModel.findOne({ inmateId, ...locationFilter })
    if (!inamteData) {
      return res.status(400).json({ success: false, message: "could not find inmateId" });
    }
    if (!assertOwnRecordIfInmate(req, res, inamteData.inmateId)) return;
    let user_id = inamteData.user_id
      const payload = { razorpay_order_id, razorpay_payment_id, razorpay_signature,inmateId:inamteData.user_id,month  }
    const verifyResponse = await axios.post(`${process.env.GLOBAL_URL}/api/payment/verify`, payload)

    // The axios call not throwing only means the global server responded
    // with a 2xx status - it does NOT by itself mean the payment signature
    // was actually verified. Previously this response was never inspected
    // at all, so ANY 2xx response - including one whose body reports a
    // failed verification - unconditionally activated the subscription
    // below. Require an explicit affirmative flag in the response body,
    // matching the {success:true/false}/{status:true/false} convention
    // this backend's own endpoints use everywhere else (createOrder above
    // included). If the global server's actual contract uses a different
    // field name, this should be updated to match it exactly.
    const verifyData = verifyResponse?.data || {};
    const verified = verifyData.success === true || verifyData.status === true || verifyData.verified === true;
    if (!verified) {
      return res.status(400).json({
        success: false,
        message: verifyData.message || "Payment verification failed"
      });
    }

     const subscriptionStart = new Date();
    const subscriptionEnd = new Date(subscriptionStart);
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + Number(month));

    await userModel.findByIdAndUpdate(user_id, {
      subscription: true,
      subscriptionStart: subscriptionStart,
      subscriptionPlan: `${month}_month`,
      subscriptionEnd: subscriptionEnd
    });

    res.json({ success: true, message: "Payment Subscription is updated" });
  } catch (error) {
    logError("verifyPayment error:", error);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};