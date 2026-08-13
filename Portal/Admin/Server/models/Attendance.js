const pool = require('../config/db');

function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

class AttendanceModel {
    static getTodayDateString() {
        return getTodayDateString();
    }

    static async getTodayRecord(studentId, todayStr) {
        const result = await pool.query('SELECT * FROM Attendance WHERE student_id = $1 AND date = $2', [studentId, todayStr]);
        return result.rows;
    }

    static async insertCheckIn(studentId, todayStr) {
        await pool.query('INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, $2, CURRENT_TIMESTAMP)', [studentId, todayStr]);
    }

    static async updateCheckOut(studentId, todayStr) {
        await pool.query('UPDATE Attendance SET time_out = CURRENT_TIMESTAMP WHERE student_id = $1 AND date = $2', [studentId, todayStr]);
    }

    static async getStudentDetailsForEmail(studentId) {
        const studentInfoQuery = await pool.query(`
            SELECT c.name, a.class_name, a.roll_number, a.section, p.fathers_email, p.mothers_email
            FROM cards c
            LEFT JOIN StudentAcademicInformation a ON c.student_id = a.student_id
            LEFT JOIN StudentContactInformation p ON c.student_id = p.student_id
            WHERE c.student_id = $1
        `, [studentId]);
        return studentInfoQuery.rows[0] || null;
    }

    static async syncOfflineRecord(studentId, tapDateStr, tapTime) {
        const attQuery = await pool.query(
            'SELECT * FROM Attendance WHERE student_id = $1 AND date = $2',
            [studentId, tapDateStr]
        );

        if (attQuery.rows.length === 0) {
            await pool.query(
                'INSERT INTO Attendance (student_id, date, time_in) VALUES ($1, $2, $3)',
                [studentId, tapDateStr, tapTime]
            );
            return 'IN';
        } else if (!attQuery.rows[0].time_out) {
            await pool.query(
                'UPDATE Attendance SET time_out = $1 WHERE student_id = $2 AND date = $3',
                [tapTime, studentId, tapDateStr]
            );
            return 'OUT';
        } else {
            return 'SKIPPED';
        }
    }

    static async getLiveAttendance() {
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
        return result.rows;
    }

    static async getAttendanceHistory(startDate, endDate) {
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
        return result.rows;
    }

    static async getAttendanceReport(startDate, endDate) {
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
        return result.rows;
    }

    static async getLateStudents(date, threshold) {
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
        return result.rows;
    }

    static async getLateStudentContacts(studentIds, date) {
        const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(',');
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
            JOIN Attendance a ON c.student_id = a.student_id AND a.date = $${studentIds.length + 1}
            WHERE c.student_id IN (${placeholders})
        `;
        const values = [...studentIds, date];
        const result = await pool.query(query, values);
        return result.rows;
    }

    static async getBunkedStudents(date) {
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
        return result.rows;
    }

    static async getBunkStudentContacts(studentIds, date) {
        const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(',');
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
            JOIN Attendance a ON c.student_id = a.student_id AND a.date = $${studentIds.length + 1}
            WHERE c.student_id IN (${placeholders})
        `;
        const values = [...studentIds, date];
        const result = await pool.query(query, values);
        return result.rows;
    }

    static async getDashboardAnalytics(boundedDays) {
        // 1. Trends
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

        // 2. Gender distribution
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

        // 3. Class-wise
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

        return {
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
        };
    }
}

module.exports = AttendanceModel;
