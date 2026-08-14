/**
 * Student Dashboard JavaScript Module
 * Handles sidebar accordion toggle, user personal data loading, and class schedule rendering
 */

function toggleHeaderMobileMenu() {
    const menu = document.getElementById('header-mobile-menu');
    const toggleBtn = document.getElementById('mobile-toggle-btn');
    if (menu) {
        menu.classList.toggle('open');
    }
    if (toggleBtn) {
        toggleBtn.classList.toggle('active');
    }
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

function toggleMenu(id, btnElement) {
    const targetMenu = document.getElementById(id);
    if (!targetMenu) return;

    const isCurrentlyOpen = targetMenu.classList.contains('open');

    // Close all open sidebar menus and deactivate all sidebar buttons
    const allMenus = document.querySelectorAll('.sidebar-menu-content');
    const allButtons = document.querySelectorAll('.sidebar-btn');

    allMenus.forEach(menu => menu.classList.remove('open'));
    allButtons.forEach(btn => btn.classList.remove('active'));

    // If the clicked menu was not open, open it
    if (!isCurrentlyOpen) {
        targetMenu.classList.add('open');
        if (btnElement) {
            btnElement.classList.add('active');
        }
    }
}

// Helper function to resolve API Base Host
function getApiHost() {
    if (window.location.port === '3000') return window.location.origin;
    const hostname = (window.location.hostname && window.location.hostname !== '') ? window.location.hostname : 'localhost';
    return `http://${hostname}:3000`;
}

function toggleNotifications() {
    alert('Notifications: You have no unread notifications.');
}

function toggleSettingsModal() {
    alert('Settings: Account preferences and configuration window.');
}

function handleLogout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    window.location.href = '../index.html';
}

async function fetchPostgresStudentUsers() {
    const selectElem = document.getElementById('studentSelect');
    if (!selectElem) return;

    try {
        const response = await fetch(`${getApiHost()}/api/user/student-users`);
        if (!response.ok) return;

        const studentUsers = await response.json();
        if (Array.isArray(studentUsers) && studentUsers.length > 0) {
            selectElem.innerHTML = '<option value="" disabled selected>-- PostgreSQL Student User --</option>';
            studentUsers.forEach(user => {
                const name = (user.first_name || user.last_name) 
                    ? `${user.first_name || ''} ${user.last_name || ''}`.trim() 
                    : (user.card_name || 'Student');
                const opt = document.createElement('option');
                opt.value = user.user_id;
                opt.textContent = `${user.user_id} - ${name}`;
                selectElem.appendChild(opt);
            });

            // Restore saved student if available
            const savedStudentId = localStorage.getItem('selectedTestStudentId');
            if (savedStudentId && Array.from(selectElem.options).some(o => o.value === savedStudentId)) {
                selectElem.value = savedStudentId;
            }
        }
    } catch (err) {
        console.log('PostgreSQL live API connection fallback mode active');
    }
}

async function loadLoggedStudentPersonalData() {
    const welcomeElem = document.getElementById('welcome-username');
    const mobileWelcomeElem = document.getElementById('mobile-welcome-username');

    function setWelcome(nameText) {
        if (welcomeElem) welcomeElem.textContent = nameText;
        if (mobileWelcomeElem) mobileWelcomeElem.textContent = nameText;
    }

    let studentId = localStorage.getItem('selectedTestStudentId') || '26-00001';
    const currentUserStr = localStorage.getItem('currentUser');
    
    if (currentUserStr) {
        try {
            const user = JSON.parse(currentUserStr);
            if (user.user_id) studentId = user.user_id;
            if (user.last_name && user.first_name) {
                setWelcome(`Welcome ${user.last_name.toUpperCase()}, ${user.first_name.toUpperCase()}`);
            }
        } catch (e) {}
    }

    // Fetch live record from PersonalData table
    try {
        const response = await fetch(`${getApiHost()}/api/student/search?query=${encodeURIComponent(studentId)}`);
        if (response.ok) {
            const studentData = await response.json();
            if (studentData && studentData.last_name && studentData.first_name) {
                setWelcome(`Welcome ${studentData.last_name.toUpperCase()}, ${studentData.first_name.toUpperCase()}`);
                return;
            }
        }
    } catch (err) {
        console.log('PersonalData fallback active');
    }

    // Fallback default format if no PersonalData record is found
    if (!welcomeElem || !welcomeElem.textContent || welcomeElem.textContent === 'STUDENT' || welcomeElem.textContent === '') {
        setWelcome('Welcome MONDAL, SHOVAN');
    }
}

async function loadStudentSchedule(studentId) {
    const wrapper = document.getElementById('schedule-rows-wrapper');
    const badge = document.getElementById('student-academic-badge');
    if (!wrapper) return;

    let targetStudentId = studentId || localStorage.getItem('selectedTestStudentId') || '26-00001';
    let fetchedClasses = [];
    let className = '';
    let section = '';

    try {
        const response = await fetch(`${getApiHost()}/api/student/schedule/${encodeURIComponent(targetStudentId)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success' && Array.isArray(data.classes)) {
                fetchedClasses = data.classes;
                if (data.class_name) className = data.class_name;
                if (data.section) section = data.section;
            }
        }
    } catch (e) {
        console.log('Using default schedule layout fallback');
    }

    if (badge) {
        const classLabel = className ? `Class: ${className} | Section: ${section} | Session: 2026-2027` : 'Loading academic info...';
        badge.textContent = classLabel;
    }

    // Map JS getDay() index → DB day abbreviation
    const JS_DAY_TO_DB = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Build 7 real calendar dates starting from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dayAbbr = JS_DAY_TO_DB[d.getDay()];
        const label = `${String(d.getDate()).padStart(2,'0')}-${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`;
        sevenDays.push({ date: d, dayAbbr, label, isToday: i === 0 });
    }

    // Build schedule rows using real calendar
    let html = '';

    if (fetchedClasses.length > 0) {
        sevenDays.forEach(({ label, dayAbbr, isToday }) => {
            const dayClasses = fetchedClasses.filter(cls =>
                (Array.isArray(cls.days) ? cls.days : []).includes(dayAbbr)
            );

            const todayBadge = isToday ? '<span class="schedule-today-tag">TODAY</span>' : '';

            if (dayClasses.length === 0) {
                html += `
                    <div class="schedule-date-row schedule-no-class">
                        <div class="schedule-date-label"><i class="fa-regular fa-calendar"></i> ${label}${todayBadge}</div>
                        <div class="schedule-items-grid">
                            <div class="schedule-empty-day">No class scheduled</div>
                        </div>
                    </div>`;
            } else {
                const cards = dayClasses.map(cls => {
                    const sTime = (cls.start_time_formatted || '').replace(/^0/, '') + (cls.start_ampm ? ' ' + cls.start_ampm : '');
                    const eTime = (cls.end_time_formatted || '').replace(/^0/, '') + (cls.end_ampm ? ' ' + cls.end_ampm : '');
                    return `
                        <div class="schedule-card">
                            <div class="schedule-subject">${cls.subject} [${cls.section}]</div>
                            <div class="schedule-meta">
                                <span class="schedule-meta-item"><i class="fa-regular fa-clock"></i> ${sTime} &ndash; ${eTime}</span>
                                <span class="schedule-meta-item"><i class="fa-solid fa-door-open"></i> Room: ${cls.room_number || 'TBA'}</span>
                            </div>
                        </div>`;
                }).join('');

                html += `
                    <div class="schedule-date-row">
                        <div class="schedule-date-label"><i class="fa-regular fa-calendar"></i> ${label}${todayBadge}</div>
                        <div class="schedule-items-grid">${cards}</div>
                    </div>`;
            }
        });
    } else {
        html = `<div class="schedule-loading">No schedule data found for this student.</div>`;
    }

    wrapper.innerHTML = html;
}


// Restore selected student and fetch live PostgreSQL records on DOM load
document.addEventListener('DOMContentLoaded', () => {
    loadLoggedStudentPersonalData();
    loadStudentSchedule();

    const savedStudentId = localStorage.getItem('selectedTestStudentId');
    const selectElem = document.getElementById('studentSelect');
    if (savedStudentId && selectElem) {
        selectElem.value = savedStudentId;
    }
    fetchPostgresStudentUsers();
});
