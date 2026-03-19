const jwt = require('jsonwebtoken');
const tokenBlacklist = require('../utils/blackList');
const userModel = require('../model/userModel');
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ message: "Token has been invalidated" });
  }

  jwt.verify(token, JWT_SECRET,async (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid token" });
    }
    const userExist = await userModel.findById(user.id);
    if(!userExist){
      return res.status(403).send({success:false,message:"user does not exist"});
    }
    req.user = {
      id: user.id,
      username: user.username,
      role:user.role
    };
    next();
  });
};


module.exports = authenticateToken;
