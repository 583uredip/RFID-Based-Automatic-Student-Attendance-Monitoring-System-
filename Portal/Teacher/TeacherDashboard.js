/**
 * Teacher Dashboard JavaScript Module
 * Handles accordion toggle, demo sidebar actions, teacher data loading, and assigned class schedule rendering
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
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://${window.location.hostname}:3000`;
    }
    return window.location.origin;
}

function toggleNotifications() {
    alert('Notifications: No unread administrative notifications.');
}

function toggleSettingsModal() {
    alert('Settings: Teacher account configuration and portal preferences.');
}

function handleLogout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    window.location.href = '../index.html';
}

function demoSubitemClick(title) {
    alert(`[Demo Module] "${title}" clicked. This section will be activated in the next update.`);
}

/**
 * Loads teacher personal information into the header greeting and stat cards
 */
async function loadLoggedTeacherPersonalData() {
    const welcomeElem = document.getElementById('welcome-username');
    const mobileWelcomeElem = document.getElementById('mobile-welcome-username');
    const statTeacherId = document.getElementById('stat-teacher-id');

    function setWelcome(nameText) {
        if (welcomeElem) welcomeElem.textContent = nameText;
        if (mobileWelcomeElem) mobileWelcomeElem.textContent = nameText;
    }

    let teacherId = 'T-6906';
    let teacherName = 'TEACHER';
    let designation = 'Teacher';
    let department = 'Academic Department';

    const currentUserStr = localStorage.getItem('currentUser');
    if (currentUserStr) {
        try {
            const user = JSON.parse(currentUserStr);
            if (user.user_id) teacherId = user.user_id;
            if (user.last_name && user.first_name) {
                teacherName = `${user.last_name.toUpperCase()}, ${user.first_name.toUpperCase()}`;
                setWelcome(`Welcome ${teacherName}`);
            } else if (user.full_name) {
                teacherName = user.full_name.toUpperCase();
                setWelcome(`Welcome ${teacherName}`);
            }
            if (user.designation) designation = user.designation;
            if (user.department) department = user.department;
        } catch (e) {}
    }

    if (statTeacherId) statTeacherId.textContent = teacherId;

    // Fetch live record from TeacherPersonalData API
    try {
        const response = await fetch(`${getApiHost()}/api/teacher/${encodeURIComponent(teacherId)}`);
        if (response.ok) {
            const teacherData = await response.json();
            if (teacherData) {
                if (teacherData.last_name && teacherData.first_name) {
                    teacherName = `${teacherData.last_name.toUpperCase()}, ${teacherData.first_name.toUpperCase()}`;
                    setWelcome(`Welcome ${teacherName}`);
                } else if (teacherData.full_name) {
                    teacherName = teacherData.full_name.toUpperCase();
                    setWelcome(`Welcome ${teacherName}`);
                }
                if (teacherData.designation) designation = teacherData.designation;
                if (teacherData.department) department = teacherData.department;
            }
        }
    } catch (err) {
        console.log('Teacher PersonalData live API fallback active');
    }

    // Default fallback if welcome still generic
    if (!welcomeElem || !welcomeElem.textContent || welcomeElem.textContent === 'TEACHER' || welcomeElem.textContent === '') {
        setWelcome(`Welcome ${teacherName}`);
    }

    return { teacherId, teacherName, designation, department };
}

/**
 * Loads and renders the assigned classes schedule for the teacher from database
 */
async function loadTeacherSchedule(teacherId) {
    const wrapper = document.getElementById('schedule-rows-wrapper');
    const badge = document.getElementById('teacher-profile-badge');
    const statTotalClasses = document.getElementById('stat-total-classes');
    const statTodayClasses = document.getElementById('stat-today-classes');
    const statClassLevel = document.getElementById('stat-class-level');

    if (!wrapper) return;

    let targetTeacherId = teacherId;
    if (!targetTeacherId) {
        const currentUserStr = localStorage.getItem('currentUser');
        if (currentUserStr) {
            try {
                const u = JSON.parse(currentUserStr);
                if (u.user_id) targetTeacherId = u.user_id;
            } catch (e) {}
        }
    }
    if (!targetTeacherId) targetTeacherId = 'T-6906';

    let fetchedClasses = [];
    let teacherInfo = null;

    // Primary: fetch from teacher schedule API endpoint
    try {
        const response = await fetch(`${getApiHost()}/api/teacher/schedule/${encodeURIComponent(targetTeacherId)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                fetchedClasses = data.classes || [];
                teacherInfo = data.teacher_info || null;
            }
        }
    } catch (e) {
        console.log('Fetching schedule via classes API fallback');
    }

    // Secondary fallback: query /api/classes and /api/classes/assignments directly
    if (fetchedClasses.length === 0) {
        try {
            const [classesRes, assignRes] = await Promise.all([
                fetch(`${getApiHost()}/api/classes`),
                fetch(`${getApiHost()}/api/classes/assignments`)
            ]);

            if (classesRes.ok) {
                const cData = await classesRes.json();
                const allClasses = cData.classes || [];
                let assignments = [];
                if (assignRes.ok) {
                    const aData = await assignRes.json();
                    assignments = aData.assignments || [];
                }

                const assignedClassIds = new Set(
                    assignments
                        .filter(a => String(a.teacher_id).toUpperCase() === String(targetTeacherId).toUpperCase())
                        .map(a => a.class_id)
                );

                const matched = allClasses.filter(c => 
                    String(c.assigned_teacher_id).toUpperCase() === String(targetTeacherId).toUpperCase() ||
                    assignedClassIds.has(c.id)
                );

                if (matched.length > 0) {
                    fetchedClasses = matched.map(cls => {
                        let sTimeFormatted = cls.start_time || '';
                        let eTimeFormatted = cls.end_time || '';
                        let sAmpm = '';
                        let eAmpm = '';

                        if (sTimeFormatted.includes(':')) {
                            const [h, m] = sTimeFormatted.split(':');
                            let hr = parseInt(h);
                            sAmpm = hr >= 12 ? 'PM' : 'AM';
                            let displayHr = hr % 12 || 12;
                            sTimeFormatted = `${displayHr}:${m}`;
                        }
                        if (eTimeFormatted.includes(':')) {
                            const [h, m] = eTimeFormatted.split(':');
                            let hr = parseInt(h);
                            eAmpm = hr >= 12 ? 'PM' : 'AM';
                            let displayHr = hr % 12 || 12;
                            eTimeFormatted = `${displayHr}:${m}`;
                        }

                        return {
                            ...cls,
                            start_time_formatted: sTimeFormatted,
                            end_time_formatted: eTimeFormatted,
                            start_ampm: sAmpm,
                            end_ampm: eAmpm
                        };
                    });
                }
            }
        } catch (err) {
            console.error('Error fetching classes fallback:', err);
        }
    }

    // Update Badge
    if (badge) {
        const dept = (teacherInfo && teacherInfo.department) ? teacherInfo.department : 'General Academic';
        const desig = (teacherInfo && teacherInfo.designation) ? teacherInfo.designation : 'Teacher';
        badge.textContent = `Department: ${dept} | ${desig} | Session: 2026-2027`;
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

    // Update Quick Stats
    const totalClassCount = fetchedClasses.length;
    if (statTotalClasses) statTotalClasses.textContent = `${totalClassCount} ${totalClassCount === 1 ? 'Class' : 'Classes'}`;

    const todayDayAbbr = JS_DAY_TO_DB[today.getDay()];
    const todayClasses = fetchedClasses.filter(cls => (Array.isArray(cls.days) ? cls.days : []).includes(todayDayAbbr));
    if (statTodayClasses) statTodayClasses.textContent = `${todayClasses.length} ${todayClasses.length === 1 ? 'Class' : 'Classes'} Today`;

    // Unique class levels
    const classLevels = Array.from(new Set(fetchedClasses.map(c => c.class_name ? `Class ${c.class_name}` : null).filter(Boolean)));
    if (statClassLevel) {
        statClassLevel.textContent = classLevels.length > 0 ? classLevels.join(', ') : 'Assigned Batches';
    }

    if (fetchedClasses.length === 0) {
        wrapper.innerHTML = `
            <div class="schedule-loading">
                <i class="fa-solid fa-calendar-xmark" style="font-size: 28px; color: #94a3b8; margin-bottom: 8px;"></i>
                <div>No classes currently assigned to this teacher in the database.</div>
                <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Classes can be assigned via Admin Dashboard &rarr; Class Management &rarr; Assign Teacher.</div>
            </div>`;
        return;
    }

    // Build schedule rows using real calendar
    let html = '';

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
                        <div class="schedule-empty-day">No class assigned for this day</div>
                    </div>
                </div>`;
        } else {
            const cards = dayClasses.map(cls => {
                const sTime = (cls.start_time_formatted || '').replace(/^0/, '') + (cls.start_ampm ? ' ' + cls.start_ampm : '');
                const eTime = (cls.end_time_formatted || '').replace(/^0/, '') + (cls.end_ampm ? ' ' + cls.end_ampm : '');
                const classSecText = cls.class_name ? `Class ${cls.class_name} [${cls.section || 'A'}]` : `Section [${cls.section || 'A'}]`;
                const shiftText = cls.shift ? `${cls.shift}` : 'Morning';

                return `
                    <div class="schedule-card">
                        <div class="schedule-class-badge">${classSecText}</div>
                        <div class="schedule-subject">${cls.subject}</div>
                        <div class="schedule-meta">
                            <span class="schedule-meta-item"><i class="fa-regular fa-clock"></i> ${sTime} &ndash; ${eTime}</span>
                            <span class="schedule-meta-item"><i class="fa-solid fa-door-open"></i> Room: ${cls.room_number || '101'}</span>
                            <span class="schedule-meta-item"><i class="fa-solid fa-sun"></i> ${shiftText}</span>
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

    wrapper.innerHTML = html;
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
    const teacherData = await loadLoggedTeacherPersonalData();
    await loadTeacherSchedule(teacherData ? teacherData.teacherId : null);
});
