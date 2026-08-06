const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { sendAttendanceEmail, sendLateEmail, sendBunkEmail } = require('./emailService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add static file serving for the whole portal
app.use(express.static('d:/Kapataksha-High-School/Portal/Admin'));

// PostgreSQL Pool Connection
const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'StudentData',
    password: process.env.PGPASSWORD || '1910',
    port: process.env.PGPORT || 5432,
});

// Sync PostgreSQL timezone with the local system timezone
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
pool.on('connect', (client) => {
    client.query(`SET TIME ZONE '${systemTimeZone}'`).catch(err => {
        console.error('Failed to set timezone:', err.message);
    });
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

// Global System State
let lastWebPollTime = 0; // Tracks when a web UI was last waiting for a scan

// Page Context: tracks which web page the admin has open
// Automatically expires after 6 seconds of no heartbeat
let pageContext = {
    page: 'none',           // 'student_management' | 'none'
    pageName: '',           // human-readable page name shown on OLED
    lastHeartbeat: 0        // epoch ms of last heartbeat from the browser
};
const PAGE_CONTEXT_EXPIRE_MS = 6000; // 6s — browser sends heartbeat every 4s

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

            // ---- ATTENDANCE LOGIC ----
            // Skip attendance if: web UI is actively polling  OR  a Student Management
            // page is currently open in the browser (page-context heartbeat is fresh).
            const isWebWaiting      = (Date.now() - lastWebPollTime) < 3000;
            const ctxExpired        = (Date.now() - pageContext.lastHeartbeat) > PAGE_CONTEXT_EXPIRE_MS;
            const isStudentMgmtOpen = !ctxExpired && pageContext.page === 'student_management';

            if (!isWebWaiting && !isStudentMgmtOpen) {
                try {
                    const attQuery = await pool.query('SELECT * FROM Attendance WHERE student_id = $1 AND date = CURRENT_DATE', [card.student_id]);
                    
                    let checkType = null;
                    if (attQuery.rows.length === 0) {
                        await pool.query('INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, CURRENT_DATE, CURRENT_TIMESTAMP)', [card.student_id]);
                        checkType = 'IN';
                    } else {
                        await pool.query('UPDATE Attendance SET time_out = CURRENT_TIMESTAMP WHERE student_id = $1 AND date = CURRENT_DATE', [card.student_id]);
                        checkType = 'OUT';
                    }
                    
                    // Fetch student details for email
                    const studentInfoQuery = await pool.query(`
                        SELECT c.name, a.class_name, a.roll_number, a.section, p.fathers_email, p.mothers_email
                        FROM cards c
                        LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
                        LEFT JOIN StudentContactInformation p ON c.student_id = p.student_id
                        WHERE c.student_id = $1
                    `, [card.student_id]);
                    
                    if (studentInfoQuery.rows.length > 0) {
                        sendAttendanceEmail(studentInfoQuery.rows[0], checkType);
                    }
                } catch (attErr) {
                    console.error('Error auto-logging attendance:', attErr.message);
                }
            } else {
                console.log(`Scan skipped for Attendance: Attendance Mode is OFF. (Card: ${card.student_id})`);
            }
            // --------------------------

            return res.json({
                status: 'registered',
                message: 'Card already registered and attendance logged',
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
    if (req.query.active === 'true') {
        lastWebPollTime = Date.now();
    }
    res.json(latestScan);
});

// Helper GET status endpoints for legacy web scan polling
app.get(['/api/scan', '/api/card-read', '/api/details-scan'], (req, res) => {
    res.json({ waiting: false });
});

// ── Page Context Endpoints ────────────────────────────────────────────────────
// Student Management pages POST a heartbeat every 4s to signal they are active.
// The ESP32 GETs this every 1s to decide whether to take attendance or redirect
// the card tap to the web portal for student lookup.

// POST /api/rfid/page-context  — browser heartbeat (called by Student Mgmt pages)
app.post('/api/rfid/page-context', (req, res) => {
    const { page, pageName } = req.body;
    if (!page) return res.status(400).json({ error: 'page field is required' });
    pageContext.page = page;
    pageContext.pageName = pageName || page;
    pageContext.lastHeartbeat = Date.now();
    console.log(`[PageContext] Browser heartbeat: page="${pageContext.pageName}"`);
    res.json({ ok: true, page: pageContext.page, pageName: pageContext.pageName });
});

// DELETE /api/rfid/page-context  — browser signals it is leaving the page
app.delete('/api/rfid/page-context', (req, res) => {
    console.log(`[PageContext] Browser left page: was "${pageContext.pageName}"`);
    pageContext = { page: 'none', pageName: '', lastHeartbeat: 0 };
    res.json({ ok: true });
});

// GET /api/rfid/page-context  — ESP32 polls this to know the active mode
app.get('/api/rfid/page-context', (req, res) => {
    const expired = (Date.now() - pageContext.lastHeartbeat) > PAGE_CONTEXT_EXPIRE_MS;
    if (expired && pageContext.page !== 'none') {
        console.log(`[PageContext] Heartbeat expired — resetting to "none"`);
        pageContext = { page: 'none', pageName: '', lastHeartbeat: 0 };
    }
    res.json({
        page: pageContext.page,
        pageName: pageContext.pageName,
        active: pageContext.page !== 'none'
    });
});
// ─────────────────────────────────────────────────────────────────────────────

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
        const query = `
            SELECT 
                c.uid, 
                c.student_id, 
                c.name, 
                c.created_at,
                a.class_name, 
                a.roll_number, 
                a.section, 
                a.shift, 
                a.academic_year
            FROM cards c
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            ORDER BY c.created_at DESC
        `;
        const result = await pool.query(query);
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
                p.updated_at,
                CASE WHEN u.user_id IS NOT NULL THEN true ELSE false END AS is_user
            FROM cards c
            LEFT JOIN PersonalData p ON c.student_id = p.student_id
            LEFT JOIN Users u ON c.student_id = u.user_id
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
// -------------------------------------------------------------------------
// TEACHER MANAGEMENT APIs
// -------------------------------------------------------------------------
app.post('/api/teacher/personal-data', async (req, res) => {
    const {
        teacher_id, first_name, last_name,
        gender, date_of_birth, blood_group, religion, nationality,
        nid_number, photo_url, mobile_number, email_address,
        current_address, permanent_address, emergency_contact,
        department, designation, joining_date, employment_type,
        qualification, years_of_experience, specialization
    } = req.body;

    const full_name = `${first_name} ${last_name}`.trim();

    if (!teacher_id || !first_name || !last_name || !gender || !date_of_birth) {
        return res.status(400).json({ error: 'Please fill in all mandatory teacher information fields.' });
    }

    try {
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

        res.json({ success: true, message: 'Teacher Personal Data and User Account saved successfully.' });
    } catch (err) {
        console.error('Error saving teacher data:', err.message);
        res.status(500).json({ error: 'Server error saving teacher data.' });
    }
});
app.get('/api/teacher/all', async (req, res) => {
    try {
        const query = `
            SELECT 
                teacher_id, full_name, designation, 
                TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date, 
                mobile_number, email_address, current_address, photo_url
            FROM TeacherPersonalData
            ORDER BY joining_date ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all teachers:', err.message);
        res.status(500).json({ error: 'Server error fetching teachers.' });
    }
});


// -------------------------------------------------------------------------
// USER APIs
// -------------------------------------------------------------------------
app.post('/api/user/make-student-user', async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) {
        return res.status(400).json({ error: 'student_id is required' });
    }
    try {
        const hashedPassword = await bcrypt.hash('student1212', 10);
        const userQuery = `
            INSERT INTO Users (user_id, username, password, role, account_status)
            VALUES ($1, $2, $3, 'Student', 'Active')
            ON CONFLICT (user_id) DO NOTHING
        `;
        await pool.query(userQuery, [student_id, ' ', hashedPassword]);
        res.json({ success: true, message: 'Student successfully saved as a User.' });
    } catch (err) {
        console.error('Error creating user for student:', err.message);
        res.status(500).json({ error: 'Server error creating user account.' });
    }
});


// -------------------------------------------------------------------------
// STUDENT APIs
// -------------------------------------------------------------------------
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
                a.section,
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

// 16. ESP32 Attendance Scan Endpoint
app.post('/api/attendance/scan', async (req, res) => {
    const { uid } = req.body;
    if (!uid) {
        return res.status(400).json({ error: 'Card UID is required.' });
    }

    try {
        // Find the student by card UID
        const cardQuery = await pool.query('SELECT student_id FROM cards WHERE uid = $1', [uid]);
        if (cardQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Unregistered Card' });
        }
        
        const student_id = cardQuery.rows[0].student_id;
        
        // Check if there is an attendance record for today
        const attQuery = await pool.query('SELECT * FROM Attendance WHERE student_id = $1 AND date = CURRENT_DATE', [student_id]);
        
        let checkType = null;
        if (attQuery.rows.length === 0) {
            // First scan of the day - In
            await pool.query('INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, CURRENT_DATE, CURRENT_TIMESTAMP)', [student_id]);
            checkType = 'IN';
        } else {
            // Second (or later) scan of the day - Out
            await pool.query('UPDATE Attendance SET time_out = CURRENT_TIMESTAMP WHERE student_id = $1 AND date = CURRENT_DATE', [student_id]);
            checkType = 'OUT';
        }

        // Fetch student details for email
        const studentInfoQuery = await pool.query(`
            SELECT c.name, a.class_name, a.roll_number, a.section, p.fathers_email, p.mothers_email
            FROM cards c
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            LEFT JOIN StudentContactInformation p ON c.student_id = p.student_id
            WHERE c.student_id = $1
        `, [student_id]);
        
        if (studentInfoQuery.rows.length > 0) {
            sendAttendanceEmail(studentInfoQuery.rows[0], checkType);
        }

        if (checkType === 'IN') {
            return res.status(200).json({ message: 'Attendance IN recorded', student_id });
        } else {
            return res.status(200).json({ message: 'Attendance OUT recorded', student_id });
        }
    } catch (err) {
        console.error('Error logging attendance:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 17. Live Attendance Data Fetch
app.get('/api/attendance/live', async (req, res) => {
    try {
        const query = `
            SELECT 
                a.id, a.student_id, a.time_in, a.time_out,
                p.first_name, p.last_name, p.photo_url,
                cards.name AS card_name,
                c.class_name, c.roll_number, c.section
            FROM Attendance a
            JOIN cards ON a.student_id = cards.student_id
            LEFT JOIN PersonalData p ON a.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation c ON a.student_id = c.student_id
            WHERE a.date = CURRENT_DATE
            ORDER BY COALESCE(a.time_out, a.time_in) DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching live attendance:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET: Fetch historical attendance records with optional date filtering
app.get('/api/attendance/history', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = `
            SELECT 
                a.id, a.student_id, a.date, a.time_in, a.time_out,
                p.first_name, p.last_name, p.photo_url,
                cards.name AS card_name,
                c.class_name, c.roll_number, c.section
            FROM Attendance a
            JOIN cards ON a.student_id = cards.student_id
            LEFT JOIN PersonalData p ON a.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation c ON a.student_id = c.student_id
            WHERE 1=1
        `;
        let values = [];
        let index = 1;

        if (startDate) {
            query += ` AND a.date >= $${index++} `;
            values.push(startDate);
        }
        if (endDate) {
            query += ` AND a.date <= $${index++} `;
            values.push(endDate);
        }

        query += ` ORDER BY a.date DESC, COALESCE(a.time_out, a.time_in) DESC `;
        
        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching attendance history:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 18. Attendance Report Endpoint (Aggregated Data)
app.get('/api/attendance/report', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = `
            SELECT 
                c.student_id,
                c.name AS student_name,
                s.class_name,
                s.section,
                s.roll_number,
                COUNT(a.id) AS total_present
            FROM cards c
            JOIN Attendance a ON c.student_id = a.student_id
            LEFT JOIN StudentAcademicInformation s ON c.student_id = s.student_id
            WHERE 1=1
        `;
        const values = [];

        if (startDate) {
            values.push(startDate);
            query += ` AND a.date >= $${values.length}`;
        }
        if (endDate) {
            values.push(endDate);
            query += ` AND a.date <= $${values.length}`;
        }

        query += ` GROUP BY c.student_id, c.name, s.class_name, s.section, s.roll_number ORDER BY s.class_name, s.roll_number, c.student_id`;

        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching attendance report:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 19. Fetch Late Students Endpoint
app.get('/api/attendance/late', async (req, res) => {
    try {
        const { date, threshold } = req.query;
        if (!date || !threshold) {
            return res.status(400).json({ error: 'date and threshold are required' });
        }

        const query = `
            SELECT 
                a.student_id,
                c.name AS student_name,
                a.time_in,
                s.class_name,
                s.section,
                s.roll_number
            FROM Attendance a
            JOIN cards c ON a.student_id = c.student_id
            LEFT JOIN StudentAcademicInformation s ON a.student_id = s.student_id
            WHERE a.date = $1 
              AND CAST(a.time_in AS TIME) > $2
            ORDER BY a.time_in DESC
        `;
        const result = await pool.query(query, [date, threshold]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching late students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 20. Notify Late Students via Email
app.post('/api/attendance/notify-late', express.json(), async (req, res) => {
    try {
        const { student_ids, date, threshold } = req.body;
        
        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return res.status(400).json({ error: 'student_ids array is required' });
        }
        
        // Fetch contact information for these students
        const placeholders = student_ids.map((_, i) => `$${i + 1}`).join(',');
        const query = `
            SELECT 
                c.student_id,
                cards.name,
                c.fathers_email,
                c.mothers_email,
                s.class_name,
                s.section,
                s.roll_number,
                a.time_in
            FROM StudentContactInformation c
            JOIN cards ON c.student_id = cards.student_id
            LEFT JOIN StudentAcademicInformation s ON c.student_id = s.student_id
            JOIN Attendance a ON c.student_id = a.student_id AND a.date = $${student_ids.length + 1}
            WHERE c.student_id IN (${placeholders})
        `;
        
        const values = [...student_ids, date];
        const result = await pool.query(query, values);
        
        let sentCount = 0;
        
        // Use a standard date format
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = new Date(date).toLocaleDateString('en-US', dateOptions);

        for (const student of result.rows) {
            const timeInObj = new Date(student.time_in);
            const timeOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' };
            const timeInStr = timeInObj.toLocaleTimeString('en-US', timeOptions);
            
            // Format threshold string AM/PM for display
            let thresholdStr = threshold; // fallback
            try {
                const [h, m] = threshold.split(':');
                const tDate = new Date();
                tDate.setHours(parseInt(h), parseInt(m), 0);
                thresholdStr = tDate.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
            } catch (e) {}

            await sendLateEmail(student, dateStr, timeInStr, thresholdStr);
            sentCount++;
        }
        
        res.status(200).json({ message: `Sent ${sentCount} notifications.` });
    } catch (err) {
        console.error('Error notifying late students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 21. Fetch Bunked Students Endpoint
app.get('/api/attendance/bunk', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ error: 'date is required' });
        }

        const query = `
            SELECT 
                a.student_id,
                c.name AS student_name,
                a.time_in,
                s.class_name,
                s.section,
                s.roll_number
            FROM Attendance a
            JOIN cards c ON a.student_id = c.student_id
            LEFT JOIN StudentAcademicInformation s ON a.student_id = s.student_id
            WHERE a.date = $1 
              AND a.time_in IS NOT NULL 
              AND a.time_out IS NULL
            ORDER BY a.time_in ASC
        `;
        const result = await pool.query(query, [date]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching bunked students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 22. Notify Bunked Students via Email
app.post('/api/attendance/notify-bunk', express.json(), async (req, res) => {
    try {
        const { student_ids, date } = req.body;
        
        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return res.status(400).json({ error: 'student_ids array is required' });
        }
        
        const placeholders = student_ids.map((_, i) => `$${i + 1}`).join(',');
        const query = `
            SELECT 
                c.student_id,
                cards.name,
                c.fathers_email,
                c.mothers_email,
                s.class_name,
                s.section,
                s.roll_number,
                a.time_in
            FROM StudentContactInformation c
            JOIN cards ON c.student_id = cards.student_id
            LEFT JOIN StudentAcademicInformation s ON c.student_id = s.student_id
            JOIN Attendance a ON c.student_id = a.student_id AND a.date = $${student_ids.length + 1}
            WHERE c.student_id IN (${placeholders})
        `;
        
        const values = [...student_ids, date];
        const result = await pool.query(query, values);
        
        let sentCount = 0;
        
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = new Date(date).toLocaleDateString('en-US', dateOptions);

        for (const student of result.rows) {
            const timeInObj = new Date(student.time_in);
            const timeOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' };
            const timeInStr = timeInObj.toLocaleTimeString('en-US', timeOptions);

            await sendBunkEmail(student, dateStr, timeInStr);
            sentCount++;
        }
        
        res.status(200).json({ message: `Sent ${sentCount} notifications.` });
    } catch (err) {
        console.error('Error notifying bunked students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// -------------------------------------------------------------------------
// Replace RFID Card Endpoint
// -------------------------------------------------------------------------
app.post('/api/rfid/replace', async (req, res) => {
    const { oldUid, newUid, studentId, name } = req.body;

    if (!newUid || !studentId) {
        return res.status(400).json({ error: 'New UID and Student ID are required.' });
    }

    const cleanNewUid = newUid.toUpperCase().trim();
    
    try {
        // 1. Check if the new card is already registered to someone else
        const checkResult = await pool.query('SELECT * FROM cards WHERE uid = $1', [cleanNewUid]);
        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'This new RFID card is already registered to another student.' });
        }

        // 2. Check if the student currently has a card. If so, update it.
        const checkStudent = await pool.query('SELECT * FROM cards WHERE student_id = $1', [studentId]);
        if (checkStudent.rows.length > 0) {
            const updateQuery = `
                UPDATE cards 
                SET uid = $1 
                WHERE student_id = $2 
                RETURNING *;
            `;
            const updateResult = await pool.query(updateQuery, [cleanNewUid, studentId]);
            const updatedCard = updateResult.rows[0];

            // Reset live scan state
            latestScan = {
                uid: cleanNewUid,
                studentId: updatedCard.student_id,
                registered: true,
                name: updatedCard.name,
                timestamp: new Date()
            };

            return res.status(200).json({
                status: 'success',
                message: 'RFID Card successfully replaced!',
                card: updatedCard
            });
        } else {
            // If somehow the student didn't have a card, insert a new one
            const cleanName = name ? name.trim() : 'Unknown';
            const insertQuery = `
                INSERT INTO cards (uid, student_id, name)
                VALUES ($1, $2, $3)
                RETURNING *;
            `;
            const insertResult = await pool.query(insertQuery, [cleanNewUid, studentId, cleanName]);
            const newCard = insertResult.rows[0];

            latestScan = {
                uid: cleanNewUid,
                studentId: newCard.student_id,
                registered: true,
                name: newCard.name,
                timestamp: new Date()
            };

            return res.status(201).json({
                status: 'success',
                message: 'RFID Card successfully added for student!',
                card: newCard
            });
        }

    } catch (err) {
        console.error('Error replacing RFID card:', err.message);
        return res.status(500).json({ error: 'Database update error' });
    }
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`RFID Admin Node.js Server listening on port ${PORT}`);
    console.log(`PostgreSQL Database: StudentData (Tables: cards, PersonalData, StudentAcademicInformation)`);
    console.log(`====================================================`);
});
