const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// PostgreSQL Pool Connection
const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'StudentData',
    password: process.env.PGPASSWORD || '1910',
    port: process.env.PGPORT || 5432,
});

// Verify PostgreSQL Connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to PostgreSQL database "StudentData":', err.message);
    } else {
        console.log('Successfully connected to PostgreSQL Database "StudentData"!');
        release();
    }
});

// In-Memory Storage for Live Scans
let latestScan = {
    uid: null,
    studentId: null,
    registered: false,
    name: '',
    timestamp: null
};

// Helper: Generate Next Student ID (26-XXXXX)
async function generateNextStudentId() {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM cards');
        const count = parseInt(result.rows[0].count, 10) + 1;
        const paddedNumber = String(count).padStart(5, '0');
        return `26-${paddedNumber}`;
    } catch (err) {
        console.error('Error generating student ID:', err.message);
        return '26-00001';
    }
}

// 1. ESP32 Card Tap Endpoint (Supports /api/rfid/scan, /api/attendance, /api/scan)
app.post(['/api/rfid/scan', '/api/attendance', '/api/scan'], async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({ error: 'Card UID is required' });
    }

    const cleanUid = uid.toUpperCase().trim();

    try {
        // Check if card is already registered
        const result = await pool.query('SELECT * FROM cards WHERE uid = $1', [cleanUid]);

        if (result.rows.length > 0) {
            const card = result.rows[0];
            latestScan = {
                uid: cleanUid,
                studentId: card.student_id,
                registered: true,
                name: card.name,
                timestamp: new Date()
            };
            return res.json({
                status: 'registered',
                message: 'Card already registered',
                uid: cleanUid,
                studentId: card.student_id,
                card_id: card.student_id,
                name: card.name,
                action: 'IN'
            });
        } else {
            // New Unregistered Card Scanned
            const nextStudentId = await generateNextStudentId();
            latestScan = {
                uid: cleanUid,
                studentId: nextStudentId,
                registered: false,
                name: '',
                timestamp: new Date()
            };
            return res.json({
                status: 'new',
                message: 'New unassigned card scanned',
                uid: cleanUid,
                studentId: nextStudentId,
                card_id: nextStudentId
            });
        }
    } catch (err) {
        console.error('Error handling card scan:', err.message);
        return res.status(500).json({ error: 'Server error processing scan' });
    }
});

// 2. Web UI Live Tap Detection Endpoint
app.get('/api/rfid/latest-scan', (req, res) => {
    res.json(latestScan);
});

// Helper GET status endpoints for legacy web scan polling
app.get(['/api/scan', '/api/card-read', '/api/details-scan'], (req, res) => {
    res.json({ waiting: false });
});

// 3. Register RFID Card & Student Endpoint (Supports /api/rfid/register, /api/register)
app.post(['/api/rfid/register', '/api/register'], async (req, res) => {
    const { uid, name, studentId } = req.body;

    if (!uid || !name || !name.trim()) {
        return res.status(400).json({ error: 'UID and Student Name are required.' });
    }

    const cleanUid = uid.toUpperCase().trim();
    const cleanName = name.trim();

    try {
        // Check if UID is already registered
        const checkResult = await pool.query('SELECT * FROM cards WHERE uid = $1', [cleanUid]);
        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'This RFID card is already registered.' });
        }

        // Auto-generate unique Student ID (26-XXXXX) if not provided
        const finalStudentId = (studentId && studentId.trim()) ? studentId.trim() : await generateNextStudentId();

        // Insert into Cards Table
        const insertQuery = `
            INSERT INTO cards (uid, student_id, name)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const insertResult = await pool.query(insertQuery, [cleanUid, finalStudentId, cleanName]);
        const newCard = insertResult.rows[0];

        // Reset live scan state
        latestScan = {
            uid: cleanUid,
            studentId: newCard.student_id,
            registered: true,
            name: newCard.name,
            timestamp: new Date()
        };

        return res.status(201).json({
            status: 'success',
            message: 'RFID Card successfully registered!',
            card: newCard
        });
    } catch (err) {
        console.error('Error registering RFID card:', err.message);
        return res.status(500).json({ error: 'Database insertion error' });
    }
});

// 4. Offline Queue Batch Sync Endpoint (Supports /api/rfid/sync, /api/sync)
app.post(['/api/rfid/sync', '/api/sync'], async (req, res) => {
    const { records } = req.body;
    if (!Array.isArray(records)) {
        return res.status(400).json({ error: 'Records array is required' });
    }

    let synced = 0;
    let skipped = 0;

    for (const record of records) {
        if (!record || !record.uid) {
            skipped++;
            continue;
        }
        const cleanUid = record.uid.toUpperCase().trim();
        try {
            const check = await pool.query('SELECT * FROM cards WHERE uid = $1', [cleanUid]);
            if (check.rows.length > 0) {
                synced++;
            } else {
                skipped++;
            }
        } catch (err) {
            skipped++;
        }
    }

    return res.json({
        status: 'success',
        message: 'Offline queue synced',
        synced,
        skipped
    });
});

// 5. Fetch All Registered Cards List
app.get('/api/rfid/cards', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cards ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching cards:', err.message);
        res.status(500).json({ error: 'Failed to retrieve card data' });
    }
});

// 6. Delete Registered Card Endpoint
app.delete('/api/rfid/cards/:uid', async (req, res) => {
    const { uid } = req.params;
    try {
        await pool.query('DELETE FROM cards WHERE uid = $1', [uid.toUpperCase()]);
        res.json({ message: 'Card record deleted successfully' });
    } catch (err) {
        console.error('Error deleting card:', err.message);
        res.status(500).json({ error: 'Failed to delete card' });
    }
});

// =========================================================================
// STUDENT PERSONAL DATA ENDPOINTS (Cards + PersonalData Tables)
// =========================================================================

// 6. Search Student by StudentID or Card UID
app.get('/api/student/search', async (req, res) => {
    const { query } = req.query;

    if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }

    const searchTerm = query.trim().toUpperCase();

    try {
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
                p.updated_at
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            WHERE UPPER(c.student_id) = $1 OR UPPER(c.uid) = $1;
        `;
        const result = await pool.query(searchQuery, [searchTerm]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: `No student card found matching ID or UID: "${searchTerm}"` });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error searching student:', err.message);
        res.status(500).json({ error: 'Database search error' });
    }
});

// 7. Save / Upsert Student Personal Data
app.post('/api/student/personal-data', async (req, res) => {
    const {
        student_id,
        first_name,
        last_name,
        gender,
        date_of_birth,
        blood_group,
        religion,
        nationality,
        nid_birth_cert,
        photo_url
    } = req.body;

    if (!student_id || !first_name || !last_name || !gender || !date_of_birth || !blood_group || !religion) {
        return res.status(400).json({ error: 'Please fill in all mandatory personal information fields.' });
    }

    try {
        // Verify Student ID exists in Cards Table
        const cardCheck = await pool.query('SELECT * FROM cards WHERE student_id = $1', [student_id]);
        if (cardCheck.rows.length === 0) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

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

        res.status(200).json({
            message: 'Personal Data saved successfully!',
            personalData: result.rows[0]
        });
    } catch (err) {
        console.error('Error saving PersonalData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
});

// 8. Fetch Student Academic Information
app.get('/api/student/academic-data/:student_id', async (req, res) => {
    const student_id = req.params.student_id;
    try {
        const result = await pool.query(
            "SELECT *, TO_CHAR(admission_date, 'YYYY-MM-DD') AS admission_date FROM StudentAcademicInformation WHERE student_id = $1", 
            [student_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Academic data not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching AcademicData:', err.message);
        res.status(500).json({ error: 'Database fetch error' });
    }
});

// 9. Save / Upsert Student Academic Information
app.post('/api/student/academic-data', async (req, res) => {
    const {
        student_id,
        admission_number,
        admission_date,
        class: studentClass,
        roll_number,
        registration_number,
        section,
        group_name,
        shift,
        session,
        academic_year
    } = req.body;

    if (!student_id || !admission_number || !admission_date || !studentClass || !roll_number || !registration_number || !section || !shift || !session || !academic_year) {
        return res.status(400).json({ error: 'Please fill in all mandatory academic information fields.' });
    }

    try {
        const cardCheck = await pool.query('SELECT * FROM cards WHERE student_id = $1', [student_id]);
        if (cardCheck.rows.length === 0) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

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

        res.status(200).json({
            message: 'Academic Data saved successfully!',
            academicData: result.rows[0]
        });
    } catch (err) {
        console.error('Error saving AcademicData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
});

// 10. Fetch Student Contact Information by Student ID
app.get('/api/student/contact-data/:studentId', async (req, res) => {
    const studentId = req.params.studentId;

    try {
        const query = 'SELECT * FROM StudentContactInformation WHERE student_id = $1';
        const result = await pool.query(query, [studentId]);

        if (result.rows.length > 0) {
            res.status(200).json(result.rows[0]);
        } else {
            res.status(404).json({ message: 'No contact information found for this student.' });
        }
    } catch (err) {
        console.error('Error fetching ContactData:', err.message);
        res.status(500).json({ error: 'Database fetch error' });
    }
});

// 11. Save / Upsert Student Contact Information
app.post('/api/student/contact-data', async (req, res) => {
    const {
        student_id, mobile_number, email_address, current_address, permanent_address,
        fathers_name, fathers_phone, fathers_occupation, fathers_email,
        mothers_name, mothers_phone, mothers_occupation, mothers_email,
        guardian_name, guardian_relationship, guardian_phone
    } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Student ID is required.' });
    }

    try {
        const cardCheck = await pool.query('SELECT * FROM cards WHERE student_id = $1', [student_id]);
        if (cardCheck.rows.length === 0) {
            return res.status(404).json({ error: `Student ID "${student_id}" does not exist in Cards database.` });
        }

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

        res.status(200).json({
            message: 'Contact Data saved successfully!',
            contactData: result.rows[0]
        });
    } catch (err) {
        console.error('Error saving ContactData:', err.message);
        res.status(500).json({ error: 'Database save error' });
    }
});

// 12. Delete Student by Student ID or UID
app.delete('/api/student/:identifier', async (req, res) => {
    const identifier = req.params.identifier;
    
    try {
        const query = 'DELETE FROM cards WHERE UPPER(student_id) = $1 OR UPPER(uid) = $1 RETURNING *';
        const result = await pool.query(query, [identifier.toUpperCase()]);

        if (result.rows.length > 0) {
            res.status(200).json({ message: 'Student and all related data deleted successfully.' });
        } else {
            res.status(404).json({ error: 'Student not found.' });
        }
    } catch (err) {
        console.error('Error deleting student:', err.message);
        res.status(500).json({ error: 'Database delete error' });
    }
});

// 13. Get All Students
app.get('/api/student/all', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.student_id, 
                c.uid, 
                c.name AS card_name,
                p.first_name, 
                p.last_name, 
                a.class_name, 
                a.roll_number,
                cont.mobile_number
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            LEFT JOIN StudentContactInformation cont ON c.student_id = cont.student_id
            ORDER BY c.student_id ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching all students:', err.message);
        res.status(500).json({ error: 'Database search error' });
    }
});

// 14. Export All Students Data
app.get('/api/student/export/all', async (req, res) => {
    try {
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
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error exporting all students:', err.message);
        res.status(500).json({ error: 'Database export error' });
    }
});

// 15. Bulk Import Students
app.post('/api/student/import/bulk', async (req, res) => {
    const students = req.body;
    if (!Array.isArray(students)) {
        return res.status(400).json({ error: 'Payload must be an array of students' });
    }

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
                // Upsert Cards
                await client.query(`
                    INSERT INTO cards (uid, student_id, name)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (student_id) 
                    DO UPDATE SET uid = EXCLUDED.uid, name = EXCLUDED.name
                `, [uid, student_id, card_name]);

                // Upsert PersonalData
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

                // Upsert Academic
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

                // Upsert Contact
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
            return res.status(400).json({ error: 'All rows failed to import', details: errors });
        } else {
            await client.query('COMMIT');
            return res.status(200).json({ message: `Successfully imported ${imported} students.`, importedCount: imported, errors });
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error during bulk import:', err.message);
        res.status(500).json({ error: 'Database bulk import error', details: err.message });
    } finally {
        client.release();
    }
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`RFID Admin Node.js Server listening on port ${PORT}`);
    console.log(`PostgreSQL Database: StudentData (Tables: cards, PersonalData, StudentAcademicInformation)`);
    console.log(`====================================================`);
});
