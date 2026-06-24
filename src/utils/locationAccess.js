const mongoose = require('mongoose');
const InmateLocation = require('../model/inmateLocationModel');

class LocationAccessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'LocationAccessError';
    this.status = status;
  }
}

const normalizeRole = (role) => (typeof role === 'string' ? role.trim().toUpperCase() : '');
const isSuperAdminRole = (role) => normalizeRole(role).includes('SUPER');

const resolveLocationId = async (user, requestedLocationId) => {
  const hasUserLocation = Boolean(user?.location_id);
  const targetId = requestedLocationId || (hasUserLocation ? user.location_id : null);

  if (!targetId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new LocationAccessError('Invalid location id', 400);
  }

  if (
    hasUserLocation &&
    requestedLocationId &&
    requestedLocationId !== user.location_id &&
    !isSuperAdminRole(user?.role)
  ) {
    throw new LocationAccessError('Unauthorized to use this location', 403);
  }

  const location = await InmateLocation.findById(targetId).select('_id');
  if (!location) {
    throw new LocationAccessError('Location not found', 404);
  }

  return location._id;
};

const buildLocationFilter = (user) => {
  if (!user || isSuperAdminRole(user.role)) {
    return {};
  }

  if (!user.location_id) {
    return {};
  }

  if (!mongoose.Types.ObjectId.isValid(user.location_id)) {
    return {};
  }

  return { location_id: new mongoose.Types.ObjectId(user.location_id) };
};

const requireLocationFilter = (user) => {
  const locationFilter = buildLocationFilter(user);
  const hasLocation = Boolean(locationFilter.location_id);

  if (!hasLocation && !isSuperAdminRole(user?.role)) {
    throw new LocationAccessError("Location is required", 404);
  }

  return locationFilter;
};

const attachLocationFilter = (req, res, next) => {
  try {
    req.locationFilter = requireLocationFilter(req.user);
    next();
  } catch (error) {
    if (error instanceof LocationAccessError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const attachOptionalLocationFilter = (req, res, next) => {
  try {
    req.locationFilter = buildLocationFilter(req.user);
    req.locationRestricted = Boolean(
      req.user && !isSuperAdminRole(req.user.role) && !req.user.location_id
    );
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  LocationAccessError,
  resolveLocationId,
  buildLocationFilter,
  isSuperAdminRole,
  requireLocationFilter,
  attachLocationFilter,
  attachOptionalLocationFilter,
};
