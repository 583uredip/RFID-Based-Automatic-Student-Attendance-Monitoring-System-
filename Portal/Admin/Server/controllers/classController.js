const Class = require('../models/Class');

exports.getClasses = async (req, res) => {
    try {
        const classes = await Class.getAllClasses();
        return res.status(200).json({ status: 'success', classes });
    } catch (err) {
        console.error('Error fetching classes:', err.message);
        return res.status(500).json({ error: 'Failed to fetch classes from database.' });
    }
};

exports.createClass = async (req, res) => {
    try {
        const newClass = await Class.createClass(req.body);
        return res.status(201).json({ status: 'success', class: newClass });
    } catch (err) {
        console.error('Error saving class:', err.message);
        return res.status(500).json({ error: 'Failed to save class to database.' });
    }
};

exports.getAssignments = async (req, res) => {
    try {
        const assignments = await Class.getAllAssignments();
        return res.status(200).json({ status: 'success', assignments });
    } catch (err) {
        console.error('Error fetching assignments:', err.message);
        return res.status(500).json({ error: 'Failed to fetch assignments.' });
    }
};

exports.assignTeacher = async (req, res) => {
    try {
        const { teacher_id, class_id, teacher_name } = req.body;
        const effectiveTeacherId = teacher_id || teacher_name || 'UNASSIGNED';
        if (!class_id) {
            return res.status(400).json({ error: 'class_id is required.' });
        }

        await Class.assignTeacher(effectiveTeacherId, class_id, teacher_name);
        return res.status(200).json({ status: 'success', message: 'Teacher assigned successfully.' });
    } catch (err) {
        console.error('Error assigning teacher:', err.message);
        return res.status(500).json({ error: 'Failed to assign teacher.' });
    }
};

exports.deleteAssignment = async (req, res) => {
    try {
        const { teacher_id, class_id } = req.query;
        if (!teacher_id && !class_id) {
            return res.status(400).json({ error: 'teacher_id or class_id is required.' });
        }

        await Class.deleteAssignment(teacher_id, class_id);
        return res.status(200).json({ status: 'success', message: 'Assignment removed.' });
    } catch (err) {
        console.error('Error removing assignment:', err.message);
        return res.status(500).json({ error: 'Failed to remove assignment.' });
    }
};

exports.updateClass = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedClass = await Class.updateClass(id, req.body);
        if (!updatedClass) {
            return res.status(404).json({ error: 'Class not found.' });
        }
        return res.status(200).json({ status: 'success', class: updatedClass });
    } catch (err) {
        console.error('Error updating class:', err.message);
        return res.status(500).json({ error: 'Failed to update class.' });
    }
};

exports.deleteClass = async (req, res) => {
    try {
        const { id } = req.params;
        const success = await Class.deleteClass(id);
        if (!success) {
            return res.status(404).json({ error: 'Class not found.' });
        }
        return res.status(200).json({ status: 'success', message: 'Class deleted successfully.' });
    } catch (err) {
        console.error('Error deleting class:', err.message);
        return res.status(500).json({ error: 'Failed to delete class.' });
    }
};

/**
 * GET /api/student/schedule/:student_id
 * Returns class schedule for the logged-in student by matching their
 * class_name and section from StudentAcademicInformation against classes table.
 */
exports.getStudentSchedule = async (req, res) => {
    try {
        const { student_id } = req.params;
        if (!student_id) {
            return res.status(400).json({ error: 'student_id is required.' });
        }
        const data = await Class.getStudentSchedule(student_id);
        return res.status(200).json({ status: 'success', ...data });
    } catch (err) {
        console.error('Error fetching student schedule:', err.message);
        return res.status(500).json({ error: 'Failed to fetch student schedule.' });
    }
};

/**
 * GET /api/teacher/schedule/:teacher_id
 * Returns class schedule for the logged-in teacher by matching their
 * teacher_id against classes and class_assignments tables.
 */
exports.getTeacherSchedule = async (req, res) => {
    try {
        const { teacher_id } = req.params;
        if (!teacher_id) {
            return res.status(400).json({ error: 'teacher_id is required.' });
        }
        const data = await Class.getTeacherSchedule(teacher_id);
        return res.status(200).json({ status: 'success', ...data });
    } catch (err) {
        console.error('Error fetching teacher schedule:', err.message);
        return res.status(500).json({ error: 'Failed to fetch teacher schedule.' });
    }
};
