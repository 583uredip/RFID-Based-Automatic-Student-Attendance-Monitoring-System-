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
        const query = `
            ALTER TABLE Users DROP CONSTRAINT users_pkey;
            ALTER TABLE Users DROP COLUMN id;
            ALTER TABLE Users RENAME COLUMN reference_id TO user_id;
            ALTER TABLE Users ADD PRIMARY KEY (user_id);
            ALTER INDEX idx_users_reference_id RENAME TO idx_users_user_id;
        `;
        await pool.query(query);
        console.log('Table Users modified successfully.');
    } catch (err) {
        console.error('Error modifying table:', err);
    } finally {
        pool.end();
    }
}

modifyUsersTable();
