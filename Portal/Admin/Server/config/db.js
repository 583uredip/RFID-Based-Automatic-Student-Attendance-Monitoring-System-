const { Pool } = require('pg');

// Sync PostgreSQL timezone with local system timezone
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
process.env.PGTZ = systemTimeZone;

// PostgreSQL Pool Connection Configuration
// Supports DATABASE_URL (Neon/Render/cloud) or individual env vars (local)
const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        options: `-c timezone=${systemTimeZone}`
    }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'StudentData',
        password: process.env.PGPASSWORD || '1910',
        port: process.env.PGPORT || 5432,
        options: `-c timezone=${systemTimeZone}`
    };

const pool = new Pool(poolConfig);

// Verify PostgreSQL Connection on startup
pool.query('SELECT 1')
    .then(() => {
        console.log('Successfully connected to PostgreSQL Database "StudentData"!');
    })
    .catch(err => {
        console.error('Error connecting to PostgreSQL database "StudentData":', err.message);
    });

module.exports = pool;
