const Student = require('../models/Student');
const Card = require('../models/Card');

exports.searchStudent = async (req, res) => {
    const { query } = req.query;

    if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }

    const searchTerm = query.trim().toUpperCase();

    try {
        const student = await Student.searchStudent(searchTerm);

        if (!student) {
            return res.status(404).json({ error: `No student card found matching ID or UID: "${searchTerm}"` });
        }

        res.json(student);
    } catch (err) {
        console.error('Error searching student:', err.message);
        res.status(500).json({ error: 'Database search error' });
    }
};

exports.savePersonalData = async (req, res) => {
    const {
        student_id, first_name, last_name, gender, date_of_birth,
        blood_group, religion, nationality, nid_birth_cert, photo_url
    } = req.body;

    if (!student_id || !first_name || !last_name || !gender || !date_of_birth || !blood_group || !religion) {
        return res.status(400).json({ error: 'Please fill in all mandatory personal information fields.' });
    }

    try {
        const cardCheck = await Card.findByStudentId(student_id);
        if (!cardCheck) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

        const personalData = await Student.savePersonalData(req.body);

        res.status(200).json({
            message: 'Personal Data saved successfully!',
            personalData
        });
    } catch (err) {
        console.error('Error saving PersonalData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
};

exports.getAcademicData = async (req, res) => {
    const student_id = req.params.student_id;
    try {
        const academicData = await Student.getAcademicData(student_id);
        if (!academicData) {
            return res.status(404).json({ error: 'Academic data not found' });
        }
        res.json(academicData);
    } catch (err) {
        console.error('Error fetching AcademicData:', err.message);
        res.status(500).json({ error: 'Database fetch error' });
    }
};

exports.saveAcademicData = async (req, res) => {
    const {
        student_id, admission_number, admission_date, class: studentClass, roll_number,
        registration_number, section, group_name, shift, session, academic_year
    } = req.body;

    if (!student_id || !admission_number || !admission_date || !studentClass || !roll_number || !registration_number || !section || !shift || !session || !academic_year) {
        return res.status(400).json({ error: 'Please fill in all mandatory academic information fields.' });
    }

    try {
        const cardCheck = await Card.findByStudentId(student_id);
        if (!cardCheck) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

        const academicData = await Student.saveAcademicData(req.body);

        res.status(200).json({
            message: 'Academic Data saved successfully!',
            academicData
        });
    } catch (err) {
        console.error('Error saving AcademicData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
};

exports.getContactData = async (req, res) => {
    const studentId = req.params.studentId;

    try {
        const contactData = await Student.getContactData(studentId);

        if (contactData) {
            res.status(200).json(contactData);
        } else {
            res.status(404).json({ message: 'No contact information found for this student.' });
        }
    } catch (err) {
        console.error('Error fetching ContactData:', err.message);
        res.status(500).json({ error: 'Database fetch error' });
    }
};

exports.saveContactData = async (req, res) => {
    const { student_id } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Student ID is required.' });
    }

    try {
        const cardCheck = await Card.findByStudentId(student_id);
        if (!cardCheck) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

        const contactData = await Student.saveContactData(req.body);

        res.status(200).json({
            message: 'Contact Data saved successfully!',
            contactData
        });
    } catch (err) {
        console.error('Error saving ContactData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
};

exports.deleteStudent = async (req, res) => {
    const identifier = req.params.identifier;
    const cleanIdentifier = identifier.toUpperCase().trim();
    
    try {
        const result = await Student.deleteStudentByIdentifier(cleanIdentifier);

        if (result) {
            if (result.type === 'student') {
                res.status(200).json({ message: 'Student, card record, and user account deleted successfully.' });
            } else {
                res.status(200).json({ message: 'User account deleted successfully.' });
            }
        } else {
            res.status(404).json({ error: 'Student not found.' });
        }
    } catch (err) {
        console.error('Error deleting student:', err.message);
        res.status(500).json({ error: 'Database delete error' });
    }
};

exports.getAllStudents = async (req, res) => {
    try {
        const students = await Student.getAllStudents();
        res.status(200).json(students);
    } catch (err) {
        console.error('Error fetching all students:', err.message);
        res.status(500).json({ error: 'Database search error' });
    }
};

exports.exportAllStudents = async (req, res) => {
    try {
        const students = await Student.getExportAllStudents();
        res.status(200).json(students);
    } catch (err) {
        console.error('Error exporting all students:', err.message);
        res.status(500).json({ error: 'Database export error' });
    }
};

exports.bulkImportStudents = async (req, res) => {
    const students = req.body;
    if (!Array.isArray(students)) {
        return res.status(400).json({ error: 'Payload must be an array of students' });
    }

    try {
        const result = await Student.bulkImport(students);
        if (!result.success) {
            return res.status(400).json({ error: result.error, details: result.details });
        }
        res.status(200).json({ message: result.message, importedCount: result.importedCount, errors: result.errors });
    } catch (err) {
        console.error('Error during bulk import:', err.message);
        res.status(500).json({ error: 'Database bulk import error', details: err.message });
    }
};
