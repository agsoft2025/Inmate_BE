const axios = require("axios");
exports.sendWhatsAppOTP = async (phone, otp,name) => {
  try {
    const url = `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone, // must be like 919XXXXXXXXX (no +)
      type: "template",
      template: {
        name: "system_info", // EXACT approved template name
        language: {
          code: "en_US"
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: `${name}`
              },
              {
                type: "text",
                text: otp.toString()
              }
            ]
          }
        ]
      }
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    return { success: true };

  } catch (error) {
    console.error("WhatsApp error:", error.response?.data || error.message);
    return { success: false };
  }
};