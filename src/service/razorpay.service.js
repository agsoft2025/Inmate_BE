const razorpay = require('../utils/razorpayInstance');

exports.createOrder = async (amount, receipt) => {
  const options = {
    amount: amount * 100, // convert to paise
    currency: "INR",
    receipt,
  };
  return await razorpay.orders.create(options);
};