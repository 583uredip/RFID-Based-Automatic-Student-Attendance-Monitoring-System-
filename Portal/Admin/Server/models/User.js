const pool = require('../config/db');
const bcrypt = require('bcrypt');

class UserModel {
    static async createStudentUser(studentId) {
        const hashedPassword = await bcrypt.hash('student1212', 10);
        const userQuery = `
            INSERT INTO Users (user_id, username, password, role, account_status)
            VALUES ($1, $2, $3, 'Student', 'Active')
            ON CONFLICT (user_id) DO NOTHING
        `;
        await pool.query(userQuery, [studentId, ' ', hashedPassword]);
        return true;
    }
}

module.exports = UserModel;
