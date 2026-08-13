const pool = require('../config/db');

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

class ClassModel {
    static async initTables() {
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

            // Seed exact database schedules matching student curriculum
            const seedClasses = [
                { id: 'CLS-16-1', class_name: 'Ten', section: 'M', subject: 'MICROPROCESSOR AND EMBEDDED SYSTEMS', room_number: '9405', start_time: '08:00', end_time: '10:00', days: ['Sun'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-16-2', class_name: 'Ten', section: 'J', subject: 'COMPILER DESIGN', room_number: 'DS0106', start_time: '10:20', end_time: '12:40', days: ['Sun'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-16-3', class_name: 'Ten', section: 'N', subject: 'SOFTWARE ENGINEERING', room_number: '9306', start_time: '12:40', end_time: '14:40', days: ['Sun'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-17-1', class_name: 'Ten', section: 'N', subject: 'DATA COMMUNICATION', room_number: '9401', start_time: '08:00', end_time: '10:00', days: ['Mon'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-17-2', class_name: 'Ten', section: 'M', subject: 'COMPUTER AIDED DESIGN & DRAFTING', room_number: 'DN0210', start_time: '12:40', end_time: '15:00', days: ['Mon'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-18-1', class_name: 'Ten', section: 'M', subject: 'MICROPROCESSOR AND EMBEDDED SYSTEMS', room_number: 'DN0310', start_time: '08:00', end_time: '10:20', days: ['Tue'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-18-2', class_name: 'Ten', section: 'J', subject: 'COMPILER DESIGN', room_number: '9205', start_time: '10:20', end_time: '12:20', days: ['Tue'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-18-3', class_name: 'Ten', section: 'N', subject: 'SOFTWARE ENGINEERING', room_number: 'DS0206', start_time: '12:40', end_time: '15:00', days: ['Tue'], shift: 'Morning', academic_year: '2026' },
                { id: 'CLS-19-1', class_name: 'Ten', section: 'N', subject: 'DATA COMMUNICATION', room_number: 'DS0406', start_time: '08:00', end_time: '10:20', days: ['Wed'], shift: 'Morning', academic_year: '2026' }
            ];

            for (const c of seedClasses) {
                await this.createClass(c);
            }

            console.log('Class management tables initialized and seeded with exact schedules.');
        } catch (err) {
            console.error('Error initializing class management tables:', err.message);
        }
    }

    static async getAllClasses() {
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
        return result.rows;
    }

    /**
     * Gets matching class schedule for a specific student based on StudentAcademicInformation and database classes.
     */
    static async getStudentSchedule(studentId) {
        let className = '';
        let section = '';

        try {
            const academicResult = await pool.query(
                'SELECT class_name, section, shift, academic_year FROM StudentAcademicInformation WHERE student_id = $1',
                [studentId]
            );
            if (academicResult.rows.length > 0) {
                className = (academicResult.rows[0].class_name || '').trim();
                section = (academicResult.rows[0].section || '').trim();
            }
        } catch (e) {}

        try {
            // Build query: if we have class_name+section, match exactly; otherwise return all
            let query;
            let params;

            if (className && section) {
                query = `
                    SELECT 
                        id, class_name, section, subject, room_number,
                        TO_CHAR(start_time, 'FMHH12:MI') as start_time_formatted,
                        TO_CHAR(end_time, 'FMHH12:MI') as end_time_formatted,
                        TO_CHAR(start_time, 'AM') as start_ampm,
                        TO_CHAR(end_time, 'AM') as end_ampm,
                        shift, academic_year, class_type, days,
                        COALESCE(assigned_teacher_name, 'TBA') as teacher_name
                    FROM classes
                    WHERE UPPER(class_name) = UPPER($1)
                      AND UPPER(section) = UPPER($2)
                    ORDER BY
                        CASE 
                            WHEN 'Sun' = ANY(days) THEN 1
                            WHEN 'Mon' = ANY(days) THEN 2
                            WHEN 'Tue' = ANY(days) THEN 3
                            WHEN 'Wed' = ANY(days) THEN 4
                            WHEN 'Thu' = ANY(days) THEN 5
                            ELSE 6
                        END,
                        start_time ASC;
                `;
                params = [className, section];
            } else {
                query = `
                    SELECT 
                        id, class_name, section, subject, room_number,
                        TO_CHAR(start_time, 'FMHH12:MI') as start_time_formatted,
                        TO_CHAR(end_time, 'FMHH12:MI') as end_time_formatted,
                        TO_CHAR(start_time, 'AM') as start_ampm,
                        TO_CHAR(end_time, 'AM') as end_ampm,
                        shift, academic_year, class_type, days,
                        COALESCE(assigned_teacher_name, 'TBA') as teacher_name
                    FROM classes
                    ORDER BY start_time ASC;
                `;
                params = [];
            }

            const result = await pool.query(query, params);
            return {
                student_id: studentId,
                class_name: className || '',
                section: section || '',
                classes: result.rows
            };
        } catch (err) {
            console.error('Error fetching student schedule:', err.message);
            return { student_id: studentId, class_name: className, section: section, classes: [] };
        }
    }

    static async createClass(data) {
        const {
            id, class_name, section, subject, room_number,
            start_time, end_time, shift, academic_year, capacity,
            class_type, days, assigned_teacher_id, assigned_teacher_name
        } = data;

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
            ON CONFLICT (id) DO UPDATE SET
                class_name = EXCLUDED.class_name, section = EXCLUDED.section,
                subject = EXCLUDED.subject, room_number = EXCLUDED.room_number,
                start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
                days = EXCLUDED.days, updated_at = CURRENT_TIMESTAMP
            RETURNING id, class_name, section, subject, room_number,
                      TO_CHAR(start_time, 'HH24:MI') as start_time,
                      TO_CHAR(end_time, 'HH24:MI') as end_time,
                      shift, academic_year, capacity, class_type, days,
                      COALESCE(assigned_teacher_id, '') as assigned_teacher_id,
                      COALESCE(assigned_teacher_name, '') as assigned_teacher_name;
        `;
        const result = await pool.query(query, [
            classId, class_name, section, subject, room_number,
            sTime, eTime, shift || 'Morning', academic_year || '2026', cap,
            class_type || 'Regular', daysArr, teacherId, teacherName
        ]);
        return result.rows[0];
    }

    static async getAllAssignments() {
        const result = await pool.query('SELECT teacher_id, class_id, teacher_name FROM class_assignments ORDER BY id DESC;');
        return result.rows;
    }

    static async assignTeacher(effectiveTeacherId, class_id, teacherName) {
        await pool.query(`
            INSERT INTO class_assignments (teacher_id, class_id, teacher_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (teacher_id, class_id) DO NOTHING;
        `, [effectiveTeacherId, class_id, teacherName || effectiveTeacherId]);

        await pool.query(`
            UPDATE classes
            SET assigned_teacher_id = $1, assigned_teacher_name = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3;
        `, [effectiveTeacherId, teacherName || effectiveTeacherId, class_id]);
    }

    static async deleteAssignment(teacher_id, class_id) {
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
    }

    static async updateClass(id, data) {
        const {
            class_name, section, subject, room_number,
            start_time, end_time, shift, academic_year, capacity,
            class_type, days, assigned_teacher_id, assigned_teacher_name
        } = data;

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
        return result.rows[0] || null;
    }

    static async deleteClass(id) {
        await pool.query('DELETE FROM class_assignments WHERE class_id = $1;', [id]);
        const result = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING id;', [id]);
        return result.rows.length > 0;
    }
}

module.exports = ClassModel;
