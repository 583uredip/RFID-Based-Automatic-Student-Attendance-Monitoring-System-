const pool = require('../config/db');

class StudentModel {
    static async searchStudent(searchTerm) {
        const searchQuery = `
            SELECT 
                c.uid, 
                c.student_id, 
                c.name AS card_name,
                c.created_at AS card_created_at,
                p.first_name, 
                p.last_name, 
                p.gender, 
                TO_CHAR(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                p.blood_group, 
                p.religion, 
                p.nationality, 
                p.nid_birth_cert, 
                p.photo_url, 
                p.updated_at,
                CASE WHEN u.user_id IS NOT NULL THEN true ELSE false END AS is_user
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            LEFT JOIN Users u ON c.student_id = u.user_id
            WHERE UPPER(c.student_id) = $1 OR UPPER(c.uid) = $1;
        `;
        const result = await pool.query(searchQuery, [searchTerm]);
        return result.rows[0] || null;
    }

    static async savePersonalData(data) {
        const {
            student_id, first_name, last_name, gender, date_of_birth,
            blood_group, religion, nationality, nid_birth_cert, photo_url
        } = data;

        const upsertQuery = `
            INSERT INTO PersonalData (
                student_id, first_name, last_name, gender, date_of_birth,
                blood_group, religion, nationality, nid_birth_cert, photo_url, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
            ON CONFLICT (student_id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                gender = EXCLUDED.gender,
                date_of_birth = EXCLUDED.date_of_birth,
                blood_group = EXCLUDED.blood_group,
                religion = EXCLUDED.religion,
                nationality = EXCLUDED.nationality,
                nid_birth_cert = EXCLUDED.nid_birth_cert,
                photo_url = EXCLUDED.photo_url,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            student_id,
            first_name.trim(),
            last_name.trim(),
            gender,
            date_of_birth,
            blood_group,
            religion.trim(),
            nationality ? nationality.trim() : 'Bangladeshi',
            nid_birth_cert ? nid_birth_cert.trim() : null,
            photo_url || null
        ];

        const result = await pool.query(upsertQuery, values);
        return result.rows[0];
    }

    static async getAcademicData(studentId) {
        const result = await pool.query(
            "SELECT *, TO_CHAR(admission_date, 'YYYY-MM-DD') AS admission_date FROM StudentAcademicInformation WHERE student_id = $1", 
            [studentId]
        );
        return result.rows[0] || null;
    }

    static async saveAcademicData(data) {
        const {
            student_id, admission_number, admission_date, class: studentClass, roll_number,
            registration_number, section, group_name, shift, session, academic_year
        } = data;

        const upsertQuery = `
            INSERT INTO StudentAcademicInformation (
                student_id, admission_number, admission_date, class_name, roll_number,
                registration_number, section, student_group, shift, session, academic_year, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
            ON CONFLICT (student_id) DO UPDATE SET
                admission_number = EXCLUDED.admission_number,
                admission_date = EXCLUDED.admission_date,
                class_name = EXCLUDED.class_name,
                roll_number = EXCLUDED.roll_number,
                registration_number = EXCLUDED.registration_number,
                section = EXCLUDED.section,
                student_group = EXCLUDED.student_group,
                shift = EXCLUDED.shift,
                session = EXCLUDED.session,
                academic_year = EXCLUDED.academic_year,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            student_id,
            admission_number.trim(),
            admission_date,
            studentClass.trim(),
            roll_number.trim(),
            registration_number.trim(),
            section.trim(),
            group_name ? group_name.trim() : null,
            shift.trim(),
            session.trim(),
            academic_year.trim()
        ];

        const result = await pool.query(upsertQuery, values);
        return result.rows[0];
    }

    static async getContactData(studentId) {
        const query = 'SELECT * FROM StudentContactInformation WHERE student_id = $1';
        const result = await pool.query(query, [studentId]);
        return result.rows[0] || null;
    }

    static async saveContactData(data) {
        const {
            student_id, mobile_number, email_address, current_address, permanent_address,
            fathers_name, fathers_phone, fathers_occupation, fathers_email,
            mothers_name, mothers_phone, mothers_occupation, mothers_email,
            guardian_name, guardian_relationship, guardian_phone
        } = data;

        const upsertQuery = `
            INSERT INTO StudentContactInformation (
                student_id, mobile_number, email_address, current_address, permanent_address,
                fathers_name, fathers_phone, fathers_occupation, fathers_email,
                mothers_name, mothers_phone, mothers_occupation, mothers_email,
                guardian_name, guardian_relationship, guardian_phone, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
            ON CONFLICT (student_id) DO UPDATE SET
                mobile_number = EXCLUDED.mobile_number,
                email_address = EXCLUDED.email_address,
                current_address = EXCLUDED.current_address,
                permanent_address = EXCLUDED.permanent_address,
                fathers_name = EXCLUDED.fathers_name,
                fathers_phone = EXCLUDED.fathers_phone,
                fathers_occupation = EXCLUDED.fathers_occupation,
                fathers_email = EXCLUDED.fathers_email,
                mothers_name = EXCLUDED.mothers_name,
                mothers_phone = EXCLUDED.mothers_phone,
                mothers_occupation = EXCLUDED.mothers_occupation,
                mothers_email = EXCLUDED.mothers_email,
                guardian_name = EXCLUDED.guardian_name,
                guardian_relationship = EXCLUDED.guardian_relationship,
                guardian_phone = EXCLUDED.guardian_phone,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            student_id,
            mobile_number ? mobile_number.trim() : null,
            email_address ? email_address.trim() : null,
            current_address ? current_address.trim() : null,
            permanent_address ? permanent_address.trim() : null,
            fathers_name ? fathers_name.trim() : null,
            fathers_phone ? fathers_phone.trim() : null,
            fathers_occupation ? fathers_occupation.trim() : null,
            fathers_email ? fathers_email.trim() : null,
            mothers_name ? mothers_name.trim() : null,
            mothers_phone ? mothers_phone.trim() : null,
            mothers_occupation ? mothers_occupation.trim() : null,
            mothers_email ? mothers_email.trim() : null,
            guardian_name ? guardian_name.trim() : null,
            guardian_relationship ? guardian_relationship.trim() : null,
            guardian_phone ? guardian_phone.trim() : null
        ];

        const result = await pool.query(upsertQuery, values);
        return result.rows[0];
    }

    static async deleteStudentByIdentifier(cleanIdentifier) {
        const query = 'DELETE FROM cards WHERE UPPER(student_id) = $1 OR UPPER(uid) = $1 RETURNING *';
        const result = await pool.query(query, [cleanIdentifier]);

        if (result.rows.length > 0) {
            const deletedCard = result.rows[0];
            await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1 OR UPPER(user_id) = $2', [
                deletedCard.student_id.toUpperCase(),
                cleanIdentifier
            ]);
            return { type: 'student', card: deletedCard };
        } else {
            const userDelete = await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1 RETURNING *', [cleanIdentifier]);
            if (userDelete.rows.length > 0) {
                return { type: 'user', user: userDelete.rows[0] };
            }
            return null;
        }
    }

    static async getAllStudents() {
        const query = `
            SELECT 
                c.student_id, 
                c.uid, 
                c.name AS card_name,
                p.first_name, 
                p.last_name, 
                a.class_name, 
                a.roll_number,
                a.section,
                cont.mobile_number
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            LEFT JOIN StudentContactInformation cont ON c.student_id = cont.student_id
            ORDER BY c.student_id ASC;
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    static async getExportAllStudents() {
        const query = `
            SELECT 
                c.student_id, c.uid, c.name AS card_name, c.created_at AS card_registered_at,
                p.first_name, p.last_name, p.gender, TO_CHAR(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.blood_group, p.religion, p.nationality, p.nid_birth_cert,
                a.admission_number, TO_CHAR(a.admission_date, 'YYYY-MM-DD') AS admission_date, a.class_name, a.roll_number, a.registration_number, a.section, a.student_group, a.shift, a.session, a.academic_year,
                cont.mobile_number, cont.email_address, cont.current_address, cont.permanent_address, cont.fathers_name, cont.fathers_phone, cont.fathers_occupation, cont.fathers_email, cont.mothers_name, cont.mothers_phone, cont.mothers_occupation, cont.mothers_email, cont.guardian_name, cont.guardian_relationship, cont.guardian_phone
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            LEFT JOIN StudentContactInformation cont ON c.student_id = cont.student_id
            ORDER BY c.student_id ASC;
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    static async bulkImport(students) {
        const client = await pool.connect();
        let imported = 0;
        let errors = [];

        try {
            await client.query('BEGIN');

            for (const [index, std] of students.entries()) {
                const {
                    student_id, uid, card_name,
                    first_name, last_name, gender, date_of_birth, blood_group, religion, nationality, nid_birth_cert,
                    admission_number, admission_date, class_name, roll_number, registration_number, section, student_group, shift, session, academic_year,
                    mobile_number, email_address, current_address, permanent_address, fathers_name, fathers_phone, fathers_occupation, fathers_email, mothers_name, mothers_phone, mothers_occupation, mothers_email, guardian_name, guardian_relationship, guardian_phone
                } = std;

                if (!student_id || !uid || !card_name) {
                    errors.push(`Row ${index + 2}: Missing required fields (student_id, uid, or card_name).`);
                    continue;
                }

                try {
                    await client.query(`
                        INSERT INTO cards (uid, student_id, name)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (student_id) 
                        DO UPDATE SET uid = EXCLUDED.uid, name = EXCLUDED.name
                    `, [uid, student_id, card_name]);

                    if (first_name || last_name) {
                        await client.query(`
                            INSERT INTO PersonalData (student_id, first_name, last_name, gender, date_of_birth, blood_group, religion, nationality, nid_birth_cert)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                            ON CONFLICT (student_id) 
                            DO UPDATE SET 
                                first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, gender = EXCLUDED.gender, 
                                date_of_birth = EXCLUDED.date_of_birth, blood_group = EXCLUDED.blood_group, religion = EXCLUDED.religion, 
                                nationality = EXCLUDED.nationality, nid_birth_cert = EXCLUDED.nid_birth_cert, updated_at = CURRENT_TIMESTAMP
                        `, [student_id, first_name||'', last_name||'', gender||'', date_of_birth || null, blood_group||'', religion||'', nationality||'Bangladeshi', nid_birth_cert||'']);
                    }

                    if (class_name || roll_number) {
                        await client.query(`
                            INSERT INTO StudentAcademicInformation (student_id, admission_number, admission_date, class_name, roll_number, registration_number, section, student_group, shift, session, academic_year)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                            ON CONFLICT (student_id) 
                            DO UPDATE SET 
                                admission_number = EXCLUDED.admission_number, admission_date = EXCLUDED.admission_date, class_name = EXCLUDED.class_name, 
                                roll_number = EXCLUDED.roll_number, registration_number = EXCLUDED.registration_number, section = EXCLUDED.section, 
                                student_group = EXCLUDED.student_group, shift = EXCLUDED.shift, session = EXCLUDED.session, academic_year = EXCLUDED.academic_year, updated_at = CURRENT_TIMESTAMP
                        `, [student_id, admission_number||'', admission_date || null, class_name||'', roll_number||'', registration_number||'', section||'', student_group||'', shift||'', session||'', academic_year||'']);
                    }

                    if (mobile_number || email_address) {
                        await client.query(`
                            INSERT INTO StudentContactInformation (student_id, mobile_number, email_address, current_address, permanent_address, fathers_name, fathers_phone, fathers_occupation, fathers_email, mothers_name, mothers_phone, mothers_occupation, mothers_email, guardian_name, guardian_relationship, guardian_phone)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                            ON CONFLICT (student_id) 
                            DO UPDATE SET 
                                mobile_number = EXCLUDED.mobile_number, email_address = EXCLUDED.email_address, current_address = EXCLUDED.current_address, 
                                permanent_address = EXCLUDED.permanent_address, fathers_name = EXCLUDED.fathers_name, fathers_phone = EXCLUDED.fathers_phone, 
                                fathers_occupation = EXCLUDED.fathers_occupation, fathers_email = EXCLUDED.fathers_email, mothers_name = EXCLUDED.mothers_name, 
                                mothers_phone = EXCLUDED.mothers_phone, mothers_occupation = EXCLUDED.mothers_occupation, mothers_email = EXCLUDED.mothers_email, 
                                guardian_name = EXCLUDED.guardian_name, guardian_relationship = EXCLUDED.guardian_relationship, guardian_phone = EXCLUDED.guardian_phone, updated_at = CURRENT_TIMESTAMP
                        `, [student_id, mobile_number||'', email_address||'', current_address||'', permanent_address||'', fathers_name||'', fathers_phone||'', fathers_occupation||'', fathers_email||'', mothers_name||'', mothers_phone||'', mothers_occupation||'', mothers_email||'', guardian_name||'', guardian_relationship||'', guardian_phone||'']);
                    }

                    imported++;
                } catch (innerErr) {
                    console.error(`Error importing row ${index + 2} (${student_id}):`, innerErr.message);
                    errors.push(`Row ${index + 2} (${student_id}): ${innerErr.message}`);
                }
            }

            if (errors.length === students.length && students.length > 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'All rows failed to import', details: errors };
            } else {
                await client.query('COMMIT');
                return { success: true, message: `Successfully imported ${imported} students.`, importedCount: imported, errors };
            }
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = StudentModel;
