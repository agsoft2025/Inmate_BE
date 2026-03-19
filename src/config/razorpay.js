const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,       // Your Key ID
  key_secret: process.env.RAZORPAY_KEY_SECRET // Your Key Secret
});

module.exports = razorpay;
