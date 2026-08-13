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
            console.log('Class management tables (classes, class_assignments) ready.');
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
