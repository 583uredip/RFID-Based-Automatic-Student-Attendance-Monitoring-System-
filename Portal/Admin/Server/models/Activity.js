const pool = require('../config/db');

class ActivityModel {
    static async getRecentActivities() {
        const activities = [];

        // 1. Recently added students
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

        // 5. Recently created class assignments
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

        activities.sort((a, b) => new Date(b.time) - new Date(a.time));
        return activities.slice(0, 25);
    }
}

module.exports = ActivityModel;
