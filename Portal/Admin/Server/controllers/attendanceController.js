const Attendance = require('../models/Attendance');
const Card = require('../models/Card');
const { sendAttendanceEmail, sendLateEmail, sendBunkEmail } = require('../emailService');

exports.scanAttendance = async (req, res) => {
    const { uid } = req.body;
    if (!uid) {
        return res.status(400).json({ error: 'Card UID is required.' });
    }

    try {
        const card = await Card.findByUid(uid);
        if (!card) {
            return res.status(404).json({ error: 'Unregistered Card' });
        }
        
        const student_id = card.student_id;
        const todayStr = Attendance.getTodayDateString();
        const attRows = await Attendance.getTodayRecord(student_id, todayStr);
        
        let checkType = null;
        if (attRows.length === 0) {
            await Attendance.insertCheckIn(student_id, todayStr);
            checkType = 'IN';
        } else if (!attRows[0].time_out) {
            await Attendance.updateCheckOut(student_id, todayStr);
            checkType = 'OUT';
        } else {
            return res.json({
                status: 'limit',
                message: '2x punch is done try tomorrow',
                student_id
            });
        }

        const studentInfo = await Attendance.getStudentDetailsForEmail(student_id);
        if (studentInfo) {
            sendAttendanceEmail(studentInfo, checkType);
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
};

exports.getLiveAttendance = async (req, res) => {
    try {
        const liveData = await Attendance.getLiveAttendance();
        res.status(200).json(liveData);
    } catch (err) {
        console.error('Error fetching live attendance:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
};

exports.getHistory = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const history = await Attendance.getAttendanceHistory(startDate, endDate);
        res.status(200).json(history);
    } catch (err) {
        console.error('Error fetching attendance history:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
};

exports.getReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const report = await Attendance.getAttendanceReport(startDate, endDate);
        res.status(200).json(report);
    } catch (err) {
        console.error('Error fetching attendance report:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
};

exports.getLate = async (req, res) => {
    try {
        const { date, threshold } = req.query;
        if (!date || !threshold) {
            return res.status(400).json({ error: 'date and threshold are required' });
        }

        const lateStudents = await Attendance.getLateStudents(date, threshold);
        res.status(200).json(lateStudents);
    } catch (err) {
        console.error('Error fetching late students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
};

exports.notifyLate = async (req, res) => {
    try {
        const { student_ids, date, threshold } = req.body;
        
        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return res.status(400).json({ error: 'student_ids array is required' });
        }
        
        const students = await Attendance.getLateStudentContacts(student_ids, date);
        let sentCount = 0;
        
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = new Date(date).toLocaleDateString('en-US', dateOptions);

        for (const student of students) {
            const timeInObj = new Date(student.time_in);
            const timeOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' };
            const timeInStr = timeInObj.toLocaleTimeString('en-US', timeOptions);
            
            let thresholdStr = threshold;
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
};

exports.getBunk = async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ error: 'date is required' });
        }

        const bunkedStudents = await Attendance.getBunkedStudents(date);
        res.status(200).json(bunkedStudents);
    } catch (err) {
        console.error('Error fetching bunked students:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
};

exports.notifyBunk = async (req, res) => {
    try {
        const { student_ids, date } = req.body;
        
        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return res.status(400).json({ error: 'student_ids array is required' });
        }
        
        const students = await Attendance.getBunkStudentContacts(student_ids, date);
        let sentCount = 0;
        
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = new Date(date).toLocaleDateString('en-US', dateOptions);

        for (const student of students) {
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
};

exports.getDashboardAnalytics = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const boundedDays = Math.min(Math.max(days, 1), 60);

        const analytics = await Attendance.getDashboardAnalytics(boundedDays);
        res.status(200).json(analytics);
    } catch (err) {
        console.error('Error fetching dashboard analytics:', err.message);
        res.status(500).json({ error: 'Database error fetching dashboard analytics' });
    }
};
