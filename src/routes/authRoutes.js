const express = require('express');
const { login, logout, loginMobile, verifyOTP } = require('../controllers/authController');
const authenticateToken = require('../middleware/authToken');
const { defaultUser } = require('../controllers/usersController');
const createRateLimiter = require('../middleware/rateLimit');
const rateLimitConfig = require('../config/rateLimitConfig');
const router = express.Router();

// Broad, IP-only protection shared by every login-adjacent route (password
// login, face login, mobile/OTP login, OTP verification) - bounds raw
// request flooding and credential-stuffing spread across many accounts
// from one source.
const loginIpLimiter = createRateLimiter({
    ...rateLimitConfig.authIp,
    keyPrefix: 'auth-ip',
    message: 'Too many login attempts from this network. Please try again later.',
});

// Stricter, per-target-account protection on /login specifically (the one
// route that accepts either a username+password or a face descriptor) -
// keyed by IP + whichever account is being attempted, so a sustained
// brute-force attack against one specific account is capped even while it
// stays under the broad IP ceiling above.
const loginAccountLimiter = createRateLimiter({
    ...rateLimitConfig.authAccount,
    keyPrefix: 'auth-account',
    keyGenerator: (req) => `${req.ip}:${String(req.body?.username || 'faceid').toLowerCase().trim()}`,
    message: 'Too many attempts for this account. Please try again later.',
});

router.get("/",(req,res)=>{
    return res.status(200).send({success:true,message:"server running successfully"});
})
router.post("/login", loginIpLimiter, loginAccountLimiter, login);
router.post("/login/mobile", loginIpLimiter, loginMobile)
router.post("/login/verify", loginIpLimiter, verifyOTP)
router.post("/logout",authenticateToken,logout);
router.get("/default",defaultUser)

module.exports = router;
