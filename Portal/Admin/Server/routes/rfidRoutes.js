const express = require('express');
const router = express.Router();
const rfidController = require('../controllers/rfidController');

// ESP32 Card Tap Endpoints
router.post(['/rfid/scan', '/attendance', '/scan'], rfidController.handleScan);

// Live Tap Detection Endpoints
router.get('/rfid/latest-scan', rfidController.getLatestScan);
router.get(['/scan', '/card-read', '/details-scan'], rfidController.getLegacyScanDetails);

// Offline Queue Batch Sync
router.post(['/rfid/sync', '/sync'], rfidController.handleSync);

// Register RFID Card & Student
router.post(['/rfid/register', '/register'], rfidController.handleRegister);

// RFID Cards Management
router.get('/rfid/cards', rfidController.getRfidCards);
router.delete('/rfid/cards/:uid', rfidController.deleteCardByUid);
router.get('/cards/all', rfidController.getAllCards);
router.get('/cards/search/:query', rfidController.searchCards);
router.post('/cards/register', rfidController.registerCardPost);
router.post('/cards/replace', rfidController.replaceCardPost);
router.delete('/cards/:studentId', rfidController.deleteCardByStudentId);
router.post('/rfid/replace', rfidController.replaceRfidFull);

module.exports = router;
