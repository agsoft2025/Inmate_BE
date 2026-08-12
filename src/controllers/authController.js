const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dotenv = require('dotenv').config();
const UserSchema = require("../model/userModel");
const logAudit = require('../utils/auditlogger');
const tokenBlacklist = require("../utils/blackList");
const userModel = require("../model/userModel");
const inmateModel = require("../model/inmateModel");
const { sendWhatsAppOTP } = require("../service/sms.service");
const { resolveFaceMatch } = require("../service/faceRecognitionService");
const { isSuperAdminRole } = require("../utils/adminHierarchy");
const { logError } = require("../utils/safeLog");

exports.login = async (req, res) => {
    try {
        const { username, password, descriptor } = req.body;

        if (descriptor) {
            const allUsers = await UserSchema.find({}, { descriptor: 1, username: 1, role: 1, fullname: 1, isDeleted: 1 });

            // Account-takeover fix: resolveFaceMatch() is ambiguity-aware -
            // it refuses to pick a "best" match when a second enrolled user
            // is also close enough to plausibly be the same face, instead
            // of always trusting whichever candidate happens to be a hair
            // closer. See service/faceRecognitionService.js.
            const { matched, ambiguous, bestMatch, distance } = resolveFaceMatch(descriptor, allUsers);

            if (ambiguous) {
                return res.status(400).json({
                    message: "Face match is ambiguous. Please sign in with your username and password.",
                    distance,
                });
            }

            if (!matched) {
                // Face Verification Hardening: include the closest distance
                // we found (when any candidate existed) so the frontend can
                // show a more useful "why did this fail?" reason than a bare
                // generic message.
                return res.status(400).json({
                    message: "Face not recognized",
                    distance: bestMatch ? distance : null,
                });
            }

            if (bestMatch.isDeleted) {
                return res.status(403).json({ message: "Account has been deactivated. Please contact the Super Admin." });
            }

            // Face recognition is a probabilistic, spoofable single factor
            // (a photo/video can be presented to a camera, and even a
            // genuine match is only ever "close enough", not exact). It
            // must never by itself be sufficient to issue the
            // highest-privilege token in the system - SUPER ADMIN accounts
            // are required to sign in with a password instead.
            if (isSuperAdminRole(bestMatch.role)) {
                return res.status(403).json({
                    message: "Face login is not available for this account. Please sign in with your username and password.",
                });
            }

            const token = jwt.sign(
                { id: bestMatch.id, username: bestMatch.username, role: bestMatch.role },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            await logAudit({
                user: { id: bestMatch.id, username: bestMatch.username },
                username: bestMatch.username,
                action: 'LOGIN',
                targetModel: 'User',
                targetId: bestMatch._id,
                description: `User ${bestMatch.username} logged in via face recognition`
            });

            return res.json({
                token,
                user: {
                    id: bestMatch.id,
                    username: bestMatch.username,
                    fullName: bestMatch.fullname,
                    role: bestMatch.role
                },
                distance
            });
        }

        if (!username || !password) {
            return res.status(400).json({ message: "Username and password required" });
        }
        const cleanUserName = username.trim()
        const user = await UserSchema.findOne({ username: cleanUserName })
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        if (user.isDeleted) {
            return res.status(403).json({ message: "Account has been deactivated. Please contact the Super Admin." });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        await logAudit({
            user: { id: user.id, username: user.username },
            username: user.username,
            action: 'LOGIN',
            targetModel: 'User',
            targetId: user._id,
            description: `User ${user.username} logged in`
        });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.fullname,
                role: user?.role
            }
        });
    } catch (error) {
        logError("login error:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
}


exports.logout = async (req, res) => {
    try {
        const user = req.user;
        const token = req.headers.authorization?.split(" ")[1];

        if (!user || !token) {
            return res.status(401).json({ message: "Unauthorized: No user or token found" });
        }

        // Add token to blacklist
        tokenBlacklist.add(token);

        await logAudit({
            user: { id: user.id, username: user.username },
            username: user.username,
            action: 'LOGOUT',
            targetModel: 'User',
            targetId: user.id,
            description: `User ${user.username} logged out`
        });

        // clear cookie counterparts so client resets location selection
        res.clearCookie("selectedLocation", { path: "/" });
        res.clearCookie(`selectedLocation_${user.id}`, { path: "/" });

        res.cookie("selectedLocation", "", {
          maxAge: 0,
          path: "/",
        });
        res.cookie(`selectedLocation_${user.id}`, "", {
          maxAge: 0,
          path: "/",
        });

        res.status(200).json({ message: "Logout successful" });

    } catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// native application

exports.loginMobile = async (req, res) => {
    try {
        const { username, password } = req.body
        
        if (!username) return res.status(400).send({ status: false, message: "user name required" })
        if (!password) return res.status(400).send({ status: false, message: "password required" })
        const user = await userModel.findOne({ username: username })
    
        if (!user) return res.status(400).send({ status: false, message: "invalid username" })

        if (user.isDeleted) {
            return res.status(403).send({ status: false, message: "Account has been deactivated. Please contact the Super Admin." });
        }

        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) return res.status(401).send({ status: false, message: "invalid password" })

        if (user.role === "INMATE") {
            
            if (user.subscription && user.subscriptionEnd <= Date.now()) {
                // subscription expired → turn it off
                user.subscription = false;
                await user.save();
            }
            if (!user.subscription) {
                // const token = jwt.sign(
                //     { id: user.id, username: user.username, role: user.role },
                //     process.env.JWT_SECRET,
                //     { expiresIn: '24h' }
                // );
                return res.json({
                    // token,
                    status: false,
                    user: {
                        id: user.id,
                        username: user.username,
                        fullName: user.fullname,
                        role: user?.role,
                        subscription: user?.subscription
                    },
                    message: "user not subscribe"
                });

            }
            if (user.otpLockedUntil && user.otpLockedUntil > Date.now()) {
                const minutesLeft = Math.ceil((user.otpLockedUntil - Date.now()) / 60000);
                return res.status(429).send({
                    status: false,
                    message: `Too many attempts. Try again after ${minutesLeft} minutes`
                });
            }

            const otp = Math.floor(1000 + Math.random() * 9000).toString();
            user.otp = otp;
            user.otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

            user.otpAttempts = 0;
            user.otpAttemptedAt = null;
            user.otpLockedUntil = null;
            await user.save();
            const inmateData = await inmateModel.findOne({ user_id: user._id })
            // const smsResponse = await sendSMS(otp, studentData.contact_number)
            await sendWhatsAppOTP(inmateData.phonenumber, otp, inmateData.firstName)

            // if (!smsResponse.status) {
            //     return res.status(400).send({ status: false, message: smsResponse.message })
            // }
            await logAudit({
                user: { id: user.id, username: user.username },
                username: user.username,
                action: 'LOGIN',
                targetModel: 'User',
                targetId: user._id,
                description: `User ${user.username} logged in`
            });
            return res.status(200).send({
                status: true,
                otp,
                user: {
                    id: user.id,
                    username: user.username,
                    fullName: user.fullname,
                    role: user?.role,
                    subscription: user?.subscription
                },
                message: "OTP has been sent successfully to your registered mobile number"
            })

        }else{
            res.status(400).send({status:false,message:"please check the service"})
        }

    } catch (error) {
        logError("loginMobile error:", error);
        return res.status(500).send({status:false,message:"internal server down",error:error.message})
    }
}

exports.verifyOTP = async (req, res) => {
    const { username, otp } = req.body;
    console.log("verifyOTP: request received", { username });
    try {
        if (!username) return res.status(400).send({ status: false, message: "Username is required" });

        if (!otp) return res.status(400).send({ status: false, message: "OTP is required" });

        const user = await UserSchema.findOne({ username });

        if (!user) return res.status(400).send({ status: false, message: "Invalid username. Please contact admin." });

        if (user.isDeleted) {
            return res.status(403).json({ status: false, message: "Account has been deactivated. Please contact the Super Admin." });
        }

        // Check if locked due to too many attempts
        if (user.otpLockedUntil && user.otpLockedUntil > Date.now()) {
            const minutesLeft = Math.ceil((user.otpLockedUntil - Date.now()) / 60000);
            return res.status(429).send({
                status: false,
                message: `Too many incorrect attempts. Try again after ${minutesLeft} minutes`
            });
        }

        // Check if OTP was generated
        if (!user.otp || !user.otpExpiresAt) {
            return res.status(400).json({ status: false, message: "OTP not generated" });
        }

        // Check OTP Expiry
        if (user.otpExpiresAt < Date.now()) {
            return res.status(400).json({
                status: false,
                message: "OTP has expired. Please request a new one."
            });
        }

        // Incorrect OTP
        if (otp !== user.otp) {
            user.otpAttempts = (user.otpAttempts || 0) + 1;
            user.otpAttemptedAt = new Date();

            // Lock user after 5 failed attempts
            if (user.otpAttempts >= 5) {
                user.otpLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            }

            await user.save();

            return res.status(400).json({
                status: false,
                message: "Invalid OTP"
            });
        }

        // Correct OTP — Reset OTP fields
        user.otp = null;
        user.otpExpiresAt = null;
        user.otpAttempts = 0;
        user.otpLockedUntil = null;

        await user.save();

        // Generate Token
        const token = jwt.sign(
            { id: user._id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "24h" }
        );

        // Audit log
        await logAudit({
            user: { id: user.id, username: user.username },
            username: user.username,
            action: "LOGIN",
            targetModel: "User",
            targetId: user._id,
            description: `User ${user.username} logged in successfully`
        });

        return res.status(200).json({
            status: true,
            message: "OTP verified successfully",
            token,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.fullname,
                role: user.role,
                subscription: user.subscription
            }
        });

    } catch (error) {
        logError("verifyOTP error:", error);
        return res.status(500).json({
            status: false,
            message: "Server error",
            error: error.message
        });
    }
};
