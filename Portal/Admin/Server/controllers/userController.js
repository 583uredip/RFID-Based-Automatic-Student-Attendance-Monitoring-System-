const User = require('../models/User');

exports.makeStudentUser = async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) {
        return res.status(400).json({ error: 'student_id is required' });
    }
    try {
        await User.createStudentUser(student_id);
        res.json({ success: true, message: 'Student successfully saved as a User.' });
    } catch (err) {
        console.error('Error creating user for student:', err.message);
        res.status(500).json({ error: 'Server error creating user account.' });
    }
};
