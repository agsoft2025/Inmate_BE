const jwt = require('jsonwebtoken');
const tokenBlacklist = require('../utils/blackList');
const userModel = require('../model/userModel');
const { AUTH_COOKIE_NAME } = require('../config/authCookies');
const { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = require('./csrf');
const JWT_SECRET = process.env.JWT_SECRET;

// CSRF only needs to be checked on requests that change state - a GET
// can't be made to do anything harmful even if forged.
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const authenticateToken = (req, res, next) => {
  // Prefer the httpOnly auth cookie set by authController.js's `login` for
  // browser (Inmate_FE) clients. Fall back to the Authorization header for
  // callers that can't use cookies at all - the native mobile app's
  // `login/mobile` + `login/verify` (OTP) flow, and any other external
  // caller of `/payment`, `/mandate`, etc. - which still receive the JWT in
  // the response body and send it back as `Authorization: Bearer <token>`,
  // exactly as before this fix.
  const cookieToken = req.cookies && req.cookies[AUTH_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = cookieToken || headerToken;
  const authViaCookie = Boolean(cookieToken);

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
    if (userExist.isDeleted) {
      return res.status(403).send({ success: false, message: "Account has been deactivated. Please contact the Super Admin." });
    }

    // CSRF protection: only relevant when auth came from the cookie, since
    // browsers attach cookies automatically to cross-site requests too - a
    // request authenticated via the Authorization header (mobile app /
    // external caller) isn't auto-attached by a browser, so it isn't a CSRF
    // target and is exempt. Double-submit check: the value must be present
    // in both a cookie the attacker's page can't read (cross-origin) and a
    // custom header the attacker's page can't set on our behalf.
    if (authViaCookie && STATE_CHANGING_METHODS.has(req.method)) {
      const cookieCsrf = req.cookies && req.cookies[CSRF_COOKIE_NAME];
      const headerCsrf = req.headers[CSRF_HEADER_NAME];
      if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
        return res.status(403).json({ message: "Invalid or missing CSRF token" });
      }
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: userExist.role || user.role,
      location_id: userExist.location_id ? userExist.location_id.toString() : null,
      rootAdminId: userExist.rootAdminId ? userExist.rootAdminId.toString() : null,
      inmateId: userExist.inmateId || null,
    };
    // Exposed so logout() blacklists the exact token that was actually
    // verified, whether it came from the cookie or the header.
    req.token = token;
    req.authViaCookie = authViaCookie;
    next();
  });
};


module.exports = authenticateToken;
