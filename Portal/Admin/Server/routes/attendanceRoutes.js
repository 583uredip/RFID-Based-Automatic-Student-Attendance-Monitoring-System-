const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

router.post('/attendance/scan', attendanceController.scanAttendance);
router.get('/attendance/live', attendanceController.getLiveAttendance);
router.get('/attendance/history', attendanceController.getHistory);
router.get('/attendance/report', attendanceController.getReport);
router.get('/attendance/late', attendanceController.getLate);
router.post('/attendance/notify-late', attendanceController.notifyLate);
router.get('/attendance/bunk', attendanceController.getBunk);
router.post('/attendance/notify-bunk', attendanceController.notifyBunk);
router.get(['/analytics/dashboard', '/rfid/analytics/dashboard'], attendanceController.getDashboardAnalytics);

module.exports = router;
