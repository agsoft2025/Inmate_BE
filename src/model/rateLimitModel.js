const mongoose = require('mongoose');

// Backs the fixed-window rate limiter in middleware/rateLimit.js. Reuses
// the app's existing MongoDB connection rather than introducing a new
// store (Redis, etc.) - counters therefore survive process restarts and
// stay consistent if the app is ever run as more than one instance, unlike
// an in-memory store.
const rateLimitCounterSchema = new mongoose.Schema({
  // "<limiter keyPrefix>:<caller identity>", e.g. "auth-ip:203.0.113.4" or
  // "payment:64f1...a2" (a user id).
  key: { type: String, required: true },
  // Start of the fixed window this counter belongs to, in epoch ms
  // (Math.floor(now / windowMs) * windowMs). Together with `key` this
  // uniquely identifies one counter document per caller per window.
  windowStart: { type: Number, required: true },
  count: { type: Number, default: 0 },
  // A little past the window's end - once this passes, MongoDB's TTL
  // monitor removes the document automatically, so this collection never
  // grows unbounded.
  expiresAt: { type: Date, required: true },
});

rateLimitCounterSchema.index({ key: 1, windowStart: 1 }, { unique: true });
rateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitCounter', rateLimitCounterSchema);
