const Card = require('../models/Card');
const Attendance = require('../models/Attendance');
const { sendAttendanceEmail } = require('../emailService');

let lastWebPollTime = 0;

let latestScan = {
    uid: null,
    studentId: null,
    registered: false,
    name: '',
    timestamp: null
};

exports.handleScan = async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({ error: 'Card UID is required' });
    }

    const cleanUid = uid.toUpperCase().trim();

    try {
        const card = await Card.findByUid(cleanUid);

        if (card) {
            latestScan = {
                uid: cleanUid,
                studentId: card.student_id,
                registered: true,
                name: card.name,
                timestamp: new Date()
            };

            try {
                const todayStr = Attendance.getTodayDateString();
                const attRows = await Attendance.getTodayRecord(card.student_id, todayStr);
                
                let checkType = null;
                if (attRows.length === 0) {
                    await Attendance.insertCheckIn(card.student_id, todayStr);
                    checkType = 'IN';
                } else if (!attRows[0].time_out) {
                    await Attendance.updateCheckOut(card.student_id, todayStr);
                    checkType = 'OUT';
                } else {
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
                
                const studentInfo = await Attendance.getStudentDetailsForEmail(card.student_id);
                if (studentInfo) {
                    sendAttendanceEmail(studentInfo, checkType);
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
            const nextStudentId = await Card.generateNextStudentId();
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
};

exports.getLatestScan = (req, res) => {
    if (req.query.active === 'true') {
        lastWebPollTime = Date.now();
    }
    res.json(latestScan);
};

exports.getLegacyScanDetails = (req, res) => {
    res.json({ waiting: false });
};

exports.handleSync = async (req, res) => {
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
            const card = await Card.findByUid(cleanUid);
            if (!card) {
                skipped++;
                continue;
            }

            const resultStatus = await Attendance.syncOfflineRecord(card.student_id, tapDateStr, tapTime);
            if (resultStatus === 'IN' || resultStatus === 'OUT') {
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
};

exports.handleRegister = async (req, res) => {
    const { uid, name, studentId } = req.body;

    if (!uid || !name || !name.trim()) {
        return res.status(400).json({ error: 'UID and Student Name are required.' });
    }

    const cleanUid = uid.toUpperCase().trim();
    const cleanName = name.trim();

    try {
        const checkCard = await Card.findByUid(cleanUid);
        if (checkCard) {
            return res.status(400).json({ error: 'This RFID card is already registered.' });
        }

        const finalStudentId = (studentId && studentId.trim()) ? studentId.trim() : await Card.generateNextStudentId();
        const newCard = await Card.registerCard(cleanUid, finalStudentId, cleanName);

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
};

exports.getRfidCards = async (req, res) => {
    try {
        const cards = await Card.getRfidCards();
        res.json(cards);
    } catch (err) {
        console.error('Error fetching cards:', err.message);
        res.status(500).json({ error: 'Failed to retrieve card data' });
    }
};

exports.deleteCardByUid = async (req, res) => {
    const { uid } = req.params;
    const cleanUid = uid.toUpperCase().trim();
    try {
        const deletedCard = await Card.deleteByUid(cleanUid);
        if (deletedCard && deletedCard.student_id) {
            const pool = require('../config/db');
            await pool.query('DELETE FROM Users WHERE UPPER(user_id) = $1', [deletedCard.student_id.toUpperCase()]);
        }
        res.json({ message: 'Card record and associated user account deleted successfully' });
    } catch (err) {
        console.error('Error deleting card:', err.message);
        res.status(500).json({ error: 'Failed to delete card' });
    }
};

exports.getAllCards = async (req, res) => {
    try {
        const cards = await Card.getAllCards();
        res.json(cards);
    } catch (err) {
        console.error('Error fetching cards:', err.message);
        res.status(500).json({ error: 'Server error fetching RFID cards.' });
    }
};

exports.searchCards = async (req, res) => {
    try {
        const { query: searchQuery } = req.params;
        const card = await Card.searchCard(searchQuery);
        if (!card) {
            return res.status(404).json({ error: 'No card found matching query.' });
        }
        res.json(card);
    } catch (err) {
        console.error('Error searching card:', err.message);
        res.status(500).json({ error: 'Server error searching RFID card.' });
    }
};

exports.registerCardPost = async (req, res) => {
    try {
        const { uid, student_id, name } = req.body;
        if (!uid || !student_id || !name) {
            return res.status(400).json({ error: 'Missing required fields: uid, student_id, name.' });
        }

        const card = await Card.upsertCard(uid.trim(), student_id.trim(), name.trim());
        res.json({ status: 'success', card });
    } catch (err) {
        console.error('Error registering card:', err.message);
        res.status(500).json({ error: 'Failed to register RFID card.' });
    }
};

exports.replaceCardPost = async (req, res) => {
    try {
        const { student_id, new_uid } = req.body;
        if (!student_id || !new_uid) {
            return res.status(400).json({ error: 'Missing student_id or new_uid.' });
        }

        const card = await Card.replaceCardUid(student_id.trim(), new_uid.trim());
        if (!card) {
            return res.status(404).json({ error: 'Student ID not found in registered cards.' });
        }
        res.json({ status: 'success', card });
    } catch (err) {
        console.error('Error replacing card:', err.message);
        res.status(500).json({ error: 'Failed to replace RFID card.' });
    }
};

exports.deleteCardByStudentId = async (req, res) => {
    try {
        const { studentId } = req.params;
        const card = await Card.deleteByStudentId(studentId);
        if (!card) {
            return res.status(404).json({ error: 'Card record not found.' });
        }
        res.json({ status: 'success', message: 'RFID card revoked successfully.' });
    } catch (err) {
        console.error('Error deleting card:', err.message);
        res.status(500).json({ error: 'Failed to delete RFID card.' });
    }
};

exports.replaceRfidFull = async (req, res) => {
    const { oldUid, newUid, studentId, name } = req.body;

    if (!newUid || !studentId) {
        return res.status(400).json({ error: 'New UID and Student ID are required.' });
    }

    const cleanNewUid = newUid.toUpperCase().trim();
    
    try {
        const checkResult = await Card.findByUid(cleanNewUid);
        if (checkResult) {
            return res.status(400).json({ error: 'This new RFID card is already registered to another student.' });
        }

        const checkStudent = await Card.findByStudentId(studentId);
        if (checkStudent) {
            const updatedCard = await Card.updateUidByStudentId(studentId, cleanNewUid);

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
            const cleanName = name ? name.trim() : 'Unknown';
            const newCard = await Card.registerCard(cleanNewUid, studentId, cleanName);

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
};
