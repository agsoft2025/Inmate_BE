const express = require('express');
const { createInmate, getInmates, getInmatesID, updateInmate, searchInmates, deleteInmate, downloadInmatesCSV, getInmateUsingInmateID, getInmateTransactionData, fetchInmateDataUsingFace } = require('../controllers/inmateControllers');
const requireRole = require('../middleware/requireRole');
const requireOwnInmateRecordOrStaff = require('../middleware/requireOwnInmateRecord');
const router = express.Router();

// Full inmate-record management - staff only.
router.post("/create", requireRole("ADMIN", "SUPER ADMIN"), createInmate);
router.get('/', requireRole("ADMIN", "SUPER ADMIN"), getInmates);
router.get('/download-csv/:id', requireRole("ADMIN", "SUPER ADMIN"), downloadInmatesCSV);

// Used by the POS terminal to look up an inmate at checkout (search box /
// face lookup) - staff and POS, not INMATE.
router.get('/search', requireRole("ADMIN", "SUPER ADMIN", "POS"), searchInmates);
router.post('/fetch-by-face', requireRole("ADMIN", "SUPER ADMIN", "POS"), fetchInmateDataUsingFace);

// Inmate self-service (their own profile / own transaction history) - staff
// can view any inmate in their facility, but an INMATE-role caller may only
// ever fetch their own record (requireOwnInmateRecordOrStaff enforces that).
router.get('/inmate-transaction/:id', requireRole("ADMIN", "SUPER ADMIN", "INMATE"), requireOwnInmateRecordOrStaff, getInmateTransactionData);
router.get('/inmateid/:id', requireRole("ADMIN", "SUPER ADMIN", "INMATE"), requireOwnInmateRecordOrStaff, getInmateUsingInmateID);

router.get('/:id', requireRole("ADMIN", "SUPER ADMIN"), getInmatesID);
router.put('/:id', requireRole("ADMIN", "SUPER ADMIN"), updateInmate);
router.delete('/:id', requireRole("ADMIN", "SUPER ADMIN"), deleteInmate);

module.exports = router;