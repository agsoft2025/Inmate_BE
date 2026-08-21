const axios = require("axios");

// Trusted server-to-server client for calls this local server makes to
// InmateGlobalServer_BE (e.g. syncing its own location/tenant record).
const globalServiceClient = axios.create({
  baseURL: process.env.GLOBAL_URL,
  timeout: 5000,
  headers: {
    "x-internal-service-key": process.env.INTERNAL_SERVICE_KEY,
  },
});

module.exports = globalServiceClient;
