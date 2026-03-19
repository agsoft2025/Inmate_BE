const express = require('express');
const { createInmate, getInmates, getInmatesID, updateInmate, searchInmates, deleteInmate, downloadInmatesCSV, getInmateUsingInmateID, getInmateTransactionData, fetchInmateDataUsingFace } = require('../controllers/inmateControllers');
const router = express.Router();

router.post("/create",createInmate);
router.get('/',getInmates);
router.get('/download-csv/:id', downloadInmatesCSV);
router.get('/search',searchInmates);
router.post('/fetch-by-face',fetchInmateDataUsingFace)
router.get('/inmate-transaction/:id',getInmateTransactionData);
router.get('/inmateid/:id',getInmateUsingInmateID);
router.get('/:id',getInmatesID);
router.put('/:id',updateInmate);
router.delete('/:id',deleteInmate);

module.exports = router;