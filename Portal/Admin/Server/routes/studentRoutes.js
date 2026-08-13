const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

router.get('/student/search', studentController.searchStudent);
router.post('/student/personal-data', studentController.savePersonalData);
router.get('/student/academic-data/:student_id', studentController.getAcademicData);
router.post('/student/academic-data', studentController.saveAcademicData);
router.get('/student/contact-data/:studentId', studentController.getContactData);
router.post('/student/contact-data', studentController.saveContactData);
router.delete('/student/:identifier', studentController.deleteStudent);
router.get('/student/all', studentController.getAllStudents);
router.get('/student/export/all', studentController.exportAllStudents);
router.post('/student/import/bulk', studentController.bulkImportStudents);

module.exports = router;
