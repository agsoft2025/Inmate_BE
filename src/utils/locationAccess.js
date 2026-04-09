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

  return { location_id: mongoose.Types.ObjectId(user.location_id) };
};

module.exports = {
  LocationAccessError,
  resolveLocationId,
  buildLocationFilter,
  isSuperAdminRole,
};
