const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'StudentData',
    password: '1910',
    port: 5432,
});

async function modifyUsersTable() {
    try {
        const checkCol = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'reference_id';
        `);
        if (checkCol.rows.length > 0) {
            const query = `
                ALTER TABLE Users DROP CONSTRAINT IF EXISTS users_pkey;
                ALTER TABLE Users DROP COLUMN IF EXISTS id;
                ALTER TABLE Users RENAME COLUMN reference_id TO user_id;
                ALTER TABLE Users ADD PRIMARY KEY (user_id);
                ALTER INDEX IF EXISTS idx_users_reference_id RENAME TO idx_users_user_id;
            `;
            await pool.query(query);
            console.log('Table Users modified successfully.');
        } else {
            console.log('Table Users already matches standard schema (user_id column exists). No action required.');
        }
    } catch (err) {
        console.error('Error modifying table:', err);
    } finally {
        pool.end();
    }
}

modifyUsersTable();
