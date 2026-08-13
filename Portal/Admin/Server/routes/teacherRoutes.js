const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');

router.post('/teacher/personal-data', teacherController.savePersonalData);
router.get('/teacher/all', teacherController.getAllTeachers);
router.get('/teacher/:id', teacherController.getTeacherById);
router.delete('/teacher/:id', teacherController.deleteTeacher);

module.exports = router;
