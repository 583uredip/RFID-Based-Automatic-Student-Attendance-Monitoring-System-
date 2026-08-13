const Teacher = require('../models/Teacher');

exports.savePersonalData = async (req, res) => {
    const { teacher_id, first_name, last_name, gender, date_of_birth } = req.body;

    if (!teacher_id || !first_name || !last_name || !gender || !date_of_birth) {
        return res.status(400).json({ error: 'Please fill in all mandatory teacher information fields.' });
    }

    try {
        await Teacher.savePersonalData(req.body);
        res.json({ success: true, message: 'Teacher Personal Data and User Account saved successfully.' });
    } catch (err) {
        console.error('Error saving teacher data:', err.message);
        res.status(500).json({ error: 'Server error saving teacher data.' });
    }
};

exports.getAllTeachers = async (req, res) => {
    try {
        const teachers = await Teacher.getAllTeachers();
        res.json(teachers);
    } catch (err) {
        console.error('Error fetching all teachers:', err.message);
        res.status(500).json({ error: 'Server error fetching teachers.' });
    }
};

exports.getTeacherById = async (req, res) => {
    try {
        const { id } = req.params;
        const teacher = await Teacher.getTeacherById(id);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found.' });
        }
        res.json(teacher);
    } catch (err) {
        console.error('Error fetching teacher by id:', err.message);
        res.status(500).json({ error: 'Server error fetching teacher.' });
    }
};

exports.deleteTeacher = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Teacher.deleteTeacher(id);

        if (!deleted) {
            return res.status(404).json({ error: 'Teacher not found.' });
        }

        return res.status(200).json({ status: 'success', message: 'Teacher, user account, and class assignments deleted successfully.' });
    } catch (err) {
        console.error('Error deleting teacher:', err.message);
        return res.status(500).json({ error: 'Failed to delete teacher from database.' });
    }
};
