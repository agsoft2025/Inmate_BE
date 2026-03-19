const Transaction = require("../model/transactionModel");
const inmateModel = require("../model/inmateModel");
const { createOrder } = require("../service/razorpay.service");
const financialModel = require("../model/financialModel");
const InmateLocation = require("../model/inmateLocationModel");
const axios = require("axios")
const crypto = require("crypto");
const userModel = require("../model/userModel");

exports.inmateCreatePayment = async (req, res) => {
  try {
    console.log("<><>req.body",req.body)
    const { inmateId, amount } = req.body;

    const inmate = await inmateModel.findOne({ inmateId:inmateId });
    console.log(inmate)
    if (!inmate) {
      return res.status(400).json({ success: false, message: "Inmate not found" });
    }

    const receipt = `order_INM_${inmateId}_${Date.now().toString().slice(-6)}`;
    const order = await createOrder(amount, receipt);

    // ✅ SAME Transaction table as student
    const transaction = await Transaction.create({
     inmate_id:inmateId,
      order_id: order.id,
      amount,
      user_id: inmate.user_id,   // who initiated payment
      status: "created"
    });

    res.status(200).json({
      success: true,
      order,
      transactionId: transaction._id
    });
  } catch (error) {
    console.error(error);
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
    // 🔐 Step 1: Verify Razorpay signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature"
      });
    }

    // 💳 Step 2: Fetch transaction FIRST
    const transaction = await Transaction.findOne({
      order_id: razorpay_order_id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    // 🚫 Prevent double wallet credit
    if (transaction.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment already processed"
      });
    }

    // ✅ Step 3: Mark transaction as paid
    transaction.payment_id = razorpay_payment_id;
    transaction.status = "paid";
    await transaction.save();

    // 💰 Step 4: Increase inmate wallet balance (ATOMIC)
    const inmate = await inmateModel.findOneAndUpdate(
      { inmateId },
      { $inc: { balance: transaction.amount } },
      { new: true }
    );

    if (!inmate) {
      return res.status(404).json({
        success: false,
        message: "Inmate not found"
      });
    }

    // 🧾 Step 5: Ledger entry (Financial)
    await financialModel.create({
      inmateId,
      custodyType: "DEPOSIT",
      transaction: transaction._id.toString(),
      type: "CREDIT",
      status: "SUCCESS",
      depositName: "Wallet Topup",
      depositAmount: transaction.amount,
      depositType: "ONLINE_PAYMENT"
    });

    res.json({
      success: true,
      message: "Payment verified & wallet credited",
      balance: inmate.balance
    });

  } catch (error) {
    console.error("Verify error:", error);
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
    const inmateData = await inmateModel.findOne({ inmateId: inmateId })
    if(!inmateData){
      return res.status(400).send({status:false,message:"could not find inmateId"});
    }
    const shortReceipt = `order_${inmateData.inmateId}_${Date.now().toString().slice(-6)}`;
    // subscription_type:  ["MONTHLY", "QUARTERLY", "YEARLY"]
    const locationData = await InmateLocation.find()
    const payload = {
      amount,
      shortReceipt, inmateData,
      locationId: locationData[0].global_location_id,
      subscription_type: "MONTHLY",
      inmate_info:inmateData,
      month:Number(month)
    }
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
    console.error(error);
    res.status(500).json({ success: false, message: 'Order creation failed' });
  }
};

// 2️⃣ Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, inmateId,month } = req.body;
    console.log("<><>req.body",req.body);
     if (![1, 3, 6, 12].includes(Number(month))) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription duration",
      });
    }
    const inamteData = await inmateModel.findOne({inmateId})
    let user_id = inamteData.user_id
      const payload = { razorpay_order_id, razorpay_payment_id, razorpay_signature,inmateId:inamteData.user_id,month  }
    const expectedSignature = await axios.post(`${process.env.GLOBAL_URL}/api/payment/verify`, payload)
    
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
    console.error(error);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};