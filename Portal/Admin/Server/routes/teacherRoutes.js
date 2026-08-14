const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const classController = require('../controllers/classController');

router.post('/teacher/personal-data', teacherController.savePersonalData);
router.get('/teacher/all', teacherController.getAllTeachers);
router.get('/teacher/schedule/:teacher_id', classController.getTeacherSchedule);
router.get('/teacher/:id', teacherController.getTeacherById);
router.delete('/teacher/:id', teacherController.deleteTeacher);

module.exports = router;
