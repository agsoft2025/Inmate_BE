const Razorpay = require("razorpay");

const createRazorpayInstance = ({ key_id, key_secret }) => {
  return new Razorpay({
    key_id,
    key_secret,
  });
};

module.exports = createRazorpayInstance;