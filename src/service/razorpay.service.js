const createRazorpayInstance = require("../utils/razorpayInstance");

exports.createOrder = async (
  amount,
  receipt,
  razorpayConfig
) => {

  const razorpay = createRazorpayInstance({
    key_id: razorpayConfig.keyId,
    key_secret: razorpayConfig.keySecret,
  });

  const options = {
    amount: amount * 100,
    currency: "INR",
    receipt,
  };

  return await razorpay.orders.create(options);
};