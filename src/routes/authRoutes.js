const express = require('express');
const { login, logout, loginMobile, verifyOTP } = require('../controllers/authController');
const authenticateToken = require('../middleware/authToken');
const { defaultUser } = require('../controllers/usersController');
const router = express.Router();

router.get("/",(req,res)=>{
    return res.status(200).send({success:true,message:"server running successfully"});
})
router.post("/login",login);
router.post("/login/mobile",loginMobile)
router.post("/login/verify",verifyOTP)
router.post("/logout",authenticateToken,logout);
router.get("/default",defaultUser)

module.exports = router;