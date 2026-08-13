const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/user/make-student-user', userController.makeStudentUser);

module.exports = router;
