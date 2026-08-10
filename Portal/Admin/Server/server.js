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
        initClassTables();
    }
});

async function initClassTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classes (
                id VARCHAR(50) PRIMARY KEY,
                class_name VARCHAR(50) NOT NULL,
                section VARCHAR(20) NOT NULL,
                subject VARCHAR(100) NOT NULL,
                room_number VARCHAR(50) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                shift VARCHAR(20),
                academic_year VARCHAR(20),
                capacity INTEGER,
                class_type VARCHAR(50) DEFAULT 'Regular',
                days TEXT[] NOT NULL,
                assigned_teacher_id VARCHAR(50),
                assigned_teacher_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS class_assignments (
                id SERIAL PRIMARY KEY,
                teacher_id VARCHAR(50) NOT NULL,
                class_id VARCHAR(50) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                teacher_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(teacher_id, class_id)
            );
        `);
        console.log('Class management tables (classes, class_assignments) ready.');
    } catch (err) {
        console.error('Error initializing class management tables:', err.message);
    }
}

// Global System State
let lastWebPollTime = 0; // Tracks when a web UI was last waiting for a scan

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

// Helper: Get Local Today Date String (YYYY-MM-DD)
function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
            try {
                const todayStr = getTodayDateString();
                const attQuery = await pool.query('SELECT * FROM Attendance WHERE student_id = $1 AND date = $2', [card.student_id, todayStr]);
                
                let checkType = null;
                if (attQuery.rows.length === 0) {
                    await pool.query('INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, $2, CURRENT_TIMESTAMP)', [card.student_id, todayStr]);
                    checkType = 'IN';
                } else if (!attQuery.rows[0].time_out) {
                    await pool.query('UPDATE Attendance SET time_out = CURRENT_TIMESTAMP WHERE student_id = $1 AND date = $2', [card.student_id, todayStr]);
                    checkType = 'OUT';
                } else {
                    // 3rd punch onwards: Student has already checked IN (1st) and OUT (2nd) today (max 2 punches)
                    console.log(`[3rd Punch Blocked] Daily limit reached for ${card.name} (${card.student_id}) on ${todayStr}.`);
                    
                    latestScan.status = 'limit';
                    latestScan.action = 'LIMIT';

                    return res.json({
                        status: 'limit',
                        message: '2x punch is done try tomorrow',
                        uid: cleanUid,
                        studentId: card.student_id,
                        card_id: card.student_id,
                        name: card.name
                    });
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

                return res.json({
                    status: 'registered',
                    message: `Card checked ${checkType} successfully`,
                    uid: cleanUid,
                    studentId: card.student_id,
                    card_id: card.student_id,
                    name: card.name,
                    action: checkType
                });
            } catch (attErr) {
                console.error('Error auto-logging attendance:', attErr.message);
                return res.status(500).json({ error: 'Database error logging attendance' });
            }
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

// POST /api/rfid/sync & /api/sync — Offline Queue Batch Sync Endpoint
app.post(['/api/rfid/sync', '/api/sync'], async (req, res) => {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
        return res.json({ synced: 0, skipped: 0, message: 'No records to sync' });
    }

    let synced = 0;
    let skipped = 0;

    for (const item of records) {
        if (!item || !item.uid) { skipped++; continue; }
        const cleanUid = item.uid.toUpperCase().trim();
        const tapTime = item.timestamp ? new Date(item.timestamp * 1000) : new Date();
        const tapDateStr = tapTime.toISOString().split('T')[0];

        try {
            const cardRes = await pool.query('SELECT student_id FROM cards WHERE uid = $1', [cleanUid]);
            if (cardRes.rows.length === 0) {
                skipped++;
                continue;
            }
            const studentId = cardRes.rows[0].student_id;

            const attQuery = await pool.query(
                'SELECT * FROM Attendance WHERE student_id = $1 AND date = $2',
                [studentId, tapDateStr]
            );

            if (attQuery.rows.length === 0) {
                await pool.query(
                    'INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, $2, $3)',
                    [studentId, tapDateStr, tapTime]
                );
                synced++;
            } else if (!attQuery.rows[0].time_out) {
                await pool.query(
                    'UPDATE Attendance SET time_out = $1 WHERE student_id = $2 AND date = $3',
                    [tapTime, studentId, tapDateStr]
                );
                synced++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error('Error syncing offline record:', err.message);
            skipped++;
        }
    }

    console.log(`[Offline Sync] Batch completed: ${synced} synced, ${skipped} skipped.`);
    return res.json({ status: 'success', synced, skipped, message: `Synced ${synced} records successfully.` });
});

// ── Page Context Endpoints ────────────────────────────────────────────────────
// Student Management pages POST a heartbeat every 4s to signal they are active.
// The ESP32 GETs this every 1s to decide whether to take attendance or redirect
// the card tap to the web portal for student lookup.



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
    const cleanUid = uid.toUpperCase().trim();
    try {
        const cardRes = await pool.query('DELETE FROM cards WHERE uid = $1 RETURNING *', [cleanUid]);
        if (cardRes.rows.length > 0) {
            const deletedCard = cardRes.rows[0];
            if (deletedCard.student_id) {
                await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1', [deletedCard.student_id.toUpperCase()]);
            }
        }
        res.json({ message: 'Card record and associated user account deleted successfully' });
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
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all teachers:', err.message);
        res.status(500).json({ error: 'Server error fetching teachers.' });
    }
});

// GET /api/teacher/:id - Fetch single teacher data
app.get('/api/teacher/:id', async (req, res) => {
    try {
        const { id } = req.params;
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
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Teacher not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching teacher by id:', err.message);
        res.status(500).json({ error: 'Server error fetching teacher.' });
    }
});

// DELETE /api/teacher/:id - Delete teacher, user account, and class assignments
app.delete('/api/teacher/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        // 1. Remove teacher assignments from class_assignments
        await client.query('DELETE FROM class_assignments WHERE teacher_id = $1;', [id]);

        // 2. Clear assigned teacher in classes table
        await client.query('UPDATE classes SET assigned_teacher_id = NULL, assigned_teacher_name = NULL WHERE assigned_teacher_id = $1;', [id]);

        // 3. Remove user account from Users table
        await client.query('DELETE FROM Users WHERE user_id = $1;', [id]);

        // 4. Remove teacher personal data from TeacherPersonalData
        const result = await client.query('DELETE FROM TeacherPersonalData WHERE teacher_id = $1 RETURNING teacher_id;', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Teacher not found.' });
        }

        await client.query('COMMIT');
        return res.status(200).json({ status: 'success', message: 'Teacher, user account, and class assignments deleted successfully.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting teacher:', err.message);
        return res.status(500).json({ error: 'Failed to delete teacher from database.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// RFID CARD MANAGEMENT APIs
// -------------------------------------------------------------------------

async function initCardsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cards (
                id SERIAL PRIMARY KEY,
                uid VARCHAR(50) UNIQUE NOT NULL,
                student_id VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (err) {
        console.error('Error initializing cards table:', err.message);
    }
}
initCardsTable();

// GET /api/cards/all - Fetch all registered RFID cards
app.get('/api/cards/all', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.id, 
                c.uid, 
                c.student_id, 
                c.name, 
                TO_CHAR(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
                a.class_name, 
                a.roll_number, 
                a.section, 
                a.shift, 
                a.academic_year
            FROM cards c
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            ORDER BY c.id DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching cards:', err.message);
        res.status(500).json({ error: 'Server error fetching RFID cards.' });
    }
});

// GET /api/cards/search/:query - Search card by student_id or uid or name
app.get('/api/cards/search/:query', async (req, res) => {
    try {
        const { query: searchQuery } = req.params;
        const query = `
            SELECT c.id, c.uid, c.student_id, c.name, TO_CHAR(c.created_at, 'YYYY-MM-DD') AS created_at
            FROM cards c
            WHERE LOWER(c.student_id) = LOWER($1) OR LOWER(c.uid) = LOWER($1) OR LOWER(c.name) LIKE LOWER($2);
        `;
        const result = await pool.query(query, [searchQuery, `%${searchQuery}%`]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No card found matching query.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error searching card:', err.message);
        res.status(500).json({ error: 'Server error searching RFID card.' });
    }
});

// POST /api/cards/register - Register a new RFID card
app.post('/api/cards/register', async (req, res) => {
    try {
        const { uid, student_id, name } = req.body;
        if (!uid || !student_id || !name) {
            return res.status(400).json({ error: 'Missing required fields: uid, student_id, name.' });
        }

        const query = `
            INSERT INTO cards (uid, student_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (uid) DO UPDATE SET student_id = EXCLUDED.student_id, name = EXCLUDED.name
            RETURNING id, uid, student_id, name, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at;
        `;
        const result = await pool.query(query, [uid.trim(), student_id.trim(), name.trim()]);
        res.json({ status: 'success', card: result.rows[0] });
    } catch (err) {
        console.error('Error registering card:', err.message);
        res.status(500).json({ error: 'Failed to register RFID card.' });
    }
});

// POST /api/cards/replace - Replace a lost card UID for a student
app.post('/api/cards/replace', async (req, res) => {
    try {
        const { student_id, new_uid } = req.body;
        if (!student_id || !new_uid) {
            return res.status(400).json({ error: 'Missing student_id or new_uid.' });
        }

        const query = `
            UPDATE cards
            SET uid = $1, created_at = CURRENT_TIMESTAMP
            WHERE LOWER(student_id) = LOWER($2)
            RETURNING id, uid, student_id, name, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at;
        `;
        const result = await pool.query(query, [new_uid.trim(), student_id.trim()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student ID not found in registered cards.' });
        }
        res.json({ status: 'success', card: result.rows[0] });
    } catch (err) {
        console.error('Error replacing card:', err.message);
        res.status(500).json({ error: 'Failed to replace RFID card.' });
    }
});

// DELETE /api/cards/:studentId - Delete / Revoke an RFID card
app.delete('/api/cards/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const query = `DELETE FROM cards WHERE LOWER(student_id) = LOWER($1) RETURNING *;`;
        const result = await pool.query(query, [studentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card record not found.' });
        }
        res.json({ status: 'success', message: 'RFID card revoked successfully.' });
    } catch (err) {
        console.error('Error deleting card:', err.message);
        res.status(500).json({ error: 'Failed to delete RFID card.' });
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
    const cleanIdentifier = identifier.toUpperCase().trim();
    
    try {
        const query = 'DELETE FROM cards WHERE UPPER(student_id) = $1 OR UPPER(uid) = $1 RETURNING *';
        const result = await pool.query(query, [cleanIdentifier]);

        if (result.rows.length > 0) {
            const deletedCard = result.rows[0];
            
            // Delete user account from Users table if present
            await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1 OR UPPER(user_id) = $2', [
                deletedCard.student_id.toUpperCase(),
                cleanIdentifier
            ]);

            res.status(200).json({ message: 'Student, card record, and user account deleted successfully.' });
        } else {
            // Check if user account exists in Users directly and delete it
            const userDelete = await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1 RETURNING *', [cleanIdentifier]);
            if (userDelete.rows.length > 0) {
                res.status(200).json({ message: 'User account deleted successfully.' });
            } else {
                res.status(404).json({ error: 'Student not found.' });
            }
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
        const todayStr = getTodayDateString();
        const attQuery = await pool.query('SELECT * FROM Attendance WHERE student_id = $1 AND date = $2', [student_id, todayStr]);
        
        let checkType = null;
        if (attQuery.rows.length === 0) {
            // First scan of the day - In
            await pool.query('INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, $2, CURRENT_TIMESTAMP)', [student_id, todayStr]);
            checkType = 'IN';
        } else if (!attQuery.rows[0].time_out) {
            // Second scan of the day - Out
            await pool.query('UPDATE Attendance SET time_out = CURRENT_TIMESTAMP WHERE student_id = $1 AND date = $2', [student_id, todayStr]);
            checkType = 'OUT';
        } else {
            // 3rd punch onwards: Student has already checked IN and OUT today (max 2 punches)
            return res.json({
                status: 'limit',
                message: '2x punch is done try tomorrow',
                student_id
            });
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
                cards.name AS card_name, cards.uid,
                c.class_name, c.roll_number, c.section, c.student_group, c.shift,
                cont.mobile_number, cont.fathers_phone
            FROM Attendance a
            JOIN cards ON a.student_id = cards.student_id
            LEFT JOIN PersonalData p ON a.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation c ON a.student_id = c.student_id
            LEFT JOIN StudentContactInformation cont ON a.student_id = cont.student_id
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
                cards.name AS card_name, cards.uid,
                c.class_name, c.roll_number, c.section, c.student_group, c.shift,
                cont.mobile_number, cont.fathers_phone
            FROM Attendance a
            JOIN cards ON a.student_id = cards.student_id
            LEFT JOIN PersonalData p ON a.student_id = p.student_id
            LEFT JOIN StudentAcademicInformation c ON a.student_id = c.student_id
            LEFT JOIN StudentContactInformation cont ON a.student_id = cont.student_id
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

// 22b. Dashboard Analytics & Visual Charts Data Endpoint
app.get(['/api/analytics/dashboard', '/api/rfid/analytics/dashboard'], async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const boundedDays = Math.min(Math.max(days, 1), 60);

        // 1. Overall Attendance Trends (last N days)
        const trendsQuery = `
            WITH date_series AS (
                SELECT (CURRENT_DATE - (i || ' days')::interval)::date AS date
                FROM generate_series(0, $1 - 1) i
            )
            SELECT 
                ds.date::text AS date,
                TO_CHAR(ds.date, 'Mon DD') AS date_label,
                COUNT(DISTINCT a.student_id) AS present_count
            FROM date_series ds
            LEFT JOIN Attendance a ON a.date = ds.date
            GROUP BY ds.date
            ORDER BY ds.date ASC
        `;
        const trendsResult = await pool.query(trendsQuery, [boundedDays]);

        // 2. Gender Distribution (Overall & Present Today)
        const genderOverallQuery = `
            SELECT 
                CASE 
                    WHEN LOWER(TRIM(gender)) IN ('male', 'm') THEN 'Male'
                    WHEN LOWER(TRIM(gender)) IN ('female', 'f') THEN 'Female'
                    ELSE 'Other/Unspecified'
                END AS gender,
                COUNT(DISTINCT student_id) AS count
            FROM PersonalData
            GROUP BY 1
        `;
        const genderOverallRes = await pool.query(genderOverallQuery);

        const genderPresentTodayQuery = `
            SELECT 
                CASE 
                    WHEN LOWER(TRIM(p.gender)) IN ('male', 'm') THEN 'Male'
                    WHEN LOWER(TRIM(p.gender)) IN ('female', 'f') THEN 'Female'
                    ELSE 'Other/Unspecified'
                END AS gender,
                COUNT(DISTINCT a.student_id) AS count
            FROM Attendance a
            JOIN PersonalData p ON a.student_id = p.student_id
            WHERE a.date = CURRENT_DATE
            GROUP BY 1
        `;
        const genderPresentRes = await pool.query(genderPresentTodayQuery);

        // 3. Class-wise Attendance Rates Today (Class 3 to 12)
        const classWiseQuery = `
            SELECT 
                s.class_name,
                COUNT(DISTINCT s.student_id) AS total_students,
                COUNT(DISTINCT a.student_id) AS present_students,
                CASE 
                    WHEN COUNT(DISTINCT s.student_id) > 0 
                    THEN ROUND((COUNT(DISTINCT a.student_id)::numeric / COUNT(DISTINCT s.student_id)::numeric) * 100, 1)
                    ELSE 0 
                END AS attendance_rate
            FROM StudentAcademicInformation s
            LEFT JOIN Attendance a ON s.student_id = a.student_id AND a.date = CURRENT_DATE
            WHERE s.class_name IS NOT NULL AND TRIM(s.class_name) != ''
            GROUP BY s.class_name
            ORDER BY 
                CASE 
                    WHEN s.class_name ~ '^[0-9]+$' THEN s.class_name::integer
                    ELSE 999 
                END, s.class_name ASC
        `;
        const classWiseRes = await pool.query(classWiseQuery);

        // 4. Summary KPIs
        const totalStudentsRes = await pool.query('SELECT COUNT(*) FROM cards');
        const presentTodayRes = await pool.query('SELECT COUNT(DISTINCT student_id) FROM Attendance WHERE date = CURRENT_DATE');
        const totalTeachersRes = await pool.query('SELECT COUNT(*) FROM TeacherPersonalData');

        const totalStudents = parseInt(totalStudentsRes.rows[0]?.count || 0);
        const presentToday = parseInt(presentTodayRes.rows[0]?.count || 0);
        const totalTeachers = parseInt(totalTeachersRes.rows[0]?.count || 0);
        const overallRate = totalStudents > 0 ? parseFloat(((presentToday / totalStudents) * 100).toFixed(1)) : 0;

        res.status(200).json({
            summary: {
                totalStudents,
                presentToday,
                attendanceRate: overallRate,
                totalTeachers
            },
            trends: trendsResult.rows,
            genderDistribution: {
                overall: genderOverallRes.rows,
                todayPresent: genderPresentRes.rows
            },
            classWise: classWiseRes.rows
        });
    } catch (err) {
        console.error('Error fetching dashboard analytics:', err.message);
        res.status(500).json({ error: 'Database error fetching dashboard analytics' });
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

// =========================================================================
// CLASS MANAGEMENT ENDPOINTS
// =========================================================================

function cleanTimeForPg(timeStr) {
    if (!timeStr) return '00:00';
    let t = timeStr.trim().toUpperCase();
    if (t.includes('AM') || t.includes('PM')) {
        const isPM = t.includes('PM');
        t = t.replace('AM', '').replace('PM', '').trim();
        let [h, m] = t.split(':');
        let hr = parseInt(h);
        if (isPM && hr < 12) hr += 12;
        if (!isPM && hr === 12) hr = 0;
        return `${String(hr).padStart(2, '0')}:${m || '00'}`;
    }
    return t;
}

// GET /api/classes - Get all classes
app.get('/api/classes', async (req, res) => {
    try {
        const query = `
            SELECT id, class_name, section, subject, room_number,
                   TO_CHAR(start_time, 'HH24:MI') as start_time,
                   TO_CHAR(end_time, 'HH24:MI') as end_time,
                   shift, academic_year, capacity, class_type, days,
                   COALESCE(assigned_teacher_id, '') as assigned_teacher_id,
                   COALESCE(assigned_teacher_name, '') as assigned_teacher_name,
                   created_at, updated_at
            FROM classes
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        return res.status(200).json({ status: 'success', classes: result.rows });
    } catch (err) {
        console.error('Error fetching classes:', err.message);
        return res.status(500).json({ error: 'Failed to fetch classes from database.' });
    }
});

// POST /api/classes - Add a new class
app.post('/api/classes', async (req, res) => {
    try {
        const {
            id, class_name, section, subject, room_number,
            start_time, end_time, shift, academic_year, capacity,
            class_type, days, assigned_teacher_id, assigned_teacher_name
        } = req.body;

        const classId = id || ('CLS-' + Date.now().toString(36).toUpperCase());
        const cap = capacity ? parseInt(capacity) : null;
        const daysArr = Array.isArray(days) ? days : [];
        const sTime = cleanTimeForPg(start_time);
        const eTime = cleanTimeForPg(end_time);
        const teacherId = (assigned_teacher_id && assigned_teacher_id.trim()) ? assigned_teacher_id.trim() : null;
        const teacherName = (assigned_teacher_name && assigned_teacher_name.trim()) ? assigned_teacher_name.trim() : null;

        const query = `
            INSERT INTO classes (
                id, class_name, section, subject, room_number,
                start_time, end_time, shift, academic_year, capacity,
                class_type, days, assigned_teacher_id, assigned_teacher_name
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id, class_name, section, subject, room_number,
                      TO_CHAR(start_time, 'HH24:MI') as start_time,
                      TO_CHAR(end_time, 'HH24:MI') as end_time,
                      shift, academic_year, capacity, class_type, days,
                      COALESCE(assigned_teacher_id, '') as assigned_teacher_id,
                      COALESCE(assigned_teacher_name, '') as assigned_teacher_name;
        `;
        const result = await pool.query(query, [
            classId, class_name, section, subject, room_number,
            sTime, eTime, shift || 'Morning', academic_year || '2026-2027', cap,
            class_type || 'Regular', daysArr, teacherId, teacherName
        ]);

        return res.status(201).json({ status: 'success', class: result.rows[0] });
    } catch (err) {
        console.error('Error saving class:', err.message);
        return res.status(500).json({ error: 'Failed to save class to database.' });
    }
});

// GET /api/classes/assignments - Get all teacher assignments
app.get('/api/classes/assignments', async (req, res) => {
    try {
        const result = await pool.query('SELECT teacher_id, class_id, teacher_name FROM class_assignments ORDER BY id DESC;');
        return res.status(200).json({ status: 'success', assignments: result.rows });
    } catch (err) {
        console.error('Error fetching assignments:', err.message);
        return res.status(500).json({ error: 'Failed to fetch assignments.' });
    }
});

// POST /api/classes/assign - Assign teacher to a class
app.post('/api/classes/assign', async (req, res) => {
    try {
        const { teacher_id, class_id, teacher_name } = req.body;
        const effectiveTeacherId = teacher_id || teacher_name || 'UNASSIGNED';
        if (!class_id) {
            return res.status(400).json({ error: 'class_id is required.' });
        }

        await pool.query(`
            INSERT INTO class_assignments (teacher_id, class_id, teacher_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (teacher_id, class_id) DO NOTHING;
        `, [effectiveTeacherId, class_id, teacher_name || effectiveTeacherId]);

        await pool.query(`
            UPDATE classes
            SET assigned_teacher_id = $1, assigned_teacher_name = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3;
        `, [effectiveTeacherId, teacher_name || effectiveTeacherId, class_id]);

        return res.status(200).json({ status: 'success', message: 'Teacher assigned successfully.' });
    } catch (err) {
        console.error('Error assigning teacher:', err.message);
        return res.status(500).json({ error: 'Failed to assign teacher.' });
    }
});

// DELETE /api/classes/assignments - Remove teacher assignment
app.delete('/api/classes/assignments', async (req, res) => {
    try {
        const { teacher_id, class_id } = req.query;
        if (!teacher_id && !class_id) {
            return res.status(400).json({ error: 'teacher_id or class_id is required.' });
        }

        if (class_id && teacher_id) {
            await pool.query('DELETE FROM class_assignments WHERE class_id = $1 AND teacher_id = $2;', [class_id, teacher_id]);
        } else if (class_id) {
            await pool.query('DELETE FROM class_assignments WHERE class_id = $1;', [class_id]);
        } else if (teacher_id) {
            await pool.query('DELETE FROM class_assignments WHERE teacher_id = $1;', [teacher_id]);
        }

        if (class_id) {
            await pool.query('UPDATE classes SET assigned_teacher_id = \'\', assigned_teacher_name = \'\' WHERE id = $1;', [class_id]);
        }

        return res.status(200).json({ status: 'success', message: 'Assignment removed.' });
    } catch (err) {
        console.error('Error removing assignment:', err.message);
        return res.status(500).json({ error: 'Failed to remove assignment.' });
    }
});

// PUT /api/classes/:id - Update an existing class
app.put('/api/classes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            class_name, section, subject, room_number,
            start_time, end_time, shift, academic_year, capacity,
            class_type, days, assigned_teacher_id, assigned_teacher_name
        } = req.body;

        const cap = capacity ? parseInt(capacity) : null;
        const daysArr = Array.isArray(days) ? days : [];
        const sTime = cleanTimeForPg(start_time);
        const eTime = cleanTimeForPg(end_time);
        const teacherId = (assigned_teacher_id && assigned_teacher_id.trim()) ? assigned_teacher_id.trim() : null;
        const teacherName = (assigned_teacher_name && assigned_teacher_name.trim()) ? assigned_teacher_name.trim() : null;

        const query = `
            UPDATE classes
            SET class_name = $1, section = $2, subject = $3, room_number = $4,
                start_time = $5, end_time = $6, shift = $7, academic_year = $8,
                capacity = $9, class_type = $10, days = $11,
                assigned_teacher_id = $12,
                assigned_teacher_name = $13,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $14
            RETURNING id, class_name, section, subject, room_number,
                      TO_CHAR(start_time, 'HH24:MI') as start_time,
                      TO_CHAR(end_time, 'HH24:MI') as end_time,
                      shift, academic_year, capacity, class_type, days,
                      COALESCE(assigned_teacher_id, '') as assigned_teacher_id,
                      COALESCE(assigned_teacher_name, '') as assigned_teacher_name;
        `;
        const result = await pool.query(query, [
            class_name, section, subject, room_number,
            sTime, eTime, shift, academic_year, cap,
            class_type, daysArr, teacherId, teacherName, id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class not found.' });
        }

        return res.status(200).json({ status: 'success', class: result.rows[0] });
    } catch (err) {
        console.error('Error updating class:', err.message);
        return res.status(500).json({ error: 'Failed to update class.' });
    }
});

// DELETE /api/classes/:id - Delete a class
app.delete('/api/classes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM class_assignments WHERE class_id = $1;', [id]);
        const result = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING id;', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class not found.' });
        }
        return res.status(200).json({ status: 'success', message: 'Class deleted successfully.' });
    } catch (err) {
        console.error('Error deleting class:', err.message);
        return res.status(500).json({ error: 'Failed to delete class.' });
    }
});

// =========================================================================
// RECENT ACTIVITIES ENDPOINT
// Combines: new students, teachers, RFID cards, classes — sorted by date
// =========================================================================
app.get('/api/recent-activities', async (req, res) => {
    try {
        const activities = [];

        // 1. Recently added students (PersonalData table — when profile was filled)
        const studentsRes = await pool.query(`
            SELECT p.student_id, p.first_name, p.last_name, p.updated_at AS event_time,
                   a.class_name, a.section
            FROM PersonalData p
            LEFT JOIN StudentAcademicInformation a ON p.student_id = a.student_id
            ORDER BY p.updated_at DESC
            LIMIT 10
        `);
        studentsRes.rows.forEach(r => {
            const classInfo = r.class_name ? ` · Class ${r.class_name}${r.section ? '-' + r.section : ''}` : '';
            activities.push({
                type: 'student_added',
                icon: 'graduation-cap',
                color: '#3b82f6',
                bg: '#eff6ff',
                label: `New student added: ${r.first_name} ${r.last_name} (${r.student_id})${classInfo}`,
                time: r.event_time
            });
        });

        // 2. Recently added teachers
        const teachersRes = await pool.query(`
            SELECT teacher_id, full_name, designation, department, created_at AS event_time
            FROM TeacherPersonalData
            ORDER BY created_at DESC
            LIMIT 10
        `);
        teachersRes.rows.forEach(r => {
            const role = r.designation || 'Teacher';
            activities.push({
                type: 'teacher_added',
                icon: 'chalkboard-user',
                color: '#7c3aed',
                bg: '#f5f3ff',
                label: `Teacher ${r.teacher_id} · ${r.full_name} added (${role})`,
                time: r.event_time
            });
        });

        // 3. Recently registered RFID cards
        const cardsRes = await pool.query(`
            SELECT uid, student_id, name, created_at AS event_time
            FROM cards
            ORDER BY created_at DESC
            LIMIT 10
        `);
        cardsRes.rows.forEach(r => {
            activities.push({
                type: 'rfid_registered',
                icon: 'id-card',
                color: '#0891b2',
                bg: '#ecfeff',
                label: `RFID card registered for ${r.student_id} · ${r.name}`,
                time: r.event_time
            });
        });

        // 4. Recently created classes
        const classesRes = await pool.query(`
            SELECT id, class_name, section, subject, days, assigned_teacher_name, created_at AS event_time
            FROM classes
            ORDER BY created_at DESC
            LIMIT 10
        `);
        classesRes.rows.forEach(r => {
            const daysStr = Array.isArray(r.days) ? r.days.join('/') : (r.days || '');
            const teacherInfo = r.assigned_teacher_name ? ` · ${r.assigned_teacher_name}` : '';
            activities.push({
                type: 'class_created',
                icon: 'school',
                color: '#059669',
                bg: '#ecfdf5',
                label: `Class ${r.class_name}-${r.section} ${r.subject} created (${daysStr})${teacherInfo}`,
                time: r.event_time
            });
        });

        // 5. Recently created class assignments (teacher → class)
        const assignRes = await pool.query(`
            SELECT ca.teacher_name, c.class_name, c.section, c.subject, ca.created_at AS event_time
            FROM class_assignments ca
            JOIN classes c ON ca.class_id = c.id
            ORDER BY ca.created_at DESC
            LIMIT 10
        `);
        assignRes.rows.forEach(r => {
            activities.push({
                type: 'teacher_assigned',
                icon: 'link',
                color: '#d97706',
                bg: '#fffbeb',
                label: `${r.teacher_name} assigned to Class ${r.class_name}-${r.section} · ${r.subject}`,
                time: r.event_time
            });
        });

        // Sort all by event_time DESC and return top 25
        activities.sort((a, b) => new Date(b.time) - new Date(a.time));
        res.json(activities.slice(0, 25));
    } catch (err) {
        console.error('Error fetching recent activities:', err.message);
        res.status(500).json({ error: 'Failed to fetch recent activities' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`RFID Admin Node.js Server listening on port ${PORT}`);
    console.log(`PostgreSQL Database: StudentData (Tables: cards, PersonalData, StudentAcademicInformation, classes, class_assignments)`);
    console.log(`====================================================`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[Port Handler] Port ${PORT} is in use. Releasing port ${PORT}...`);
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                execSync(`powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -Force -ErrorAction SilentlyContinue"`);
            } else {
                execSync(`fuser -k ${PORT}/tcp || true`);
            }
            setTimeout(() => {
                server.close();
                app.listen(PORT, () => {
                    console.log(`====================================================`);
                    console.log(`RFID Admin Node.js Server restarted & listening on port ${PORT}`);
                    console.log(`====================================================`);
                });
            }, 1000);
        } catch (e) {
            console.error(`Failed to release port ${PORT}:`, e.message);
        }
    }
});

