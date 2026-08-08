const UserSchema = require("../model/userModel");
const bcrypt = require('bcrypt');
const mongoose = require("mongoose");
const logAudit = require("../utils/auditlogger");
const userModel = require("../model/userModel");
const faceapi = require('face-api.js');
const inmateModel = require("../model/inmateModel");
const { faceRecognitionService, faceRecognitionExcludeUserService } = require("../service/faceRecognitionService");
const { resolveLocationId, LocationAccessError, requireLocationFilter } = require("../utils/locationAccess");
const { resolveAdminHierarchy, isAdminRole, isSuperAdminRole } = require("../utils/adminHierarchy");
const { buildSearchRegex } = require("../utils/searchUtils");

const canManageUsers = (role) => isAdminRole(role) || isSuperAdminRole(role);

const defaultUser = async (req, res) => {
    try {
        const users = await UserSchema.find({});
        if (users.length === 0) {
            const hashedPassword = await bcrypt.hash("admin@123", 10);

            const newUser = new UserSchema({
                username: "Admin",
                fullname: "admin",
                password: hashedPassword,
                role: "ADMIN",
            });

            await newUser.save();
            res.status(200).send({ success: true, message: "super admin created successfully" })
        } else {
            return res.status(200).send({ success: true, message: "user already created" })
        }
    } catch (error) {
        console.error("Error creating default user:", error.message);
    }
};

const createUser = async (req, res) => {
    try {
        const { username, fullname, role, password, locationId, descriptor } = req.body;
        if (!canManageUsers(req.user?.role)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        let assignedLocationId;
        try {
            assignedLocationId = await resolveLocationId(req.user, locationId);
        } catch (error) {
            if (error instanceof LocationAccessError) {
                return res.status(error.status).json({ success: false, message: error.message });
            }
            throw error;
        }

        if (!assignedLocationId) {
            return res.status(400).json({ message: "location is required" });
        }

        if (descriptor) {
              const checkFaceMatch = await faceRecognitionService(descriptor)
              if (checkFaceMatch.status) {
                return res.status(400).send({ success: false, message: `A face record already exists for user ${checkFaceMatch.username}` })
              }
            }

        if (!username || !fullname || !role || !password) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const existingUser = await UserSchema.findOne({ username });
        if (existingUser) {
            return res.status(409).json({ message: "Username already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new UserSchema({
            username,
            fullname,
            password: hashedPassword,
            role,
            location_id: assignedLocationId,
            descriptor,
        });

        if (isAdminRole(role)) {
            const hierarchy = await resolveAdminHierarchy(req.user.id);
            newUser.createdBy = hierarchy.createdBy;
            newUser.rootAdminId = hierarchy.rootAdminId;
        } else if (isSuperAdminRole(role)) {
            newUser.createdBy = req.user.id;
            newUser.rootAdminId = req.user.id;
        }
        const savedUser = await newUser.save();

        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'CREATE',
            targetModel: 'User',
            targetId: savedUser._id,
            description: `Created new user "${savedUser.username}" with role "${savedUser.role}"`,
            changes: {
                username: savedUser.username,
                fullname: savedUser.fullname,
                role: savedUser.role
            }
        });

        res.status(201).json({ success: true, data: savedUser, message: "User created successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

const faceRecongition = async (req, res) => {
    try {
        const { descriptor, userId } = req.body
        const isExistingFaceRecognition = await faceRecognitionService(descriptor)
        await userModel.findByIdAndUpdate(userId, { descriptor: descriptor }).then(data => {
            return res.status(200).send({ success: true, data: req.body.descriptor, message: "success continue" })
        }).catch((err) => {
            res.status(500).send({ success: false, message: "internal server down", err });
        })

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message,
        });
    }
}

const faceRecongitionMatch = async (req, res) => {
    try {
        const { userId, descriptor } = req.body
        const checkFace = await faceRecognitionService(descriptor)
        if (checkFace.status) {
            return res.status(403).send({ sucess: false, message: "Face recognition record already exists" });
        }
        if (!userId) return res.status(404).send({ success: false, message: "user id could not find" })
        if (!descriptor) return res.status(404).send({ success: false, message: "descriptor could not find" })
        const userData = await userModel.findById(userId)
        const distance = faceapi.euclideanDistance(userData.descriptor, descriptor);
        const THRESHOLD = 0.4;
        const faceMatch = distance < THRESHOLD;
        if (faceMatch) {
            return res.status(200).send({ success: true, message: "face recognition success", faceMatch: faceMatch })
        } else {
            return res.status(200).send({ success: false, message: "face recognition not match", faceMatch: faceMatch })
        }

    } catch (error) {
        res.status(500).send({ success: false, message: "internal server down", error: error })
    }
}

const getAllUsers = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sortField = req.query.sortField || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    try {
        if (!canManageUsers(req.user?.role)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        const locationFilter = requireLocationFilter(req.user);

        // Smart Search: matches username, full name, or role
        // (case-insensitive, partial match). Combined with locationFilter
        // via a plain object spread so a search never escapes the caller's
        // location scope.
        const searchRegex = buildSearchRegex(req.query.search);
        const filter = searchRegex
            ? { ...locationFilter, $or: [{ username: searchRegex }, { fullname: searchRegex }, { role: searchRegex }] }
            : locationFilter;

        const totalUsers = await UserSchema.countDocuments(filter);

        const users = await UserSchema.find(filter)
            .select('-password')
            .populate('createdBy', 'username fullname role')
            .populate('rootAdminId', 'username fullname role')
            .populate('role', 'roleName')
            .sort({ [sortField]: sortOrder })
            .skip(skip)
            .limit(limit);

        // A page/search with no matches is a normal, valid result - not an
        // error - so it always resolves as success:true with an empty
        // array. (Previously this returned a 404 here, which made the
        // frontend's query hook treat "no results" as a failed request and
        // keep showing stale rows - most noticeable once search could
        // legitimately return zero matches.)
        return res.json({
            success: true,
            data: users,
            currentPage: page,
            totalPages: Math.ceil(totalUsers / limit),
            totalItems: totalUsers,
            message: users.length ? "Users fetched successfully" : "No users found",
        });
    } catch (error) {
        if (error instanceof LocationAccessError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message,
        });
    }
};

const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!canManageUsers(req.user?.role)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        if (!id) {
            return res.status(400).json({ message: "user ID is missing" });
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const locationFilter = requireLocationFilter(req.user);
        const user = await UserSchema.findOne({ _id: id, ...locationFilter })
            .select('-password')
            .populate('createdBy', 'username fullname role')
            .populate('rootAdminId', 'username fullname role');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, data: user });
    } catch (error) {
        if (error instanceof LocationAccessError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

const updateUserById = async (req, res) => {
    try {
        if (!canManageUsers(req.user?.role)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        const locationFilter = requireLocationFilter(req.user);

        const { username, fullname, role, newPassword, oldPassword, descriptor, locationId } = req.body;
        const updateData = {};
        if (locationId) {
            let resolvedLocationId;
            try {
                resolvedLocationId = await resolveLocationId(req.user, locationId);
            } catch (error) {
                if (error instanceof LocationAccessError) {
                    return res.status(error.status).json({ success: false, message: error.message });
                }
                throw error;
            }

            if (!resolvedLocationId) {
                return res.status(400).json({ success: false, message: "Invalid location" });
            }

            updateData.location_id = resolvedLocationId;
        }

        const faceCheck = await faceRecognitionExcludeUserService(descriptor, req.params.id)
        if (faceCheck.status) {
            return res.status(400).send({ status: false, message: `A face record already exists for user ${faceCheck.username}` })
        }

        // Fetch existing user
        const user = await UserSchema.findOne({ _id: req.params.id, ...locationFilter });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Handle username update
        if (username) {
            const existingUser = await UserSchema.findOne({ username });
            if (existingUser && existingUser._id.toString() !== req.params.id) {
                return res.status(409).json({ success: false, message: 'Username already exists' });
            }
            updateData.username = username;
        }

        // Handle password update
        if (newPassword) {
            if (!oldPassword) {
                return res.status(400).json({ success: false, message: 'Old password is required to set a new password' });
            }

            const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
            if (!isOldPasswordValid) {
                return res.status(400).json({ success: false, message: 'Old password is incorrect' });
            }

            updateData.password = await bcrypt.hash(newPassword, 10);
        }

        // Optional updates
        if (fullname) updateData.fullname = fullname;
        if (role) {
            updateData.role = role;
            if (isAdminRole(role) && !user.rootAdminId) {
                const hierarchy = await resolveAdminHierarchy(req.user.id);
                updateData.createdBy = user.createdBy || hierarchy.createdBy;
                updateData.rootAdminId = hierarchy.rootAdminId;
            }
        }
        if (descriptor) updateData.descriptor = descriptor

        // Update user
        const updatedUser = await UserSchema.findOneAndUpdate(
            { _id: req.params.id, ...locationFilter },
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password');

        // Audit log
        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'UPDATE',
            targetModel: 'User',
            targetId: updatedUser._id,
            description: `Updated user "${updatedUser.username}"`,
            changes: updateData
        });

        res.json({ success: true, data: updatedUser, message: 'User updated successfully' });

    } catch (error) {
        if (error instanceof LocationAccessError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

const deleteUser = async (req, res) => {
    try {
        if (!canManageUsers(req.user?.role)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        const locationFilter = requireLocationFilter(req.user);
        const deletedUser = await UserSchema.findOneAndDelete({ _id: req.params.id, ...locationFilter });
        if (!deletedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        await inmateModel.deleteOne({ inmateId: deletedUser.inmateId })
        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'DELETE',
            targetModel: 'User',
            targetId: deletedUser._id,
            description: `Deleted user "${deletedUser.username}" with role "${deletedUser.role}"`,
            changes: {
                username: deletedUser.username,
                fullname: deletedUser.fullname,
                role: deletedUser.role
            }
        });
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        if (error instanceof LocationAccessError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

const deleteFaceRecognitionRecord = async (req, res) => {
    try {
        const { id } = req.params
        if (!id) {
            return res.status(404).send({ sucess: false, message: "could not find any id" })
        }
        await UserSchema.findByIdAndUpdate(id, { descriptor: [] }).then((data) => {
            return res.status(200).send({ status: true, message: "face recogintion data deleted successfully" });
        }).catch((error) => {
            return res.status(500).send({ status: true, message: "internal server down",error:error.message });
        })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
}

module.exports = { createUser, getAllUsers, getUserById, updateUserById, deleteUser, defaultUser, faceRecongition, faceRecongitionMatch, deleteFaceRecognitionRecord };
