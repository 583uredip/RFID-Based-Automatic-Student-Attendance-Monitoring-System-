const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./config/db');
const ClassModel = require('./models/Class');

// Route Imports
const rfidRoutes = require('./routes/rfidRoutes');
const studentRoutes = require('./routes/studentRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const classRoutes = require('./routes/classRoutes');
const userRoutes = require('./routes/userRoutes');
const activityRoutes = require('./routes/activityRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static File Serving — serve entire Portal directory
const portalStaticPath = path.join(__dirname, '..', '..');
app.use(express.static(portalStaticPath));

// Root redirect → Portal index
app.get('/', (req, res) => {
    res.sendFile(path.join(portalStaticPath, 'index.html'));
});

// Initialize Class Tables
ClassModel.initTables();

// API Routes Registration
app.use('/api', rfidRoutes);
app.use('/api', studentRoutes);
app.use('/api', teacherRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', classRoutes);
app.use('/api', userRoutes);
app.use('/api', activityRoutes);

// Start Server
const startServer = () => {
    const server = app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`Kapataksha High School MVC Server listening on port ${PORT}`);
        console.log(`PostgreSQL Database: StudentData`);
        console.log(`====================================================`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Port Handler] Port ${PORT} is in use. Releasing port ${PORT}...`);
            try {
                const { execSync } = require('child_process');
                if (process.platform === 'win32') {
                    execSync(`powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue).OwningProcess -Force -ErrorAction SilentlyContinue"`);
                } else {
                    execSync(`fuser -k ${PORT}/tcp || true`);
                }
                setTimeout(() => {
                    startServer();
                }, 1000);
            } catch (e) {
                console.error(`Failed to release port ${PORT}:`, e.message);
            }
        } else {
            console.error('Server error:', err.message);
        }
    });

    return server;
};

const server = startServer();

module.exports = app;
