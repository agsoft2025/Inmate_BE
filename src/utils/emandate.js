const axios = require("axios");
const { logError } = require("./safeLog");

async function createMandate(customerId, maxAmount, inmateId) {
  try {
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_ID}`).toString("base64");

    const response = await axios.post(
      "https://api.razorpay.com/v1/mandates",
      {
        customer_id: customerId,
        method: "upi",
        amount: maxAmount * 100,
        currency: "INR",
        notes: { inmateId }
      },
      {
        headers: { Authorization: `Basic ${auth}` }
      }
    );

    return response.data; // ✅ should contain id, short_url, etc.
  } catch (error) {
    logError("createMandate error:", error);
    throw new Error(error.response?.data?.error?.description || error.message);
  }
}


module.exports = {
    createMandate
}