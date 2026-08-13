const pool = require('../config/db');
const bcrypt = require('bcrypt');

class TeacherModel {
    static async savePersonalData(data) {
        const {
            teacher_id, first_name, last_name,
            gender, date_of_birth, blood_group, religion, nationality,
            nid_number, photo_url, mobile_number, email_address,
            current_address, permanent_address, emergency_contact,
            department, designation, joining_date, employment_type,
            qualification, years_of_experience, specialization
        } = data;

        const full_name = `${first_name} ${last_name}`.trim();

        const upsertQuery = `
            INSERT INTO TeacherPersonalData (
                teacher_id, full_name, first_name, last_name, gender, date_of_birth,
                blood_group, religion, nationality, nid_number, photo_url,
                mobile_number, email_address, current_address, permanent_address, emergency_contact,
                department, designation, joining_date, employment_type, qualification, years_of_experience, specialization,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, CURRENT_TIMESTAMP)
            ON CONFLICT (teacher_id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                gender = EXCLUDED.gender,
                date_of_birth = EXCLUDED.date_of_birth,
                blood_group = EXCLUDED.blood_group,
                religion = EXCLUDED.religion,
                nationality = EXCLUDED.nationality,
                nid_number = EXCLUDED.nid_number,
                photo_url = EXCLUDED.photo_url,
                mobile_number = EXCLUDED.mobile_number,
                email_address = EXCLUDED.email_address,
                current_address = EXCLUDED.current_address,
                permanent_address = EXCLUDED.permanent_address,
                emergency_contact = EXCLUDED.emergency_contact,
                department = EXCLUDED.department,
                designation = EXCLUDED.designation,
                joining_date = EXCLUDED.joining_date,
                employment_type = EXCLUDED.employment_type,
                qualification = EXCLUDED.qualification,
                years_of_experience = EXCLUDED.years_of_experience,
                specialization = EXCLUDED.specialization,
                updated_at = CURRENT_TIMESTAMP
        `;

        const values = [
            teacher_id, full_name, first_name, last_name, gender, date_of_birth,
            blood_group, religion, nationality || 'Bangladeshi', nid_number, photo_url,
            mobile_number, email_address, current_address, permanent_address, emergency_contact,
            department, designation, joining_date, employment_type, qualification, years_of_experience || null, specialization
        ];

        await pool.query(upsertQuery, values);

        // Also create a default user account for the teacher if it doesn't exist
        const hashedPassword = await bcrypt.hash('teacher1212', 10);
        const userQuery = `
            INSERT INTO Users (user_id, username, password, role, account_status)
            VALUES ($1, $2, $3, 'Teacher', 'Active')
            ON CONFLICT (user_id) DO NOTHING
        `;
        await pool.query(userQuery, [teacher_id, ' ', hashedPassword]);

        return true;
    }

    static async getAllTeachers() {
        const query = `
            SELECT 
                teacher_id, full_name, first_name, last_name, gender,
                TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                blood_group, religion, nationality, nid_number, photo_url,
                mobile_number, email_address, current_address, permanent_address, emergency_contact,
                department, designation, 
                TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date,
                employment_type, qualification, years_of_experience, specialization
            FROM TeacherPersonalData
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    static async getTeacherById(id) {
        const query = `
            SELECT 
                teacher_id, full_name, first_name, last_name, gender,
                TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                blood_group, religion, nationality, nid_number, photo_url,
                mobile_number, email_address, current_address, permanent_address, emergency_contact,
                department, designation, 
                TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date,
                employment_type, qualification, years_of_experience, specialization
            FROM TeacherPersonalData
            WHERE teacher_id = $1;
        `;
        const result = await pool.query(query, [id]);
        return result.rows[0] || null;
    }

    static async deleteTeacher(id) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query('DELETE FROM class_assignments WHERE teacher_id = $1;', [id]);
            await client.query('UPDATE classes SET assigned_teacher_id = NULL, assigned_teacher_name = NULL WHERE assigned_teacher_id = $1;', [id]);
            await client.query('DELETE FROM Users WHERE user_id = $1;', [id]);
            const result = await client.query('DELETE FROM TeacherPersonalData WHERE teacher_id = $1 RETURNING teacher_id;', [id]);

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return false;
            }

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = TeacherModel;
