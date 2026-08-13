const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');

router.get('/classes', classController.getClasses);
router.post('/classes', classController.createClass);
router.get('/classes/assignments', classController.getAssignments);
router.post('/classes/assign', classController.assignTeacher);
router.delete('/classes/assignments', classController.deleteAssignment);
router.put('/classes/:id', classController.updateClass);
router.delete('/classes/:id', classController.deleteClass);

module.exports = router;
