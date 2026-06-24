const UserModel = require("../model/userModel");

const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

const isAdminRole = (role) => normalizeRole(role) === "ADMIN";
const isSuperAdminRole = (role) => normalizeRole(role) === "SUPER ADMIN";

const resolveAdminHierarchy = async (creatorId) => {
  if (!creatorId) {
    return { createdBy: null, rootAdminId: null };
  }

  const creator = await UserModel.findById(creatorId).select("_id role rootAdminId").lean();
  if (!creator) {
    return { createdBy: creatorId, rootAdminId: creatorId };
  }

  const rootAdminId = creator.rootAdminId ? creator.rootAdminId : creator._id;

  return {
    createdBy: creator._id,
    rootAdminId,
    creatorRole: creator.role,
    isAdmin: isAdminRole(creator.role),
    isSuperAdmin: isSuperAdminRole(creator.role),
  };
};

module.exports = {
  resolveAdminHierarchy,
  isAdminRole,
  isSuperAdminRole,
};
