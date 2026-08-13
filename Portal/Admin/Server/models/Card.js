const pool = require('../config/db');

class CardModel {
    static async initTable() {
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

    static async generateNextStudentId() {
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

    static async findByUid(cleanUid) {
        const result = await pool.query('SELECT * FROM cards WHERE uid = $1', [cleanUid]);
        return result.rows[0] || null;
    }

    static async findByStudentId(studentId) {
        const result = await pool.query('SELECT * FROM cards WHERE student_id = $1', [studentId]);
        return result.rows[0] || null;
    }

    static async registerCard(uid, studentId, name) {
        const query = `
            INSERT INTO cards (uid, student_id, name)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await pool.query(query, [uid, studentId, name]);
        return result.rows[0];
    }

    static async upsertCard(uid, studentId, name) {
        const query = `
            INSERT INTO cards (uid, student_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (uid) DO UPDATE SET student_id = EXCLUDED.student_id, name = EXCLUDED.name
            RETURNING id, uid, student_id, name, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at;
        `;
        const result = await pool.query(query, [uid, studentId, name]);
        return result.rows[0];
    }

    static async replaceCardUid(studentId, newUid) {
        const query = `
            UPDATE cards
            SET uid = $1, created_at = CURRENT_TIMESTAMP
            WHERE LOWER(student_id) = LOWER($2)
            RETURNING id, uid, student_id, name, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at;
        `;
        const result = await pool.query(query, [newUid, studentId]);
        return result.rows[0] || null;
    }

    static async updateUidByStudentId(studentId, newUid) {
        const query = `
            UPDATE cards 
            SET uid = $1 
            WHERE student_id = $2 
            RETURNING *;
        `;
        const result = await pool.query(query, [newUid, studentId]);
        return result.rows[0] || null;
    }

    static async getRfidCards() {
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
        return result.rows;
    }

    static async getAllCards() {
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
        return result.rows;
    }

    static async searchCard(searchQuery) {
        const query = `
            SELECT c.id, c.uid, c.student_id, c.name, TO_CHAR(c.created_at, 'YYYY-MM-DD') AS created_at
            FROM cards c
            WHERE LOWER(c.student_id) = LOWER($1) OR LOWER(c.uid) = LOWER($1) OR LOWER(c.name) LIKE LOWER($2);
        `;
        const result = await pool.query(query, [searchQuery, `%${searchQuery}%`]);
        return result.rows[0] || null;
    }

    static async deleteByUid(cleanUid) {
        const cardRes = await pool.query('DELETE FROM cards WHERE uid = $1 RETURNING *', [cleanUid]);
        return cardRes.rows[0] || null;
    }

    static async deleteByStudentId(studentId) {
        const query = `DELETE FROM cards WHERE LOWER(student_id) = LOWER($1) RETURNING *;`;
        const result = await pool.query(query, [studentId]);
        return result.rows[0] || null;
    }
}

CardModel.initTable();

module.exports = CardModel;
