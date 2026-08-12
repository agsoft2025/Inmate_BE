const RateLimitCounter = require('../model/rateLimitModel');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 100;

/**
 * Fixed-window, MongoDB-backed rate limiter. Reuses the app's existing
 * database connection (see model/rateLimitModel.js) instead of adding a
 * new dependency/store - counters therefore survive process restarts and
 * stay correct even if the app ever runs as more than one instance.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs] - window size in ms (default 15 min)
 * @param {number} [options.max] - max requests allowed per window (default 100)
 * @param {string} [options.keyPrefix='rl'] - namespaces this limiter's
 *   counters from every other limiter's, so e.g. the global limiter and a
 *   route-specific limiter never share a bucket even for the same caller
 * @param {(req: import('express').Request) => string} [options.keyGenerator] -
 *   defaults to the caller's IP (req.ip)
 * @param {(req: import('express').Request) => boolean} [options.skip] -
 *   when it returns true the request passes through uncounted (e.g. only
 *   rate-limiting PUT /users/:id when the request body is actually
 *   attempting a password change)
 * @param {string} [options.message]
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_WINDOW_MS;
  const max = Number(options.max) > 0 ? Number(options.max) : DEFAULT_MAX;
  const keyPrefix = options.keyPrefix || 'rl';
  const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : (req) => req.ip;
  const skip = typeof options.skip === 'function' ? options.skip : null;
  const message = options.message || 'Too many requests. Please try again later.';

  return async function rateLimiter(req, res, next) {
    try {
      if (skip && skip(req)) {
        return next();
      }

      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const key = `${keyPrefix}:${keyGenerator(req)}`;
      // A little past the window's end, purely so the TTL cleanup of this
      // document doesn't race the window it's still supposed to cover.
      const expiresAt = new Date(windowStart + windowMs + 60 * 1000);

      // Atomic increment-or-create: every concurrent request in the same
      // window for the same key increments the same document, so counting
      // is correct under concurrency without a separate read-then-write.
      const counter = await RateLimitCounter.findOneAndUpdate(
        { key, windowStart },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true }
      );

      const remaining = Math.max(0, max - counter.count);
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', String(remaining));

      if (counter.count > max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ success: false, message });
      }

      return next();
    } catch (error) {
      // Fail OPEN: a rate-limit store hiccup must never be the reason a
      // legitimate request fails. If MongoDB itself is unavailable, the
      // rest of the app (which depends on it for every request) is
      // already down, so this doesn't meaningfully weaken protection in
      // practice - it just avoids the limiter being a second, independent
      // point of failure on top of that.
      console.error('Rate limiter error:', error.message);
      return next();
    }
  };
}

module.exports = createRateLimiter;
