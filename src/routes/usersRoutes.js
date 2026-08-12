const express = require('express');
const { createUser, getAllUsers, getUserById, deleteUser, updateUserById, defaultUser, faceRecongition, faceRecongitionMatch, deleteFaceRecognitionRecord } = require('../controllers/usersController');
const router = express.Router();
const authenticateToken = require('../middleware/authToken');
const createRateLimiter = require('../middleware/rateLimit');
const rateLimitConfig = require('../config/rateLimitConfig');

// PUT /:id doubles as the only password-change path in this app
// (oldPassword/newPassword) - there is no separate "forgot password"
// endpoint. `skip` only counts requests that actually attempt a password
// change, so ordinary profile edits (name/role/location/face) are never
// throttled.
const passwordChangeLimiter = createRateLimiter({
    ...rateLimitConfig.passwordChange,
    keyPrefix: 'password-change',
    keyGenerator: (req) => `${req.ip}:${req.params.id}`,
    skip: (req) => !req.body?.newPassword && !req.body?.oldPassword,
    message: 'Too many password change attempts for this account. Please try again later.',
});

router.use(authenticateToken)
router.post("/create",createUser);
router.get("/",getAllUsers);
router.post("/register",faceRecongition)
router.delete("/delete/:id",deleteFaceRecognitionRecord)
router.post("/match",faceRecongitionMatch)
router.get("/:id",getUserById);
router.put("/:id", passwordChangeLimiter, updateUserById);
router.delete("/:id",deleteUser);

module.exports = router;
