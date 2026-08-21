const mongoose = require("mongoose");
const UserSchema = require("../model/userModel");
const InmateLocation = require("../model/inmateLocationModel");
const bcrypt = require('bcrypt');
const logAudit = require("../utils/auditlogger");
const { faceRecognitionService } = require("../service/faceRecognitionService");
const { resolveAdminHierarchy } = require("../utils/adminHierarchy");
const escapeRegex = require("../utils/escapeRegex");

const createAdminCredential = async (req, res) => {
  try {
    const { username, fullname, password, descriptor, location_id } = req.body;

    if (!username || !fullname || !password) {
      return res.status(400).json({
        success: false,
        message: "username, fullname, and password are required",
      });
    }
    if (!location_id) {
      return res.status(400).json({
        success: false,
        message: "location_id is required to assign this admin to a facility",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(location_id)) {
      return res.status(400).json({ success: false, message: "Invalid location_id" });
    }
    const locationExists = await InmateLocation.findById(location_id);
    if (!locationExists) {
      return res.status(404).json({ success: false, message: "Location not found" });
    }

    // Face check (optional)
    if (descriptor) {
      const checkFaceMatch = await faceRecognitionService(descriptor);
      if (checkFaceMatch.status) {
        return res.status(400).json({
          success: false,
          message: `Face already exists for user ${checkFaceMatch.username}`,
        });
      }
    }

    // Check existing user
    const existingUser = await UserSchema.findOne({ username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Username already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new UserSchema({
      username,
      fullname,
      password: hashedPassword,
      role: "ADMIN",
      location_id,
      descriptor,
    });

    const hierarchy = await resolveAdminHierarchy(req.user.id);
    newUser.createdBy = hierarchy.createdBy;
    newUser.rootAdminId = hierarchy.rootAdminId;

    const savedUser = await newUser.save();

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: "CREATE",
      targetModel: "User",
      targetId: savedUser._id,
      description: `Super admin created admin "${savedUser.username}"`,
      changes: {
        username: savedUser.username,
        fullname: savedUser.fullname,
        role: savedUser.role,
      },
    });

    res.status(201).json({
      success: true,
      data: savedUser,
      message: "Admin created successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllAdmins = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      order = "desc",
      subscription,
      location_id
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    // 🔍 Base Query
    const query = {
      role: "ADMIN",
      isDeleted: false
    };

    // 🔎 Search (username, fullname)
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { fullname: { $regex: search, $options: "i" } }
      ];
    }

    // 🎯 Filters
    if (subscription !== undefined) {
      query.subscription = subscription === "true";
    }

    if (location_id) {
      query.location_id = location_id;
    }

    // 🔃 Sorting
    const sortOptions = {};
    sortOptions[sortBy] = order === "asc" ? 1 : -1;

    // 📦 Data Fetch
    const users = await UserSchema.find(query)
      .select("-password")
      .populate("location_id")
      .populate("createdBy", "username fullname role")
      .populate("rootAdminId", "username fullname role")
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(limit);

    // 📊 Total Count
    const total = await UserSchema.countDocuments(query);
    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await UserSchema.findOne({
      _id: id,
      role: "ADMIN",
      isDeleted: false
    })
      .select("-password")
      .populate("createdBy", "username fullname role")
      .populate("rootAdminId", "username fullname role");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, password } = req.body;

    const user = await UserSchema.findOne({
      _id: id,
      role: "ADMIN",
      isDeleted: false
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    if (fullname) user.fullname = fullname;

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await user.save();

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: "Admin updated successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await UserSchema.findOne({
      _id: id,
      role: "ADMIN",
      isDeleted: false
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    user.isDeleted = true;
    user.deletedAt = new Date();

    await user.save();

    res.status(200).json({
      success: true,
      message: "Admin deleted successfully (soft delete)"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// Lightweight location list for the Super Admin "assign admin to a facility" picker.
// requireSuperAdmin (route-level) doesn't require a local DB user row, unlike
// authenticateToken used on /location, so this is reachable with a Global-issued token.
const getLocationsForAdmin = async (req, res) => {
  try {
    const locations = await InmateLocation
      .find({}, "name locationName baseUrl")
      .sort({ name: 1 });
    res.json({ success: true, data: locations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createAdminCredential, getAdminById, getAllAdmins, updateAdmin, deleteAdmin, getLocationsForAdmin
};
