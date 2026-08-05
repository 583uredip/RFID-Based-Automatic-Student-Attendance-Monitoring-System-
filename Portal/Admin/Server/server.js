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

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`RFID Admin Node.js Server listening on port ${PORT}`);
    console.log(`PostgreSQL Database: StudentData (Tables: cards, PersonalData)`);
    console.log(`====================================================`);
});
