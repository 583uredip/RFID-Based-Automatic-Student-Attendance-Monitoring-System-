// Server Base API URL
function getApiHost() {
    if (window.location.port === '3000') return window.location.origin;
    const hostname = (window.location.hostname && window.location.hostname !== '') ? window.location.hostname : 'localhost';
    return `http://${hostname}:3000`;
}
const API_BASE_URL = `${getApiHost()}/api/rfid`;
const STUDENT_API_BASE_URL = `${getApiHost()}/api/student`;

function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const allMenus = document.querySelectorAll('.sidebar-menu-content');
    const allBtns = document.querySelectorAll('.sidebar-btn');
    
    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('active');
            m.style.maxHeight = null;
        }
    });

    allBtns.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick') || '';
        if (!onclickAttr.includes(menuId)) {
            btn.classList.remove('active');
        }
    });

    if (menu) {
        const isExpanding = !menu.classList.contains('active');
        menu.classList.toggle('active');
        const btn = document.querySelector(`button[onclick*="${menuId}"]`);
        if (btn) {
            btn.classList.toggle('active');
        }

        if (isExpanding) {
            menu.style.maxHeight = menu.scrollHeight + "px";
        } else {
            menu.style.maxHeight = null;
        }
    }
}

// Toggle mobile sidebar slide drawer & backdrop overlay
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sidebar) {
        sidebar.classList.toggle('mobile-open');
    }
    if (overlay) {
        overlay.classList.toggle('active');
    }
}

// Toggle header menu items (Right options button)
function toggleHeaderNav() {
    const nav = document.getElementById('header-nav-menu');
    if (nav) {
        nav.classList.toggle('mobile-active');
    }
}

// Automatically expand parent menu and highlight active sidebar subitem based on current page/section
function initActiveSidebar(overrideSectionId = null) {
    const currentPath = window.location.pathname.toLowerCase();
    const currentFilename = currentPath.split('/').pop() || 'admindashboard.html';
    const isMainAdminDashboard = currentFilename === 'admindashboard.html' || currentFilename === '' || currentFilename === 'index.html';

    const urlParams = new URLSearchParams(window.location.search);
    const activeSection = overrideSectionId || urlParams.get('section') || localStorage.getItem('kshs_active_section') || 'dashboard-analytics-section';

    const subitems = document.querySelectorAll('.sidebar-subitem');
    let matchedSubitem = null;

    subitems.forEach(item => {
        item.classList.remove('active');
        const href = item.getAttribute('href') || '';
        const onclick = item.getAttribute('onclick') || '';

        if (isMainAdminDashboard) {
            // On AdminDashboard.html, match subitems by activeSection parameter
            if (onclick.includes('showDashboardSection')) {
                const match = onclick.match(/showDashboardSection\(['"]([^'"]+)['"]\)/);
                if (match && match[1] === activeSection) {
                    matchedSubitem = item;
                }
            } else if (href.includes(`section=${activeSection}`)) {
                matchedSubitem = item;
            }
        } else {
            // On standalone sub-pages (e.g. EditStudent.html, LiveAttendance.html, RegisterCard.html)
            if (href && href !== '#' && !href.startsWith('javascript:')) {
                const hrefClean = href.split('?')[0].split('#')[0].toLowerCase();
                const hrefFilename = hrefClean.split('/').pop();

                if (hrefFilename && currentFilename && hrefFilename === currentFilename) {
                    matchedSubitem = item;
                }
            } else if (onclick.includes('showDashboardSection')) {
                const match = onclick.match(/showDashboardSection\(['"]([^'"]+)['"]\)/);
                if (match && match[1] === activeSection) {
                    matchedSubitem = item;
                }
            }
        }
    });

    let activeMenu = null;

    if (matchedSubitem) {
        matchedSubitem.classList.add('active');
        activeMenu = matchedSubitem.closest('.sidebar-menu-content');
    } else {
        activeMenu = document.querySelector('.sidebar-menu-content.active');
    }

    if (activeMenu) {
        // Deactivate other non-matching sidebar menus
        document.querySelectorAll('.sidebar-menu-content').forEach(m => {
            if (m !== activeMenu) {
                m.classList.remove('active');
                m.style.maxHeight = null;
            }
        });
        document.querySelectorAll('.sidebar-btn').forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick') || '';
            if (!onclickAttr.includes(activeMenu.id)) {
                btn.classList.remove('active');
            }
        });

        const prevTransition = activeMenu.style.transition;
        activeMenu.style.transition = 'none';

        activeMenu.classList.add('active');
        activeMenu.style.maxHeight = activeMenu.scrollHeight + 'px';

        const menuId = activeMenu.id;
        const parentBtn = document.querySelector(`button[onclick*="${menuId}"]`);
        if (parentBtn) {
            parentBtn.classList.add('active');
        }

        void activeMenu.offsetHeight;

        setTimeout(() => {
            activeMenu.style.transition = prevTransition;
        }, 50);
    }
}

// Global Variables
let lastScannedUid = null;
let lastScannedTimestamp = null;
let pollInterval = null;
let currentPhotoBase64 = null;

// Initialize Page Features on Document Load
document.addEventListener('DOMContentLoaded', async () => {
    initActiveSidebar();

    if (document.getElementById('cards-table-body')) {
        loadRegisteredCards();
    }
    if (document.getElementById('extended-cards-table-body')) {
        loadExtendedRegisteredCards();
    }
    if (document.getElementById('kpi-present-today') || document.getElementById('kpi-total-students')) {
        loadAnalyticsDashboard();
    }
    // Fetch initial latest scan to record timestamp without auto-filling old scan
    try {
        const response = await fetch(`${API_BASE_URL}/latest-scan`);
        if (response.ok) {
            const initialScan = await response.json();
            if (initialScan && initialScan.uid) {
                lastScannedUid = initialScan.uid;
                lastScannedTimestamp = initialScan.timestamp || null;
            }
        }
    } catch (e) {}

    startLiveScanPolling();
});

// 1. Live Scan Polling (Detect ESP32 RFID Tap Live)
function startLiveScanPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            // Check if any admin page is currently waiting for a scan
            const isWaitingForScan = document.getElementById('rfid-uid-input') || 
                                     document.getElementById('search-query-input') || 
                                     document.getElementById('scan-uid') ||
                                     document.getElementById('search-student-user');
                                     
            const endpoint = isWaitingForScan ? `${API_BASE_URL}/latest-scan?active=true` : `${API_BASE_URL}/latest-scan`;
            const response = await fetch(endpoint);
            if (!response.ok) return;

            const scanData = await response.json();
            
            const isNewScan = scanData && scanData.uid && (
                scanData.timestamp ? scanData.timestamp !== lastScannedTimestamp : scanData.uid !== lastScannedUid
            );

            // Check for RFID Register Page
            const uidInput = document.getElementById('rfid-uid-input');
            const rfidSection = document.getElementById('rfid-section');
            if (rfidSection && rfidSection.style.display !== 'none' && uidInput && isNewScan) {
                lastScannedUid = scanData.uid;
                lastScannedTimestamp = scanData.timestamp || null;
                const statusText = document.getElementById('status-text');
                const statusBadge = document.getElementById('live-scan-status');
                const studentIdInput = document.getElementById('rfid-student-id-input');
                const nameInput = document.getElementById('rfid-student-name-input');

                uidInput.value = scanData.uid;
                if (studentIdInput) studentIdInput.value = scanData.studentId || '26-00001';

                if (scanData.registered) {
                    if (statusText) statusText.innerText = `Registered Card: ${scanData.name} (${scanData.studentId})`;
                    if (statusBadge) statusBadge.className = 'live-status-badge success';
                    if (nameInput) nameInput.value = scanData.name;
                } else {
                    if (statusText) statusText.innerText = `New Card Scanned! UID: ${scanData.uid}`;
                    if (statusBadge) statusBadge.className = 'live-status-badge warning';
                    if (nameInput) {
                        nameInput.value = '';
                        nameInput.focus();
                    }
                }
            }

            // Check for Edit Student Page
            const searchInput = document.getElementById('search-query-input');
            const makeUserSection = document.getElementById('make-student-user-section');
            const makeUserSearchInput = document.getElementById('search-student-user');
            
            if (makeUserSection && makeUserSection.style.display === 'block' && makeUserSearchInput && isNewScan) {
                lastScannedUid = scanData.uid;
                lastScannedTimestamp = scanData.timestamp || null;
                makeUserSearchInput.value = scanData.uid;
                searchStudentForUser();
            } else if (searchInput && isNewScan) {
                lastScannedUid = scanData.uid;
                lastScannedTimestamp = scanData.timestamp || null;
                searchInput.value = scanData.uid;
                fetchStudentData(scanData.uid);
            }
        } catch (err) {
            // Server offline or connecting
        }
    }, 1500);
}

// 2. Handle Registration Form Submit
async function handleRfidRegister(event) {
    event.preventDefault();

    const uid = document.getElementById('rfid-uid-input').value.trim();
    const studentId = document.getElementById('rfid-student-id-input').value.trim();
    const name = document.getElementById('rfid-student-name-input').value.trim();

    if (!uid) {
        alert('Please tap an RFID card first or simulate a card tap!');
        return;
    }

    if (!name) {
        alert('Please enter the Student Name.');
        return;
    }

    const saveBtn = document.getElementById('btn-save-rfid');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, studentId, name })
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success: RFID Card & Student Registered!\nStudent ID: ${data.card.student_id}\nName: ${data.card.name}`);
            
            // Clear form
            document.getElementById('rfid-uid-input').value = '';
            document.getElementById('rfid-student-id-input').value = '';
            document.getElementById('rfid-student-name-input').value = '';
            lastScannedUid = null;

            // Reset badge
            const statusText = document.getElementById('status-text');
            const statusBadge = document.getElementById('live-scan-status');
            if (statusText) statusText.innerText = 'Tap physical RFID card on scanner...';
            if (statusBadge) statusBadge.className = 'live-status-badge';

            loadRegisteredCards();
        } else {
            alert(`Error: ${data.error || 'Failed to register card'}`);
        }
    } catch (err) {
        alert('Network or Server Error. Make sure Node.js server (server.js) is running on port 3000!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Register & Save Card';
    }
}

// 3. Load Registered Cards List from PostgreSQL
async function loadRegisteredCards() {
    const tableBody = document.getElementById('cards-table-body');
    if (!tableBody) return;

    try {
        const response = await fetch(`${API_BASE_URL}/cards`);
        if (!response.ok) throw new Error('Failed to fetch');

        const cards = await response.json();

        if (cards.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">No registered RFID cards found in database "StudentData".</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = cards.map((card, index) => `
            <tr>
                <td>${index + 1}</td>
                <td><code class="uid-tag">${card.uid}</code></td>
                <td><strong class="student-id-tag">${card.student_id}</strong></td>
                <td>${card.name}</td>
                <td>${new Date(card.created_at).toLocaleString()}</td>
                <td>
                    <button class="btn-delete-sm" onclick="deleteCard('${card.uid}')" title="Delete Record">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger">
                    <i class="fa-solid fa-triangle-exclamation"></i> Server Offline or PostgreSQL Database Disconnected. Start <code>node server.js</code> on port 3000.
                </td>
            </tr>
        `;
    }
}

async function loadExtendedRegisteredCards() {
    const tableBody = document.getElementById('extended-cards-table-body');
    if (!tableBody) return;

    try {
        const response = await fetch(`${API_BASE_URL}/cards`);
        if (!response.ok) throw new Error('Failed to fetch');

        const cards = await response.json();

        if (cards.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center">No registered RFID cards found in database "StudentData".</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = cards.map((card, index) => `
            <tr>
                <td>${index + 1}</td>
                <td><code class="uid-tag">${card.uid}</code></td>
                <td><strong class="student-id-tag">${card.student_id}</strong></td>
                <td>${card.name || 'N/A'}</td>
                <td>${card.class_name || 'N/A'}</td>
                <td>${card.roll_number || 'N/A'}</td>
                <td>${card.section || 'N/A'}</td>
                <td>${card.shift || 'N/A'}</td>
                <td>${card.academic_year || 'N/A'}</td>
                <td>
                    <button class="btn-delete-sm" onclick="deleteCard('${card.uid}')" title="Delete Record">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-danger">
                    <i class="fa-solid fa-triangle-exclamation"></i> Server Offline or PostgreSQL Database Disconnected. Start <code>node server.js</code> on port 3000.
                </td>
            </tr>
        `;
    }
}

// 4. Delete Registered Card
async function deleteCard(uid) {
    if (!confirm(`Are you sure you want to delete card registration for UID: ${uid}?`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/cards/${uid}`, { method: 'DELETE' });
        if (response.ok) {
            alert('Card registration deleted successfully.');
            loadRegisteredCards();
        } else {
            alert('Failed to delete card registration.');
        }
    } catch (err) {
        alert('Server error deleting card.');
    }
}

// 5. Test Function: Simulate RFID Card Tap
async function simulateCardTap() {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    const testUid = `${hex()}:${hex()}:${hex()}:${hex()}`;

    try {
        const response = await fetch(`${API_BASE_URL}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: testUid })
        });
        if (response.ok) {
            const data = await response.json();
            const uidInput = document.getElementById('rfid-uid-input');
            const studentIdInput = document.getElementById('rfid-student-id-input');
            const nameInput = document.getElementById('rfid-student-name-input');

            if (uidInput) uidInput.value = data.uid;
            if (studentIdInput) studentIdInput.value = data.studentId;
            if (nameInput) nameInput.focus();

            const statusText = document.getElementById('status-text');
            const statusBadge = document.getElementById('live-scan-status');
            if (statusText) statusText.innerText = `Simulated Tap UID: ${data.uid}`;
            if (statusBadge) statusBadge.className = 'live-status-badge warning';
        }
    } catch (err) {
        alert('Server offline. Start Node.js server first using: node server.js');
    }
}

// =========================================================================
// EDIT STUDENT & PERSONAL DATA FUNCTIONS
// =========================================================================

// 6. Handle Search Form Submit on EditStudent.html
function handleSearchStudentSubmit(event) {
    event.preventDefault();
    const query = document.getElementById('search-query-input').value.trim();
    if (query) {
        fetchStudentData(query);
    }
}

// 7. Fetch Student Card & Personal Data by StudentID or UID
async function fetchStudentData(searchTerm) {
    const editStatusText = document.getElementById('edit-status-text');
    const editStatusBadge = document.getElementById('live-edit-scan-status');
    const personalSection = document.getElementById('personal-data-section');

    if (editStatusText) editStatusText.innerText = `Searching for "${searchTerm}"...`;

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/search?query=${encodeURIComponent(searchTerm)}`);
        const data = await response.json();

        if (response.ok) {
            if (editStatusText) editStatusText.innerText = `Student Found: ${data.card_name} (${data.student_id})`;
            if (editStatusBadge) editStatusBadge.className = 'live-status-badge success';

            // Populate Banner Summary
            if(document.getElementById('summary-student-id')) document.getElementById('summary-student-id').innerText = data.student_id;
            if(document.getElementById('summary-card-uid')) document.getElementById('summary-card-uid').innerText = data.uid;
            if(document.getElementById('summary-card-name')) document.getElementById('summary-card-name').innerText = data.card_name;
            if(document.getElementById('student-id-hidden')) document.getElementById('student-id-hidden').value = data.student_id;

            // Populate Personal Data Form if it exists
            const firstNameInput = document.getElementById('first-name-input');
            if (firstNameInput) {
                firstNameInput.value = data.first_name || '';
                document.getElementById('last-name-input').value = data.last_name || '';
                document.getElementById('gender-select').value = data.gender || '';
                document.getElementById('dob-input').value = data.date_of_birth || '';
                document.getElementById('blood-group-select').value = data.blood_group || '';
                document.getElementById('religion-input').value = data.religion || 'Islam';
                document.getElementById('nationality-input').value = data.nationality || 'Bangladeshi';
                document.getElementById('nid-cert-input').value = data.nid_birth_cert || '';

                // Photo Preview
                const photoImg = document.getElementById('photo-preview-img');
                if (data.photo_url) {
                    photoImg.src = data.photo_url;
                    currentPhotoBase64 = data.photo_url;
                } else {
                    photoImg.src = 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
                    currentPhotoBase64 = null;
                }
            }

            if (personalSection) personalSection.style.display = 'block';

            // Also try to fetch and populate Academic Data (if the section exists)
            const academicSection = document.getElementById('academic-data-section');
            if (academicSection) {
                academicSection.style.display = 'block';
                try {
                    const academicResponse = await fetch(`${STUDENT_API_BASE_URL}/academic-data/${data.student_id}`);
                    if (academicResponse.ok) {
                        const academicData = await academicResponse.json();
                        document.getElementById('admission-number-input').value = academicData.admission_number || '';
                        document.getElementById('admission-date-input').value = academicData.admission_date || '';
                        document.getElementById('class-input').value = academicData.class_name || '';
                        document.getElementById('roll-number-input').value = academicData.roll_number || '';
                        document.getElementById('registration-number-input').value = academicData.registration_number || '';
                        document.getElementById('section-input').value = academicData.section || '';
                        document.getElementById('group-select').value = academicData.student_group || '';
                        document.getElementById('shift-select').value = academicData.shift || '';
                        document.getElementById('session-input').value = academicData.session || '2026-2027';
                        document.getElementById('academic-year-input').value = academicData.academic_year || '';
                    } else {
                        // Clear fields if no data
                        document.getElementById('academic-data-form').reset();
                        // Reset defaults
                        document.getElementById('session-input').value = '2026-2027';
                    }
                } catch (e) {
                    console.error('Error fetching academic data:', e);
                }
            }

            // Also try to fetch and populate Contact Data (if the section exists)
            const contactSection = document.getElementById('contact-data-section');
            if (contactSection) {
                contactSection.style.display = 'block';
                try {
                    const contactResponse = await fetch(`${STUDENT_API_BASE_URL}/contact-data/${data.student_id}`);
                    if (contactResponse.ok) {
                        const contactData = await contactResponse.json();
                        document.getElementById('mobile-number-input').value = contactData.mobile_number || '';
                        document.getElementById('email-address-input').value = contactData.email_address || '';
                        document.getElementById('current-address-input').value = contactData.current_address || '';
                        document.getElementById('permanent-address-input').value = contactData.permanent_address || '';
                        document.getElementById('fathers-name-input').value = contactData.fathers_name || '';
                        document.getElementById('fathers-phone-input').value = contactData.fathers_phone || '';
                        document.getElementById('fathers-occupation-input').value = contactData.fathers_occupation || '';
                        document.getElementById('fathers-email-input').value = contactData.fathers_email || '';
                        document.getElementById('mothers-name-input').value = contactData.mothers_name || '';
                        document.getElementById('mothers-phone-input').value = contactData.mothers_phone || '';
                        document.getElementById('mothers-occupation-input').value = contactData.mothers_occupation || '';
                        document.getElementById('mothers-email-input').value = contactData.mothers_email || '';
                        document.getElementById('guardian-name-input').value = contactData.guardian_name || '';
                        document.getElementById('guardian-relationship-input').value = contactData.guardian_relationship || '';
                        document.getElementById('guardian-phone-input').value = contactData.guardian_phone || '';
                    } else {
                        // Clear fields if no data
                        document.getElementById('contact-data-form').reset();
                    }
                } catch (e) {
                    console.error('Error fetching contact data:', e);
                }
            }

        } else {
            if (editStatusText) editStatusText.innerText = `Not Found: "${searchTerm}"`;
            if (editStatusBadge) editStatusBadge.className = 'live-status-badge warning';
            alert(`Not Found: ${data.error}`);
            if (personalSection) personalSection.style.display = 'none';
            const academicSection = document.getElementById('academic-data-section');
            if (academicSection) academicSection.style.display = 'none';
            const contactSection = document.getElementById('contact-data-section');
            if (contactSection) contactSection.style.display = 'none';
        }
    } catch (err) {
        alert('Server Offline or Database connection error.');
    }
}

// 8. Photo Upload Preview Helper (Converts to Base64)
function previewPhoto(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 2 * 1024 * 1024) {
            alert('File size exceeds 2MB limit. Please choose a smaller image.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('photo-preview-img').src = e.target.result;
            currentPhotoBase64 = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

// 9. Save Personal Data to PostgreSQL PersonalData Table
async function handleSavePersonalData(event) {
    event.preventDefault();

    const studentId = document.getElementById('student-id-hidden').value;
    const firstName = document.getElementById('first-name-input').value.trim();
    const lastName = document.getElementById('last-name-input').value.trim();
    const gender = document.getElementById('gender-select').value;
    const dateOfBirth = document.getElementById('dob-input').value;
    const bloodGroup = document.getElementById('blood-group-select').value;
    const religion = document.getElementById('religion-input').value;
    const nationality = document.getElementById('nationality-input').value.trim();
    const nidBirthCert = document.getElementById('nid-cert-input').value.trim();

    if (!studentId) {
        alert('No student selected. Please search a student first!');
        return;
    }

    const saveBtn = document.getElementById('btn-save-personal');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving to PostgreSQL...';

    const payload = {
        student_id: studentId,
        first_name: firstName,
        last_name: lastName,
        gender: gender,
        date_of_birth: dateOfBirth,
        blood_group: bloodGroup,
        religion: religion,
        nationality: nationality,
        nid_birth_cert: nidBirthCert,
        photo_url: currentPhotoBase64
    };

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/personal-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success: Personal Information saved for Student ID: ${studentId}!`);
        } else {
            alert(`Error: ${data.error || 'Failed to save personal data'}`);
        }
    } catch (err) {
        alert('Server connection error. Make sure node server.js is running!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Personal Data (PostgreSQL)';
    }
}

// 10. Save Academic Data to PostgreSQL StudentAcademicInformation Table
async function handleSaveAcademicData(event) {
    event.preventDefault();

    const studentId = document.getElementById('student-id-hidden').value;
    if (!studentId) {
        alert('No student selected. Please search a student first!');
        return;
    }

    const saveBtn = document.getElementById('btn-save-academic');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    const payload = {
        student_id: studentId,
        admission_number: document.getElementById('admission-number-input').value,
        admission_date: document.getElementById('admission-date-input').value,
        class: document.getElementById('class-input').value,
        roll_number: document.getElementById('roll-number-input').value,
        registration_number: document.getElementById('registration-number-input').value,
        section: document.getElementById('section-input').value,
        group_name: document.getElementById('group-select').value,
        shift: document.getElementById('shift-select').value,
        session: document.getElementById('session-input').value,
        academic_year: document.getElementById('academic-year-input').value
    };

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/academic-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success: Academic Information saved for Student ID: ${studentId}!`);
        } else {
            alert(`Error: ${data.error || 'Failed to save academic data'}`);
        }
    } catch (err) {
        alert('Server connection error. Make sure node server.js is running!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Academic Data';
    }
}

// 11. Save Contact Data to PostgreSQL StudentContactInformation Table
async function handleSaveContactData(event) {
    event.preventDefault();

    const studentId = document.getElementById('student-id-hidden').value;
    if (!studentId) {
        alert('No student selected. Please search a student first!');
        return;
    }

    const saveBtn = document.getElementById('btn-save-contact');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    const payload = {
        student_id: studentId,
        mobile_number: document.getElementById('mobile-number-input').value,
        email_address: document.getElementById('email-address-input').value,
        current_address: document.getElementById('current-address-input').value,
        permanent_address: document.getElementById('permanent-address-input').value,
        fathers_name: document.getElementById('fathers-name-input').value,
        fathers_phone: document.getElementById('fathers-phone-input').value,
        fathers_occupation: document.getElementById('fathers-occupation-input').value,
        fathers_email: document.getElementById('fathers-email-input').value,
        mothers_name: document.getElementById('mothers-name-input').value,
        mothers_phone: document.getElementById('mothers-phone-input').value,
        mothers_occupation: document.getElementById('mothers-occupation-input').value,
        mothers_email: document.getElementById('mothers-email-input').value,
        guardian_name: document.getElementById('guardian-name-input').value,
        guardian_relationship: document.getElementById('guardian-relationship-input').value,
        guardian_phone: document.getElementById('guardian-phone-input').value
    };

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/contact-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success: Contact Information saved for Student ID: ${studentId}!`);
        } else {
            alert(`Error: ${data.error || 'Failed to save contact data'}`);
        }
    } catch (err) {
        alert('Server connection error. Make sure node server.js is running!');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Contact Data';
    }
}

// 12. Delete Student by Identifier
async function handleDeleteStudent() {
    const studentId = document.getElementById('student-id-hidden').value;
    if (!studentId) {
        alert('No student selected. Please search a student first!');
        return;
    }

    const confirmDelete = confirm(`WARNING: This will permanently delete Student ID ${studentId} and all their personal, academic, and contact data. Are you absolutely sure?`);
    if (!confirmDelete) return;

    const deleteBtn = document.getElementById('btn-delete-student');
    if(deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
    }

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/${studentId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success: Student ID ${studentId} deleted permanently.`);
            // Hide the data section after deletion
            const personalSection = document.getElementById('personal-data-section');
            if (personalSection) personalSection.style.display = 'none';
            // Clear search input
            document.getElementById('search-query-input').value = '';
            // Update status text
            const editStatusText = document.getElementById('edit-status-text');
            const editStatusBadge = document.getElementById('live-edit-scan-status');
            if (editStatusText) editStatusText.innerText = `Deleted Student ID: ${studentId}`;
            if (editStatusBadge) editStatusBadge.className = 'live-status-badge success';
        } else {
            alert(`Error: ${data.error || 'Failed to delete student'}`);
            if(deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete Student Permanently';
            }
        }
    } catch (err) {
        alert('Server connection error. Make sure node server.js is running!');
        if(deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete Student Permanently';
        }
    }
}

// 13. Fetch All Students (For View All Students Page)
async function fetchAllStudents() {
    const tableBody = document.getElementById('students-table-body');
    const countBadge = document.getElementById('students-count-badge');
    if (!tableBody) return; // Only run on ViewAllStudents.html

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/all`);
        const data = await response.json();

        if (response.ok) {
            tableBody.innerHTML = ''; // Clear loading spinner
            
            if (data.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #64748b;">No students found in the database.</td></tr>`;
                if(countBadge) countBadge.innerHTML = '<span>0 Students</span>';
                return;
            }

            if(countBadge) countBadge.innerHTML = `<span>${data.length} Student(s)</span>`;

            data.forEach(student => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #e2e8f0';
                
                // Construct full name
                const fullName = (student.first_name || student.last_name) ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : student.card_name;
                const classRoll = student.class_name ? `${student.class_name} (Roll: ${student.roll_number || 'N/A'})` : '<span style="color: #94a3b8; font-style: italic;">Not Assigned</span>';
                const mobile = student.mobile_number || '<span style="color: #94a3b8; font-style: italic;">No Mobile</span>';

                tr.innerHTML = `
                    <td style="padding: 12px 15px; color: #334155; font-weight: 500;">${student.student_id}</td>
                    <td style="padding: 12px 15px; color: #334155;">${fullName}</td>
                    <td style="padding: 12px 15px; color: #64748b; font-family: monospace;">${student.uid}</td>
                    <td style="padding: 12px 15px; color: #334155;">${classRoll}</td>
                    <td style="padding: 12px 15px; color: #334155;">${mobile}</td>
                    <td style="padding: 12px 15px;">
                        <button onclick="window.location.href='EditStudent.html?id=${student.student_id}'" class="btn-primary-blue" style="padding: 6px 12px; font-size: 12px;">
                            <i class="fa-solid fa-pen"></i> Edit
                        </button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #ef4444;">Error loading students: ${data.error}</td></tr>`;
            if(countBadge) countBadge.innerHTML = '<span style="color: red;">Error</span>';
        }
    } catch (err) {
        console.error('Error:', err);
        tableBody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #ef4444;">Server connection error. Make sure node server.js is running!</td></tr>`;
        if(countBadge) countBadge.innerHTML = '<span style="color: red;">Offline</span>';
    }
}

// Auto-initialize depending on page elements
document.addEventListener('DOMContentLoaded', () => {
    // If we're on the View All Students page, fetch the list
    if (document.getElementById('students-table-body')) {
        fetchAllStudents();
    }

    // Auto-search if ?id= query param is present
    const urlParams = new URLSearchParams(window.location.search);
    const studentIdParam = urlParams.get('id');
    const searchInput = document.getElementById('search-query-input');
    
    if (studentIdParam && searchInput) {
        searchInput.value = studentIdParam;
        fetchStudentData(studentIdParam);
    }
});

// 14. Export Students as CSV
async function handleExportStudents() {
    const btn = document.getElementById('btn-export');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating CSV...';
    btn.disabled = true;

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/export/all`);
        const data = await response.json();

        if (response.ok) {
            if (data.length === 0) {
                alert('No students found to export.');
            } else {
                // Convert JSON to CSV using PapaParse
                const csv = Papa.unparse(data);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `Students_Export_${new Date().toISOString().split('T')[0]}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } else {
            alert(`Error: ${data.error || 'Failed to export students'}`);
        }
    } catch (err) {
        alert('Server connection error. Make sure node server.js is running!');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// 15. Preview Uploaded CSV
let parsedCSVData = [];

function previewCSV() {
    const fileInput = document.getElementById('csv-file-input');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select a CSV file first.');
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            parsedCSVData = results.data;
            const previewSection = document.getElementById('import-preview-section');
            const previewHead = document.getElementById('preview-table-head');
            const previewBody = document.getElementById('preview-table-body');
            const btnImport = document.getElementById('btn-import');

            document.getElementById('preview-count').innerText = parsedCSVData.length;
            
            // Generate Header
            previewHead.innerHTML = '';
            if (results.meta.fields && results.meta.fields.length > 0) {
                results.meta.fields.forEach(field => {
                    const th = document.createElement('th');
                    th.style.padding = '8px 10px';
                    th.innerText = field;
                    previewHead.appendChild(th);
                });
            }

            // Generate Body (Preview first 100 rows max)
            previewBody.innerHTML = '';
            const previewRows = parsedCSVData.slice(0, 100);
            previewRows.forEach(row => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #e2e8f0';
                results.meta.fields.forEach(field => {
                    const td = document.createElement('td');
                    td.style.padding = '8px 10px';
                    td.innerText = row[field] || '';
                    tr.appendChild(td);
                });
                previewBody.appendChild(tr);
            });

            previewSection.style.display = 'block';
            btnImport.style.display = 'inline-block';
        },
        error: function(error) {
            alert('Error parsing CSV: ' + error.message);
        }
    });
}

// 16. Upload and Sync CSV Data
async function handleImportStudents() {
    if (parsedCSVData.length === 0) {
        alert('No valid data to import. Please preview the CSV first.');
        return;
    }

    const btn = document.getElementById('btn-import');
    const statusDiv = document.getElementById('import-status');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
    btn.disabled = true;
    statusDiv.style.color = '#3b82f6';
    statusDiv.innerText = `Sending ${parsedCSVData.length} records to server...`;

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/import/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsedCSVData)
        });

        const result = await response.json();

        if (response.ok) {
            statusDiv.style.color = '#10b981';
            statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> Success: Imported/Updated ${result.importedCount} records.`;
            if (result.errors && result.errors.length > 0) {
                statusDiv.innerHTML += `<br><span style="color: #ef4444;">But encountered ${result.errors.length} errors (check console).</span>`;
                console.warn('Import Errors:', result.errors);
            }
        } else {
            statusDiv.style.color = '#ef4444';
            statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Import Failed: ${result.error}`;
            if (result.details) {
                console.error('Import Details:', result.details);
            }
        }
    } catch (err) {
        statusDiv.style.color = '#ef4444';
        statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Server connection error.`;
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}




// --- Auto-highlight active sidebar item ---
document.addEventListener('DOMContentLoaded', () => {
    const allLinks = document.querySelectorAll('.sidebar-subitem');
    let foundActive = false;
    allLinks.forEach(link => {
        // Extract pathname, avoiding query string differences
        const linkUrl = new URL(link.href, window.location.origin);
        const currentUrl = new URL(window.location.href, window.location.origin);
        
        if (!foundActive && linkUrl.pathname === currentUrl.pathname) {
            link.classList.add('active');
            // We intentionally do NOT expand the parent menu here so that 
            // all menus remain unexpanded by default on page load.
            foundActive = true;
        } else {
            link.classList.remove('active');
        }
    });
});

// ==========================================
// Replace RFID Card Logic
// ==========================================

async function searchStudentForReplace() {
    const studentIdInput = document.getElementById('replace-student-id-search');
    if (!studentIdInput || !studentIdInput.value.trim()) {
        alert('Please enter a Student ID to search.');
        return;
    }

    const searchTerm = studentIdInput.value.trim();

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/search?query=${encodeURIComponent(searchTerm)}`);
        if (!response.ok) {
            throw new Error('Student not found or server error.');
        }

        const data = await response.json();
        if (data && data.student_id) {
            const student = data;
            
            // Populate fields
            const nameInput = document.getElementById('replace-student-name-input');
            const oldUidInput = document.getElementById('replace-old-uid-input');
            
            if (nameInput) nameInput.value = student.first_name ? `${student.first_name} ${student.last_name || ''}`.trim() : (student.card_name || 'N/A');
            if (oldUidInput) oldUidInput.value = student.uid || 'No Card Found';

            // Enable replace button if we have a student
            const btnReplace = document.getElementById('btn-replace-rfid');
            if (btnReplace) {
                btnReplace.disabled = false;
                btnReplace.style.opacity = '1';
                btnReplace.style.cursor = 'pointer';
            }
            alert('Student found. Tap new card to replace.');
        } else {
            alert('No student found with that ID.');
        }
    } catch (err) {
        console.error('Search error:', err);
        alert('Error searching for student.');
    }
}

async function handleRfidReplace(event) {
    event.preventDefault();
    
    const studentId = document.getElementById('replace-student-id-search').value.trim();
    const newUid = document.getElementById('rfid-uid-input').value.trim();
    const oldUid = document.getElementById('replace-old-uid-input').value.trim();
    const studentName = document.getElementById('replace-student-name-input').value.trim();

    if (!studentId || !newUid) {
        alert('Missing information. Ensure student is searched and new card is scanned.');
        return;
    }

    if (newUid === oldUid) {
        alert('The new card UID cannot be the same as the old card UID.');
        return;
    }

    const confirmReplace = confirm(`Are you sure you want to assign the new card (${newUid}) to ${studentName || studentId}?`);
    if (!confirmReplace) return;

    try {
        const btn = document.getElementById('btn-replace-rfid');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Replacing...';
        btn.disabled = true;
        
        const response = await fetch(`${API_BASE_URL}/replace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                oldUid: oldUid,
                newUid: newUid, 
                studentId: studentId,
                name: studentName 
            })
        });

        if (response.ok) {
            alert('Card successfully replaced!');
            document.getElementById('rfid-replace-form').reset();
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            if (typeof loadRegisteredCards === 'function') loadRegisteredCards();
        } else {
            const errData = await response.json();
            alert(`Error: ${errData.error || 'Failed to replace card.'}`);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Replace error:', err);
        alert('Server error while replacing card.');
        const btn = document.getElementById('btn-replace-rfid');
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Replace Card';
        btn.disabled = false;
    }
}

// -------------------------------------------------------------------------
// ADD TEACHER MODULE LOGIC
// -------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    let currentPhotoBase64 = null;

    // Photo Upload Handling
    const photoInput = document.getElementById('teacher-photo');
    const photoPreview = document.getElementById('photo-preview');

    if (photoInput && photoPreview) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Check file size (max 2MB)
            if (file.size > 2 * 1024 * 1024) {
                alert('File size exceeds 2MB limit.');
                photoInput.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                currentPhotoBase64 = event.target.result;
                photoPreview.innerHTML = `<img src="${currentPhotoBase64}" alt="Teacher Photo">`;
            };
            reader.readAsDataURL(file);
        });
    }

    // Handle Form Submission
    const form = document.getElementById('add-teacher-form');
    
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = document.getElementById('submit-btn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            const payload = {
                teacher_id: document.getElementById('teacher-id').value.trim(),
                first_name: document.getElementById('first-name').value.trim(),
                last_name: document.getElementById('last-name').value.trim(),
                gender: document.getElementById('gender').value,
                date_of_birth: document.getElementById('dob').value,
                blood_group: document.getElementById('blood-group').value,
                religion: document.getElementById('religion').value,
                nationality: document.getElementById('nationality').value.trim(),
                nid_number: document.getElementById('nid').value.trim(),
                mobile_number: document.getElementById('mobile-number').value.trim(),
                email_address: document.getElementById('email-address').value.trim(),
                current_address: document.getElementById('current-address').value.trim(),
                permanent_address: document.getElementById('permanent-address').value.trim(),
                emergency_contact: document.getElementById('emergency-contact').value.trim(),
                department: document.getElementById('department').value.trim(),
                designation: document.getElementById('designation').value.trim(),
                joining_date: document.getElementById('joining-date').value,
                employment_type: document.getElementById('employment-type').value,
                qualification: document.getElementById('qualification').value.trim(),
                years_of_experience: document.getElementById('years-of-experience').value,
                specialization: document.getElementById('specialization').value.trim(),
                photo_url: currentPhotoBase64
            };

            try {
                const response = await fetch(`${CM_API_BASE}/teacher/personal-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok) {
                    alert('Success: Teacher Personal Data saved successfully!');
                    resetTeacherForm();
                } else {
                    alert('Error: ' + (data.error || 'Failed to save teacher data'));
                }
            } catch (err) {
                console.error('Submission Error:', err);
                alert('Server connection error. Make sure the Node.js backend is running!');
            } finally {
                submitBtn.disabled = false;
                const isEditing = document.getElementById('teacher-id')?.readOnly;
                submitBtn.innerHTML = isEditing
                    ? '<i class="fa-solid fa-floppy-disk"></i> Update Teacher Data'
                    : '<i class="fa-solid fa-save"></i> Save Teacher Data';
            }
        });

        document.querySelectorAll('.header-brand-link').forEach(link => {
            link.addEventListener('click', goToAnalyticsDashboard);
        });

        // Restore active section and tab across page refreshes (only on main AdminDashboard.html)
        const isMainAdminDashboard = window.location.pathname.endsWith('AdminDashboard.html') || window.location.pathname.endsWith('/') || !window.location.pathname.includes('.html');
        
        if (isMainAdminDashboard) {
            const urlParams = new URLSearchParams(window.location.search);
            const sectionFromUrl = urlParams.get('section');
            const isEditFromUrl  = urlParams.get('mode') === 'edit';
            const tabFromUrl     = urlParams.get('tab');

            const savedSection   = localStorage.getItem('kshs_active_section');
            const savedEditMode  = localStorage.getItem('kshs_active_edit_mode') === 'true';
            const savedCmTab     = localStorage.getItem('kshs_active_cm_tab');

            const targetSection  = sectionFromUrl || savedSection || 'dashboard-analytics-section';
            const targetEditMode = sectionFromUrl ? isEditFromUrl : savedEditMode;
            const targetCmTab    = tabFromUrl || savedCmTab || 'add-class';

            showDashboardSection(targetSection, targetEditMode);
            if (targetSection === 'class-management-section' && targetCmTab) {
                switchClassTab(targetCmTab);
            }
        }

        // Auto-trigger RFID page load if on standalone RFID pages
        if (document.getElementById('cards-table-body')) loadRegisteredCards();
        if (document.getElementById('extended-cards-table-body')) loadExtendedCards();
        if (document.getElementById('rfid-student-id-input')) generateStudentIdForRfid();
    }
});

function goToAnalyticsDashboard(event) {
    if (event) event.preventDefault();
    try {
        localStorage.setItem('kshs_active_section', 'dashboard-analytics-section');
        localStorage.setItem('kshs_active_edit_mode', 'false');
    } catch (e) {
        console.warn(e);
    }

    const isSubfolder = !window.location.pathname.endsWith('AdminDashboard.html') && window.location.pathname.includes('.html');
    const targetUrl = (isSubfolder ? '../' : '') + 'AdminDashboard.html?section=dashboard-analytics-section';

    if (window.location.pathname.endsWith('AdminDashboard.html')) {
        showDashboardSection('dashboard-analytics-section', false);
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', 'AdminDashboard.html?section=dashboard-analytics-section');
        }
        window.location.reload();
    } else {
        window.location.href = targetUrl;
    }
}

let _allTeachersCache = [];

async function populateTeacherSelectDropdown(selectedTeacherId = '') {
    const select = document.getElementById('select-teacher-to-edit');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Loading teachers...</option>';
    try {
        const res = await fetch(`${CM_API_BASE}/teacher/all`);
        if (!res.ok) throw new Error('Server error');
        _allTeachersCache = await res.json();

        if (_allTeachersCache.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No teachers found</option>';
            return;
        }

        select.innerHTML = '<option value="" disabled ' + (selectedTeacherId ? '' : 'selected') + '>Select a teacher to edit...</option>' +
            _allTeachersCache.map(t => `<option value="${t.teacher_id}" ${t.teacher_id === selectedTeacherId ? 'selected' : ''}>${t.full_name || t.teacher_id} (${t.teacher_id} — ${t.designation || 'Teacher'})</option>`).join('');
    } catch {
        select.innerHTML = '<option value="" disabled selected>Error loading teachers</option>';
    }
}

async function enableTeacherEditMode() {
    const box = document.getElementById('edit-teacher-selector-box');
    if (box) box.style.display = 'block';

    const formTitle = document.getElementById('teacher-form-title');
    if (formTitle) formTitle.innerHTML = '<i class="fa-solid fa-user-pen"></i> <span>Edit Teacher Data</span>';

    const cancelBtn = document.getElementById('btn-cancel-edit-teacher');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    const delBtn = document.getElementById('btn-delete-current-teacher');
    if (delBtn) delBtn.style.display = 'inline-flex';

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Teacher Data';

    await populateTeacherSelectDropdown();
}

async function editTeacher(teacherId) {
    if (!teacherId) return;

    showDashboardSection('add-teacher-section', true);

    try {
        let teacher = null;
        try {
            const res = await fetch(`${CM_API_BASE}/teacher/${teacherId}`);
            if (res.ok) teacher = await res.json();
        } catch (e) {
            console.warn('Individual teacher fetch failed, using cache:', e);
        }

        if (!teacher) {
            teacher = _allTeachersCache.find(t => t.teacher_id === teacherId);
        }

        if (!teacher) {
            alert('Could not find teacher data.');
            return;
        }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            let v = val != null ? String(val).trim() : '';
            if (el.type === 'date' && v.includes('T')) {
                v = v.split('T')[0];
            }
            if (el.tagName === 'SELECT') {
                el.value = v;
                if (!el.value && v) {
                    const opt = [...el.options].find(o => o.value.toLowerCase() === v.toLowerCase());
                    if (opt) el.value = opt.value;
                }
            } else {
                el.value = v;
            }
        };

        setVal('teacher-id', teacher.teacher_id);
        const tIdInput = document.getElementById('teacher-id');
        if (tIdInput) tIdInput.readOnly = true;

        setVal('first-name', teacher.first_name || (teacher.full_name ? teacher.full_name.split(' ')[0] : ''));
        setVal('last-name', teacher.last_name || (teacher.full_name ? teacher.full_name.split(' ').slice(1).join(' ') : ''));
        setVal('gender', teacher.gender);
        setVal('dob', teacher.date_of_birth);
        setVal('blood-group', teacher.blood_group);
        setVal('religion', teacher.religion);
        setVal('nationality', teacher.nationality || 'Bangladeshi');
        setVal('nid', teacher.nid_number);
        setVal('mobile-number', teacher.mobile_number);
        setVal('email-address', teacher.email_address);
        setVal('current-address', teacher.current_address);
        setVal('permanent-address', teacher.permanent_address);
        setVal('emergency-contact', teacher.emergency_contact);
        setVal('department', teacher.department);
        setVal('designation', teacher.designation);
        setVal('joining-date', teacher.joining_date);
        setVal('employment-type', teacher.employment_type);
        setVal('qualification', teacher.qualification);
        setVal('years-of-experience', teacher.years_of_experience);
        setVal('specialization', teacher.specialization);

        if (teacher.photo_url) {
            currentPhotoBase64 = teacher.photo_url;
            const preview = document.getElementById('photo-preview');
            if (preview) preview.innerHTML = `<img src="${teacher.photo_url}" alt="Teacher Photo">`;
        }

        await populateTeacherSelectDropdown(teacherId);
    } catch (err) {
        console.error('Error editing teacher:', err);
    }
}

function resetTeacherForm() {
    const form = document.getElementById('add-teacher-form');
    if (form) form.reset();

    const tId = document.getElementById('teacher-id');
    if (tId) {
        tId.readOnly = false;
        tId.value = '';
    }

    const preview = document.getElementById('photo-preview');
    if (preview) preview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Teacher Photo</span>';
    currentPhotoBase64 = null;

    const box = document.getElementById('edit-teacher-selector-box');
    if (box) box.style.display = 'none';

    const formTitle = document.getElementById('teacher-form-title');
    if (formTitle) formTitle.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span>Add New Teacher</span>';

    const cancelBtn = document.getElementById('btn-cancel-edit-teacher');
    if (cancelBtn) cancelBtn.style.display = 'none';

    const delBtn = document.getElementById('btn-delete-current-teacher');
    if (delBtn) delBtn.style.display = 'none';

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Teacher Data';

    generateTeacherId();
}

function filterTeacherDirectory() {
    const query = (document.getElementById('search-teacher-input')?.value || '').trim().toLowerCase();
    const teacherCards = document.querySelectorAll('#admin-teacher-grid .col-md-4');

    teacherCards.forEach(col => {
        const text = col.innerText.toLowerCase();
        if (!query || text.includes(query)) {
            col.style.display = 'block';
        } else {
            col.style.display = 'none';
        }
    });
}

async function searchAndEditTeacherById() {
    const idInput = document.getElementById('search-teacher-by-id-input');
    const queryId = (idInput?.value || '').trim();
    if (!queryId) {
        alert('Please enter a Teacher ID (e.g. T-1001).');
        return;
    }

    let found = _allTeachersCache.find(t => (t.teacher_id || '').toLowerCase() === queryId.toLowerCase());
    if (!found) {
        try {
            const res = await fetch(`${CM_API_BASE}/teacher/${queryId}`);
            if (res.ok) found = await res.json();
        } catch (err) {
            console.error(err);
        }
    }

    if (found) {
        await editTeacher(found.teacher_id);
    } else {
        alert(`Teacher with ID "${queryId}" was not found.`);
    }
}

async function deleteTeacher(teacherId, teacherName = '') {
    if (!teacherId) return;

    const displayName = teacherName ? `"${teacherName}" (${teacherId})` : `teacher "${teacherId}"`;
    const confirmMsg = `Are you sure you want to delete ${displayName}?\n\n` +
        `This action will permanently delete:\n` +
        `• Teacher Personal Data (from TeacherPersonalData)\n` +
        `• Teacher User Account (from Users table)\n` +
        `• Class Assignments (from class_assignments & classes tables)`;

    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch(`${CM_API_BASE}/teacher/${teacherId}`, { method: 'DELETE' });
        const data = await res.json();

        if (res.ok) {
            alert('Success: ' + (data.message || 'Teacher deleted successfully.'));
            resetTeacherForm();
            await loadTeacherList();
            await cmFetchClasses();
            await cmFetchAssignments();
            if (typeof loadClassList === 'function') loadClassList();
            if (typeof loadClassSelectForAssign === 'function') loadClassSelectForAssign();
            if (typeof loadAssignmentsTable === 'function') loadAssignmentsTable();
        } else {
            alert('Error: ' + (data.error || 'Failed to delete teacher.'));
        }
    } catch (err) {
        console.error('Delete teacher error:', err);
        alert('Server error while deleting teacher.');
    }
}

function deleteCurrentTeacher() {
    const teacherId = document.getElementById('teacher-id')?.value;
    const firstName = document.getElementById('first-name')?.value || '';
    const lastName  = document.getElementById('last-name')?.value || '';
    const fullName  = `${firstName} ${lastName}`.trim();
    if (teacherId) {
        deleteTeacher(teacherId, fullName);
    }
}

function showDashboardSection(sectionId, isEditMode = false) {
    const isMainAdminDashboard = window.location.pathname.endsWith('AdminDashboard.html') || window.location.pathname.endsWith('/') || !window.location.pathname.includes('.html');
    const target = document.getElementById(sectionId);

    // On standalone sub-pages (e.g. RegisterCard.html), if the requested section does not exist on this page, redirect to AdminDashboard.html
    if (!target) {
        if (!isMainAdminDashboard) {
            window.location.href = `../AdminDashboard.html?section=${sectionId}${isEditMode ? '&mode=edit' : ''}`;
        }
        return;
    }

    const dashboardAnalyticsSection = document.getElementById('dashboard-analytics-section');
    const rfidSection = document.getElementById('rfid-section');
    const rfidReplaceSection = document.getElementById('rfid-replace-section');
    const rfidViewSection = document.getElementById('rfid-view-section');
    const teacherSection = document.getElementById('add-teacher-section');
    const makeStudentUserSection = document.getElementById('make-student-user-section');
    const teacherListSection = document.getElementById('teacher-list-section');
    const classManagementSection = document.getElementById('class-management-section');
    const recentActivitiesSection = document.getElementById('recent-activities-section');
    
    if (dashboardAnalyticsSection) dashboardAnalyticsSection.style.display = 'none';
    if (rfidSection) rfidSection.style.display = 'none';
    if (rfidReplaceSection) rfidReplaceSection.style.display = 'none';
    if (rfidViewSection) rfidViewSection.style.display = 'none';
    if (teacherSection) teacherSection.style.display = 'none';
    if (makeStudentUserSection) makeStudentUserSection.style.display = 'none';
    if (teacherListSection) teacherListSection.style.display = 'none';
    if (classManagementSection) classManagementSection.style.display = 'none';
    if (recentActivitiesSection) recentActivitiesSection.style.display = 'none';

    target.style.display = 'block';

    // Persist active section state to localStorage and URL params FIRST
    try {
        localStorage.setItem('kshs_active_section', sectionId);
        localStorage.setItem('kshs_active_edit_mode', isEditMode ? 'true' : 'false');

        if (window.history && window.history.replaceState) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('section', sectionId);
            if (isEditMode) {
                currentUrl.searchParams.set('mode', 'edit');
            } else {
                currentUrl.searchParams.delete('mode');
            }
            window.history.replaceState(null, '', currentUrl.toString());
        }
    } catch (e) {
        console.warn('Could not persist section state:', e);
    }

    // Update sidebar active highlights for the target sectionId
    if (typeof initActiveSidebar === 'function') {
        initActiveSidebar(sectionId);
    }

    if (sectionId === 'dashboard-analytics-section') {
        loadAnalyticsDashboard();
    }

        if (sectionId === 'rfid-section') {
            generateStudentIdForRfid();
            loadRegisteredCards();
        } else if (sectionId === 'rfid-replace-section') {
            loadRegisteredCards();
        } else if (sectionId === 'rfid-view-section') {
            loadExtendedCards();
        } else if (sectionId === 'add-teacher-section') {
            if (isEditMode) {
                enableTeacherEditMode();
            } else {
                resetTeacherForm();
            }
        } else if (sectionId === 'teacher-list-section') {
            loadTeacherList();
        } else if (sectionId === 'class-management-section') {
            const savedCmTab = localStorage.getItem('kshs_active_cm_tab') || 'add-class';
            switchClassTab(savedCmTab);
            loadTeachersForAssign();
        } else if (sectionId === 'recent-activities-section') {
            loadRecentActivities();
        }
}

// =========================================================================
// RECENT ACTIVITIES FEED
// =========================================================================

let _raAllActivities = [];

async function loadRecentActivities() {
    const loading  = document.getElementById('ra-loading');
    const empty    = document.getElementById('ra-empty');
    const timeline = document.getElementById('ra-timeline');
    if (!loading || !timeline) return;

    loading.style.display  = 'block';
    empty.style.display    = 'none';
    timeline.style.display = 'none';

    try {
        const res = await fetch(`${getApiHost()}/api/recent-activities`);
        if (!res.ok) throw new Error('Server error');
        _raAllActivities = await res.json();

        // Reset filter to 'all'
        document.querySelectorAll('.ra-filter-btn').forEach(b => b.classList.remove('ra-active'));
        const allBtn = document.querySelector('.ra-filter-btn[data-type="all"]');
        if (allBtn) allBtn.classList.add('ra-active');

        renderActivityTimeline(_raAllActivities);
    } catch (err) {
        loading.style.display = 'none';
        empty.style.display   = 'block';
        empty.querySelector('p').textContent = 'Could not load activities. Is the server running?';
    }
}

function filterActivities(type, btn) {
    // Update active button
    document.querySelectorAll('.ra-filter-btn').forEach(b => b.classList.remove('ra-active'));
    if (btn) btn.classList.add('ra-active');

    const filtered = type === 'all'
        ? _raAllActivities
        : _raAllActivities.filter(a => a.type === type);

    renderActivityTimeline(filtered);
}

function renderActivityTimeline(items) {
    const loading  = document.getElementById('ra-loading');
    const empty    = document.getElementById('ra-empty');
    const timeline = document.getElementById('ra-timeline');
    if (!timeline) return;

    loading.style.display = 'none';

    if (!items || items.length === 0) {
        timeline.style.display = 'none';
        empty.style.display    = 'block';
        return;
    }

    empty.style.display    = 'none';
    timeline.style.display = 'block';

    // Badge labels
    const typeLabels = {
        student_added:    { text: 'Student Added',  emoji: '🎓' },
        teacher_added:    { text: 'Teacher Added',  emoji: '👨‍🏫' },
        rfid_registered:  { text: 'RFID Card',      emoji: '🪪' },
        class_created:    { text: 'Class Created',  emoji: '🏫' },
        teacher_assigned: { text: 'Assignment',     emoji: '📌' }
    };

    timeline.innerHTML = items.map(item => {
        const meta   = typeLabels[item.type] || { text: item.type, emoji: '📋' };
        const timeStr = formatActivityTime(item.time);
        return `
        <div class="ra-timeline-item">
            <div class="ra-icon-wrap" style="background:${item.bg}; color:${item.color};">
                <i class="fa-solid fa-${item.icon}"></i>
            </div>
            <div style="flex:1; min-width:0;">
                <div class="ra-label">
                    <span class="ra-badge" style="background:${item.bg}; color:${item.color};">${meta.emoji} ${meta.text}</span>
                    ${escapeHtml(item.label)}
                </div>
                <div class="ra-time"><i class="fa-regular fa-clock" style="margin-right:4px;"></i>${timeStr}</div>
            </div>
        </div>`;
    }).join('');
}

function formatActivityTime(isoString) {
    if (!isoString) return 'Unknown time';
    const date = new Date(isoString);
    const now  = new Date();
    const diffMs   = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs  = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1)   return 'Just now';
    if (diffMins < 60)  return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHrs  < 24)  return `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'Yesterday · ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7)   return `${diffDays} days ago · ` + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function loadTeacherList() {
    const teacherGrid = document.getElementById('admin-teacher-grid');
    if (!teacherGrid) return;
    
    teacherGrid.innerHTML = `
        <div class="col-12 text-center" id="admin-loading-indicator">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading teacher data...</p>
        </div>
    `;

    try {
        const response = await fetch(`${CM_API_BASE}/teacher/all`);
        if (!response.ok) throw new Error('Network response was not ok');
        const teachers = await response.json();
        _allTeachersCache = teachers;
        
        teacherGrid.innerHTML = '';
        if (teachers.length === 0) {
            teacherGrid.innerHTML = '<div class="col-12 text-center"><p>No teachers found.</p></div>';
            return;
        }

        teachers.forEach(teacher => {
            const col = document.createElement('div');
            col.className = 'col-md-4';
            
            const name = teacher.full_name || 'N/A';
            const designation = teacher.designation || 'N/A';
            const joinDate = teacher.joining_date || 'N/A';
            const mobile = teacher.mobile_number || 'N/A';
            const mail = teacher.email_address || 'N/A';
            const address = teacher.current_address ? teacher.current_address.replace(/\\n/g, ', ') : 'N/A';
            const photoUrl = teacher.photo_url || '../School/photos/default_user.png';

            col.innerHTML = `
                <div class="teacher-card">
                    <div class="teacher-photo-container">
                        <img src="${photoUrl}" alt="Photo of ${name}" class="teacher-photo">
                    </div>
                    <div class="teacher-info">
                        <div class="teacher-name-box">
                            <h5>Name: ${name}</h5>
                        </div>
                        <ul class="teacher-details-list">
                            <li><strong>ID:</strong> ${teacher.teacher_id}</li>
                            <li><strong>Designation:</strong> ${designation}</li>
                            <li><strong>Join Date:</strong> ${joinDate}</li>
                            <li><strong>Mobile:</strong> ${mobile}</li>
                            <li><strong>Mail:</strong> ${mail}</li>
                            <li><strong>Address:</strong> ${address}</li>
                        </ul>
                        <div class="teacher-action" style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
                            <button class="btn-details">Details</button>
                            <button class="btn-edit-sm" onclick="editTeacher('${teacher.teacher_id}')" style="background:#3b82f6; color:#fff; border:none; padding:5px 12px; border-radius:6px; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                            </button>
                            <button class="btn-delete-sm" onclick="deleteTeacher('${teacher.teacher_id}', '${(teacher.full_name || '').replace(/'/g, "\\'")}')" style="background:#ef4444; color:#fff; border:none; padding:5px 12px; border-radius:6px; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                                <i class="fa-solid fa-trash-can"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
            teacherGrid.appendChild(col);
        });
    } catch (error) {
        console.error('Error fetching teachers:', error);
        teacherGrid.innerHTML = '<div class="col-12 text-center text-danger"><p>Failed to load teachers.</p></div>';
    }
}

function generateTeacherId() {
    const teacherIdInput = document.getElementById('teacher-id');
    if (teacherIdInput && !teacherIdInput.value) {
        // Generate a random 4-digit number (from 1000 to 9999)
        const uniquePart = Math.floor(1000 + Math.random() * 9000).toString();
        teacherIdInput.value = 'T-' + uniquePart;
    }
}

// -------------------------------------------------------------------------
// MAKE STUDENT A USER LOGIC
// -------------------------------------------------------------------------

let selectedStudentIdForUser = null;

async function searchStudentForUser(event) {
    if (event) event.preventDefault();
    const searchInput = document.getElementById('search-student-user').value.trim();
    if (!searchInput) {
        alert('Please enter a Student ID or Card UID');
        return;
    }

    const statusText = document.getElementById('user-status-text');
    const statusBadge = document.getElementById('live-user-scan-status');

    if (statusText) statusText.innerText = `Searching for "${searchInput}"...`;

    try {
        const response = await fetch(`${STUDENT_API_BASE_URL}/search?query=${encodeURIComponent(searchInput)}`);
        
        if (!response.ok) {
            if (response.status === 404) {
                alert('No student found matching this ID or Card UID.');
                document.getElementById('student-user-result').style.display = 'none';
                selectedStudentIdForUser = null;
                if (statusText) statusText.innerText = 'Tap card on ESP32 or enter Student ID...';
                if (statusBadge) statusBadge.className = 'live-status-badge';
                return;
            }
            throw new Error('Error occurred while searching');
        }
        
        const student = await response.json();
        selectedStudentIdForUser = student.student_id;
        
        if (statusText) statusText.innerText = `Student Found: ${student.first_name || ''} ${student.last_name || ''} (${student.student_id})`;
        if (statusBadge) statusBadge.className = 'live-status-badge success';
        
        document.getElementById('su-student-id').textContent = student.student_id;
        document.getElementById('su-student-name').textContent = `${student.first_name || ''} ${student.last_name || ''}`.trim();
        document.getElementById('su-card-uid').textContent = student.uid || 'N/A';
        
        const statusSpan = document.getElementById('su-user-status');
        const makeUserBtn = document.getElementById('btn-make-student-user');
        
        if (student.is_user) {
            statusSpan.textContent = "Already a User";
            statusSpan.style.color = "green";
            makeUserBtn.disabled = true;
            makeUserBtn.style.opacity = '0.5';
            makeUserBtn.style.cursor = 'not-allowed';
            makeUserBtn.textContent = 'User Already Exists';
        } else {
            statusSpan.textContent = "Not a User";
            statusSpan.style.color = "red";
            makeUserBtn.disabled = false;
            makeUserBtn.style.opacity = '1';
            makeUserBtn.style.cursor = 'pointer';
            makeUserBtn.textContent = 'Confirm & Make User';
        }
        
        document.getElementById('student-user-result').style.display = 'block';

    } catch (error) {
        console.error('Error searching student:', error);
        alert('Error searching for student.');
        document.getElementById('student-user-result').style.display = 'none';
        selectedStudentIdForUser = null;
    }
}

async function makeStudentUser() {
    if (!selectedStudentIdForUser) {
        alert('Please search and select a student first.');
        return;
    }

    if (!confirm(`Are you sure you want to create a user account for Student ID: ${selectedStudentIdForUser}?`)) {
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/user/make-student-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: selectedStudentIdForUser })
        });

        const data = await response.json();
        if (response.ok) {
            alert('Student successfully saved as a User!');
            // Reset the form
            document.getElementById('search-student-user').value = '';
            document.getElementById('student-user-result').style.display = 'none';
            selectedStudentIdForUser = null;
        } else {
            alert('Error: ' + (data.error || 'Failed to create user account.'));
        }
    } catch (error) {
        console.error('Error creating user account:', error);
        alert('Server error while creating user account.');
    }
}


// =========================================================================
// CLASS MANAGEMENT MODULE
// =========================================================================

// --- Cache & API Helpers ---
const CM_CLASSES_KEY = 'kshs_classes';
const CM_ASSIGNMENTS_KEY = 'kshs_teacher_assignments';

const CM_API_BASE = (window.location.protocol.startsWith('http') && window.location.port === '3000')
    ? '/api'
    : 'http://localhost:3000/api';

let _cmClassesCache = [];
let _cmAssignmentsCache = [];

async function cmFetchClasses() {
    try {
        const res = await fetch(`${CM_API_BASE}/classes`);
        if (!res.ok) throw new Error('Server response error');
        const data = await res.json();
        _cmClassesCache = data.classes || [];
    } catch (err) {
        console.warn('Falling back to empty classes cache:', err.message);
        _cmClassesCache = [];
    }
    return _cmClassesCache;
}

function cmGetClasses() {
    return _cmClassesCache;
}

async function cmFetchAssignments() {
    try {
        const res = await fetch(`${CM_API_BASE}/classes/assignments`);
        if (!res.ok) throw new Error('Server response error');
        const data = await res.json();
        _cmAssignmentsCache = data.assignments || [];
    } catch (err) {
        console.warn('Falling back to empty assignments cache:', err.message);
        _cmAssignmentsCache = [];
    }
    return _cmAssignmentsCache;
}

function cmGetAssignments() {
    return _cmAssignmentsCache;
}

function cmGenerateId() {
    return 'CLS-' + Date.now().toString(36).toUpperCase();
}

function cmFormatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
}

// Initial pre-fetch on load
document.addEventListener('DOMContentLoaded', () => {
    cmFetchClasses();
    cmFetchAssignments();
});

// ---- Tab Switching ----
async function switchClassTab(tab) {
    const tabMap = {
        'add-class':       { panel: 'panel-add-class',       btn: 'tab-btn-add-class' },
        'edit-class':      { panel: 'panel-edit-class',      btn: 'tab-btn-edit-class' },
        'assign-teacher':  { panel: 'panel-assign-teacher',  btn: 'tab-btn-assign-teacher' }
    };
    Object.values(tabMap).forEach(({ panel, btn }) => {
        const p = document.getElementById(panel);
        const b = document.getElementById(btn);
        if (p) p.style.display = 'none';
        if (b) b.classList.remove('active');
    });
    const selected = tabMap[tab];
    if (!selected) return;
    const panel = document.getElementById(selected.panel);
    const btn   = document.getElementById(selected.btn);
    if (panel) panel.style.display = 'block';
    if (btn)   btn.classList.add('active');

    // Persist active class tab
    try {
        localStorage.setItem('kshs_active_cm_tab', tab);
        if (window.history && window.history.replaceState) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('tab', tab);
            window.history.replaceState(null, '', currentUrl.toString());
        }
    } catch (e) {
        console.warn('Could not persist tab state:', e);
    }

    if (tab === 'edit-class')      await loadClassList();
    if (tab === 'assign-teacher') { loadTeachersForAssign(); await loadClassSelectForAssign(); await loadAssignmentsTable(); }
}

function cmCheckClassConflicts(newCls, editId = null) {
    const classes = cmGetClasses();

    for (const existing of classes) {
        if (editId && existing.id === editId) continue;

        // Check Shift overlap (same shift)
        const sameShift = !existing.shift || !newCls.shift ||
            existing.shift.toLowerCase() === newCls.shift.toLowerCase();

        if (!sameShift) continue;

        // Check Day overlap
        const overlappingDays = (existing.days || []).filter(d => (newCls.days || []).includes(d));
        if (overlappingDays.length === 0) continue;

        // Check Time overlap: new starts before existing ends AND new ends after existing starts
        const timeOverlap = newCls.start_time < existing.end_time && newCls.end_time > existing.start_time;
        if (!timeOverlap) continue;

        const daysText = overlappingDays.join(', ');
        const timeText = `${cmFormatTime(existing.start_time)} – ${cmFormatTime(existing.end_time)}`;
        const existClsName = formatClassName(existing.class_name);
        const existSecName = formatSectionName(existing.section);

        // 1. Room Conflict
        if ((existing.room_number || '').trim().toLowerCase() === (newCls.room_number || '').trim().toLowerCase()) {
            return `⚠ Room Conflict! Room ${newCls.room_number} is already booked for ${existClsName} ${existSecName} (${existing.subject}) during ${timeText} on ${daysText} (${existing.shift} shift).`;
        }

        // 2. Class & Section Schedule Conflict
        const sameClass = formatClassName(existing.class_name) === formatClassName(newCls.class_name);
        const sameSection = formatSectionName(existing.section) === formatSectionName(newCls.section);

        if (sameClass && sameSection) {
            return `⚠ Class & Section Conflict! ${formatClassName(newCls.class_name)} ${formatSectionName(newCls.section)} already has a class (${existing.subject}) scheduled during ${timeText} on ${daysText} (${existing.shift} shift).`;
        }

        // 3. Teacher Schedule Conflict (if teacher assigned)
        if (newCls.assigned_teacher_id && existing.assigned_teacher_id &&
            newCls.assigned_teacher_id === existing.assigned_teacher_id) {
            return `⚠ Teacher Conflict! Assigned teacher "${existing.assigned_teacher_name}" is already teaching ${existClsName} ${existSecName} during ${timeText} on ${daysText}.`;
        }
    }

    return null;
}

// ---- Add / Edit / Delete Class ----
async function handleSaveClass(event) {
    event.preventDefault();

    const days = [...document.querySelectorAll('input[name="class-day"]:checked')].map(c => c.value);
    if (days.length === 0) {
        showCmToast('Please select at least one day of the week.', 'error');
        return;
    }

    const startTime = document.getElementById('cm-start-time').value;
    const endTime   = document.getElementById('cm-end-time').value;
    if (endTime <= startTime) {
        showCmToast('End time must be after start time.', 'error');
        return;
    }

    const editId = document.getElementById('edit-class-id').value;
    const classes = cmGetClasses();

    const classData = {
        id:            editId || cmGenerateId(),
        class_name:    document.getElementById('cm-class-name').value,
        section:       document.getElementById('cm-section').value,
        subject:       document.getElementById('cm-subject').value,
        room_number:   document.getElementById('cm-room').value,
        start_time:    startTime,
        end_time:      endTime,
        shift:         document.getElementById('cm-shift').value,
        academic_year: document.getElementById('cm-academic-year').value,
        capacity:      document.getElementById('cm-capacity').value || '',
        class_type:    document.getElementById('cm-class-type').value,
        days:          days,
        assigned_teacher_id:   '',
        assigned_teacher_name: ''
    };

    if (editId) {
        const existing = classes.find(c => c.id === editId);
        if (existing) {
            classData.assigned_teacher_id   = existing.assigned_teacher_id   || '';
            classData.assigned_teacher_name = existing.assigned_teacher_name || '';
        }
    }

    // Check conflicts (Room, Class & Section, Time, Days, Shift, Teacher)
    const conflictError = cmCheckClassConflicts(classData, editId);
    if (conflictError) {
        showCmToast(conflictError, 'error');
        return;
    }

    try {
        const url = editId ? `${CM_API_BASE}/classes/${editId}` : `${CM_API_BASE}/classes`;
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classData)
        });

        if (!res.ok) throw new Error('Database save failed');

        await cmFetchClasses();
        showCmToast(editId ? 'Class updated successfully!' : 'Class added successfully!', 'success');
        resetClassForm();
        loadClassSelectForAssign();
    } catch (err) {
        showCmToast('Failed to save class to database.', 'error');
        console.error(err);
    }
}

function editClass(classId) {
    const classes = cmGetClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return;

    switchClassTab('add-class');

    document.getElementById('edit-class-id').value       = cls.id;
    document.getElementById('cm-class-name').value       = cls.class_name;
    document.getElementById('cm-section').value          = cls.section;
    document.getElementById('cm-subject').value          = cls.subject;
    document.getElementById('cm-room').value             = cls.room_number;
    document.getElementById('cm-start-time').value       = cls.start_time;
    document.getElementById('cm-end-time').value         = cls.end_time;
    document.getElementById('cm-shift').value            = cls.shift;
    document.getElementById('cm-academic-year').value    = cls.academic_year;
    document.getElementById('cm-capacity').value         = cls.capacity || '';
    document.getElementById('cm-class-type').value       = cls.class_type || 'Regular';

    document.querySelectorAll('input[name="class-day"]').forEach(cb => {
        cb.checked = cls.days && cls.days.includes(cb.value);
    });

    document.getElementById('class-form-title').innerHTML   = '<i class="fa-solid fa-pen-to-square"></i> Edit Class';
    document.getElementById('btn-cancel-edit-class').style.display = 'inline-flex';
    document.getElementById('btn-save-class').innerHTML     = '<i class="fa-solid fa-floppy-disk"></i> Update Class';
}

function cancelEditClass() {
    resetClassForm();
}

function resetClassForm() {
    document.getElementById('class-form').reset();
    document.getElementById('edit-class-id').value                 = '';
    document.getElementById('class-form-title').innerHTML          = '<i class="fa-solid fa-plus-circle"></i> Add New Class';
    document.getElementById('btn-cancel-edit-class').style.display = 'none';
    document.getElementById('btn-save-class').innerHTML            = '<i class="fa-solid fa-floppy-disk"></i> Save Class';
    document.getElementById('cm-academic-year').value              = '2026-2027';
}

async function deleteClass(classId) {
    if (!confirm('Are you sure you want to delete this class? This will also remove any teacher assignment for it.')) return;

    try {
        const res = await fetch(`${CM_API_BASE}/classes/${classId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Database delete failed');

        await cmFetchClasses();
        await cmFetchAssignments();

        showCmToast('Class deleted.', 'success');
        await loadClassList();
        await loadClassSelectForAssign();
        await loadAssignmentsTable();
    } catch (err) {
        showCmToast('Failed to delete class from database.', 'error');
        console.error(err);
    }
}

// ---- All Classes Table ----
let _allClassesCache = [];

async function loadClassList() {
    const tbody = document.getElementById('cm-classes-tbody');
    if (!tbody) return;
    _allClassesCache = await cmFetchClasses();
    renderClassTable(_allClassesCache);
}

function formatClassName(name) {
    if (!name) return '';
    return name.toString().startsWith('Class') ? name : `Class ${name}`;
}

function formatSectionName(sec) {
    if (!sec) return '';
    return sec.toString().replace(/^Section\s*/i, '');
}

function renderClassTable(classes) {
    const tbody = document.getElementById('cm-classes-tbody');
    if (!tbody) return;

    if (classes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No classes found. Add a class using the <strong>Add Class</strong> tab.</td></tr>';
        return;
    }

    tbody.innerHTML = classes.map((cls, i) => {
        const daysHtml = (cls.days || []).map(d => `<span class="day-pill">${d}</span>`).join('');
        const teacher  = cls.assigned_teacher_name
            ? `<span class="cm-teacher-badge"><i class="fa-solid fa-user-tie"></i> ${cls.assigned_teacher_name}</span>`
            : '<span style="color:#94a3b8;font-style:italic;">Unassigned</span>';
        const typeBadgeColor = { Regular:'#3b82f6', Lab:'#8b5cf6', Extra:'#f59e0b', Exam:'#ef4444' }[cls.class_type] || '#3b82f6';
        const cDisplay = formatClassName(cls.class_name);
        const sDisplay = formatSectionName(cls.section);

        return `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${cDisplay}</strong></td>
            <td><span class="section-pill">${sDisplay}</span></td>
            <td>${cls.subject} <span class="type-badge" style="background:${typeBadgeColor}">${cls.class_type || 'Regular'}</span></td>
            <td><span class="room-pill"><i class="fa-solid fa-door-open"></i> ${cls.room_number}</span></td>
            <td class="time-col">
                <span class="time-badge">
                    <i class="fa-solid fa-clock"></i>
                    ${cmFormatTime(cls.start_time)} – ${cmFormatTime(cls.end_time)}
                </span>
            </td>
            <td>${daysHtml}</td>
            <td>${teacher}</td>
            <td>
                <button class="btn-edit-sm" onclick="editClass('${cls.id}')" title="Edit Class">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button class="btn-delete-sm" onclick="deleteClass('${cls.id}')" title="Delete Class" style="margin-top:4px;">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            </td>
        </tr>`;
    }).join('');
}

function filterClasses() {
    const query = (document.getElementById('cm-search-classes')?.value || '').toLowerCase();
    if (!query) {
        renderClassTable(_allClassesCache);
        return;
    }
    const filtered = _allClassesCache.filter(c =>
        (c.class_name   || '').toLowerCase().includes(query) ||
        (c.subject      || '').toLowerCase().includes(query) ||
        (c.room_number  || '').toLowerCase().includes(query) ||
        (c.section      || '').toLowerCase().includes(query) ||
        (c.shift        || '').toLowerCase().includes(query) ||
        (c.assigned_teacher_name || '').toLowerCase().includes(query)
    );
    renderClassTable(filtered);
}

// ---- Assign Teacher ----
async function loadTeachersForAssign() {
    const select = document.getElementById('at-teacher-select');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Loading teachers...</option>';
    try {
        const response = await fetch(`${CM_API_BASE}/teacher/all`);
        if (!response.ok) throw new Error('Server error');
        const teachers = await response.json();

        if (teachers.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No teachers found — add a teacher first</option>';
            return;
        }

        select.innerHTML = '<option value="" disabled selected>Select a teacher...</option>' +
            teachers.map(t => `<option value="${t.teacher_id}" data-name="${t.full_name || ''}">${
                t.full_name || t.teacher_id} — ${t.designation || 'Teacher'}</option>`).join('');
    } catch {
        select.innerHTML = '<option value="" disabled selected>Could not load teachers (server offline)</option>';
    }
}

async function loadClassSelectForAssign() {
    const select = document.getElementById('at-class-select');
    if (!select) return;
    const classes = await cmFetchClasses();

    if (classes.length === 0) {
        select.innerHTML = '<option value="" disabled selected>No classes found — add a class first</option>';
        return;
    }

    select.innerHTML = '<option value="" disabled selected>Select a class...</option>' +
        classes.map(c => `<option value="${c.id}">${formatClassName(c.class_name)} ${formatSectionName(c.section)} — ${c.subject} | ${cmFormatTime(c.start_time)}–${cmFormatTime(c.end_time)} | Room ${c.room_number}</option>`).join('');
}

function onTeacherSelectChange() {
    const teacherId = document.getElementById('at-teacher-select').value;
    showTeacherSchedulePreview(teacherId);
    clearAssignPreview();
    checkAssignConflict();
}

function onClassSelectChange() {
    clearAssignPreview();
    checkAssignConflict();
}

function showTeacherSchedulePreview(teacherId) {
    const scheduleDiv  = document.getElementById('at-teacher-schedule');
    const scheduleBody = document.getElementById('at-teacher-schedule-body');
    if (!scheduleDiv || !scheduleBody) return;

    const assignments = cmGetAssignments().filter(a => a.teacher_id === teacherId);
    const classes     = cmGetClasses();

    if (assignments.length === 0) {
        scheduleDiv.style.display = 'block';
        scheduleBody.innerHTML = '<p style="color:#64748b;font-style:italic;">No classes assigned yet.</p>';
        return;
    }

    const rows = assignments.map(a => {
        const cls = classes.find(c => c.id === a.class_id);
        if (!cls) return '';
        return `<div class="at-schedule-row">
            <span class="at-schedule-badge">${cls.class_name} ${cls.section}</span>
            <span>${cls.subject}</span>
            <span class="time-badge"><i class="fa-solid fa-clock"></i> ${cmFormatTime(cls.start_time)}–${cmFormatTime(cls.end_time)}</span>
            <span>${(cls.days || []).map(d => `<span class="day-pill">${d}</span>`).join('')}</span>
            <span class="room-pill"><i class="fa-solid fa-door-open"></i> ${cls.room_number}</span>
        </div>`;
    }).filter(Boolean).join('');

    scheduleDiv.style.display = 'block';
    scheduleBody.innerHTML    = rows || '<p style="color:#64748b;">No valid classes found.</p>';
}

function checkAssignConflict() {
    const teacherId = document.getElementById('at-teacher-select')?.value;
    const classId   = document.getElementById('at-class-select')?.value;
    const conflictDiv  = document.getElementById('at-conflict-alert');
    const previewDiv   = document.getElementById('at-assignment-preview');
    const assignBtn    = document.getElementById('btn-assign-teacher');
    const conflictMsg  = document.getElementById('at-conflict-msg');
    const previewMsg   = document.getElementById('at-preview-msg');

    if (!teacherId || !classId) {
        if (conflictDiv) conflictDiv.style.display = 'none';
        if (previewDiv)  previewDiv.style.display  = 'none';
        return;
    }

    const newCls      = cmGetClasses().find(c => c.id === classId);
    const assignments = cmGetAssignments();
    const classes     = cmGetClasses();

    if (!newCls) return;

    const alreadyAssigned = assignments.find(a => a.teacher_id === teacherId && a.class_id === classId);
    if (alreadyAssigned) {
        conflictDiv.style.display = 'flex';
        conflictMsg.textContent   = 'This teacher is already assigned to this class.';
        previewDiv.style.display  = 'none';
        if (assignBtn) assignBtn.disabled = true;
        return;
    }

    const teacherClasses = assignments
        .filter(a => a.teacher_id === teacherId)
        .map(a => classes.find(c => c.id === a.class_id))
        .filter(Boolean);

    for (const existing of teacherClasses) {
        const daysOverlap = (existing.days || []).some(d => (newCls.days || []).includes(d));
        if (!daysOverlap) continue;

        const existStart = existing.start_time;
        const existEnd   = existing.end_time;
        const newStart   = newCls.start_time;
        const newEnd     = newCls.end_time;

        if (newStart < existEnd && newEnd > existStart) {
            conflictDiv.style.display = 'flex';
            conflictMsg.textContent   =
                `⚠ Conflict detected! This teacher is already assigned to "${existing.class_name} ${existing.section} — ${existing.subject}" ` +
                `(${cmFormatTime(existing.start_time)}–${cmFormatTime(existing.end_time)}) on overlapping days (${(existing.days||[]).filter(d=>(newCls.days||[]).includes(d)).join(', ')}). ` +
                `A teacher cannot be assigned to two classes at the same time.`;
            previewDiv.style.display  = 'none';
            if (assignBtn) assignBtn.disabled = true;
            return;
        }
    }

    if (conflictDiv) conflictDiv.style.display = 'none';
    if (previewDiv)  {
        previewDiv.style.display = 'flex';
        const teacherName = document.getElementById('at-teacher-select').selectedOptions[0]?.text.split(' — ')[0] || teacherId;
        previewMsg.textContent = `✓ No conflict. "${teacherName}" can be assigned to "${newCls.class_name} ${newCls.section} — ${newCls.subject}" (${cmFormatTime(newCls.start_time)}–${cmFormatTime(newCls.end_time)}).`;
    }
    if (assignBtn) assignBtn.disabled = false;
}

function clearAssignPreview() {
    const conflictDiv = document.getElementById('at-conflict-alert');
    const previewDiv  = document.getElementById('at-assignment-preview');
    const scheduleDiv = document.getElementById('at-teacher-schedule');
    if (conflictDiv) conflictDiv.style.display = 'none';
    if (previewDiv)  previewDiv.style.display  = 'none';
    if (scheduleDiv) scheduleDiv.style.display  = 'none';
    const assignBtn = document.getElementById('btn-assign-teacher');
    if (assignBtn) assignBtn.disabled = false;
}

async function handleAssignTeacher(event) {
    event.preventDefault();

    const teacherId   = document.getElementById('at-teacher-select').value;
    const classId     = document.getElementById('at-class-select').value;
    const teacherName = document.getElementById('at-teacher-select').selectedOptions[0]?.text.split(' — ')[0] || teacherId;

    const classes     = cmGetClasses();
    const assignments = cmGetAssignments();
    const newCls      = classes.find(c => c.id === classId);
    if (!newCls) { showCmToast('Class not found.', 'error'); return; }

    const alreadyAssigned = assignments.find(a => a.teacher_id === teacherId && a.class_id === classId);
    if (alreadyAssigned) { showCmToast('Already assigned!', 'error'); return; }

    const teacherClasses = assignments
        .filter(a => a.teacher_id === teacherId)
        .map(a => classes.find(c => c.id === a.class_id))
        .filter(Boolean);

    for (const existing of teacherClasses) {
        const daysOverlap = (existing.days||[]).some(d => (newCls.days||[]).includes(d));
        if (!daysOverlap) continue;
        if (newCls.start_time < existing.end_time && newCls.end_time > existing.start_time) {
            showCmToast('Cannot assign: Time conflict detected!', 'error');
            return;
        }
    }

    try {
        const res = await fetch(`${CM_API_BASE}/classes/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacherId, class_id: classId, teacher_name: teacherName })
        });

        if (!res.ok) throw new Error('Failed to assign teacher');

        await cmFetchClasses();
        await cmFetchAssignments();

        showCmToast(`Teacher "${teacherName}" successfully assigned!`, 'success');
        document.getElementById('assign-teacher-form').reset();
        clearAssignPreview();
        await loadTeachersForAssign();
        await loadClassSelectForAssign();
        await loadAssignmentsTable();
    } catch (err) {
        showCmToast('Failed to save assignment to database.', 'error');
        console.error(err);
    }
}

async function removeAssignment(teacherId, classId) {
    if (!confirm('Remove this teacher assignment?')) return;

    try {
        const queryParams = new URLSearchParams();
        if (teacherId) queryParams.append('teacher_id', teacherId);
        if (classId) queryParams.append('class_id', classId);

        const res = await fetch(`${CM_API_BASE}/classes/assignments?${queryParams.toString()}`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Failed to remove assignment');

        await cmFetchClasses();
        await cmFetchAssignments();

        showCmToast('Assignment removed.', 'success');
        await loadAssignmentsTable();
        await loadClassList();
        checkAssignConflict();
    } catch (err) {
        showCmToast('Failed to remove assignment from database.', 'error');
        console.error(err);
    }
}

async function loadAssignmentsTable() {
    const tbody = document.getElementById('at-assignments-tbody');
    if (!tbody) return;

    const assignments = await cmFetchAssignments();
    const classes     = await cmFetchClasses();

    if (assignments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No assignments yet.</td></tr>';
        return;
    }

    const rows = assignments.map((a, i) => {
        const cls = classes.find(c => c.id === a.class_id);
        if (!cls) return '';
        const daysHtml = (cls.days||[]).map(d => `<span class="day-pill">${d}</span>`).join('');
        return `
        <tr>
            <td>${i + 1}</td>
            <td><span class="cm-teacher-badge"><i class="fa-solid fa-user-tie"></i> ${a.teacher_name || a.teacher_id}</span></td>
            <td><strong>${formatClassName(cls.class_name)}</strong> <span class="section-pill">${formatSectionName(cls.section)}</span></td>
            <td>${cls.subject}</td>
            <td><span class="time-badge"><i class="fa-solid fa-clock"></i> ${cmFormatTime(cls.start_time)}–${cmFormatTime(cls.end_time)}</span></td>
            <td>${daysHtml}</td>
            <td><span class="room-pill"><i class="fa-solid fa-door-open"></i> ${cls.room_number}</span></td>
            <td>
                <button class="btn-delete-sm" onclick="removeAssignment('${a.teacher_id}','${a.class_id}')">
                    <i class="fa-solid fa-unlink"></i> Remove
                </button>
            </td>
        </tr>`;
    }).filter(Boolean).join('');

    tbody.innerHTML = rows || '<tr><td colspan="8" class="text-center">No valid assignments found.</td></tr>';
}

function showCmToast(message, type = 'success') {
    let toast = document.getElementById('cm-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cm-toast';
        document.body.appendChild(toast);
    }
    toast.className = `cm-toast cm-toast-${type} show`;
    toast.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'circle-check' : 'circle-xmark'}"></i> ${message}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// -------------------------------------------------------------------------
// RFID CARD MANAGEMENT JS LOGIC
// -------------------------------------------------------------------------

function generateStudentIdForRfid() {
    const input = document.getElementById('rfid-student-id-input');
    if (input && !input.value) {
        const rand = Math.floor(10000 + Math.random() * 90000);
        input.value = `26-${rand}`;
    }
}

function simulateCardTap(targetInputId = 'rfid-uid-input') {
    const targetInput = document.getElementById(targetInputId) || document.getElementById('rfid-uid-input');
    if (!targetInput) return;

    const chars = '0123456789ABCDEF';
    let mockUid = '';
    for (let i = 0; i < 8; i++) {
        mockUid += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    targetInput.value = mockUid;

    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = `Card Scanned: ${mockUid}`;

    showCmToast(`Scanned Card UID: ${mockUid}`, 'success');
}

async function handleRfidRegister(event) {
    if (event) event.preventDefault();

    const uid = document.getElementById('rfid-uid-input')?.value;
    const student_id = document.getElementById('rfid-student-id-input')?.value;
    const name = document.getElementById('rfid-student-name-input')?.value;

    if (!uid || !student_id || !name) {
        alert('Please tap an RFID card and fill in the Student Name.');
        return;
    }

    try {
        const res = await fetch(`${CM_API_BASE}/cards/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, student_id, name })
        });
        const data = await res.json();

        if (res.ok) {
            alert(`Success! Card ${data.card.uid} registered for ${data.card.name} (${data.card.student_id}).`);
            const nameInput = document.getElementById('rfid-student-name-input');
            if (nameInput) nameInput.value = '';
            const uidInput = document.getElementById('rfid-uid-input');
            if (uidInput) uidInput.value = '';
            generateStudentIdForRfid();
            await loadRegisteredCards();
            await loadExtendedCards();
        } else {
            alert('Error: ' + (data.error || 'Failed to register card.'));
        }
    } catch (err) {
        console.error('RFID Register Error:', err);
        alert('Server error while registering card.');
    }
}

async function searchStudentForReplace(event) {
    if (event) event.preventDefault();

    const query = (document.getElementById('replace-search-student-id')?.value || '').trim();
    if (!query) {
        alert('Please enter a Student ID or Card UID to search.');
        return;
    }

    try {
        const res = await fetch(`${CM_API_BASE}/cards/search/${encodeURIComponent(query)}`);
        const data = await res.json();

        if (res.ok && data) {
            const sidDisplay = document.getElementById('replace-student-id-display');
            const snameInput = document.getElementById('replace-student-name-input');
            const oldUidInput = document.getElementById('replace-old-uid-input');

            if (sidDisplay) sidDisplay.value = data.student_id || '';
            if (snameInput) snameInput.value = data.name || '';
            if (oldUidInput) oldUidInput.value = data.uid || '';

            showCmToast(`Found record for ${data.name} (${data.student_id})`, 'success');
        } else {
            alert('No card record found for: ' + query);
        }
    } catch (err) {
        console.error('Search Student Error:', err);
        alert('Server error while searching student card.');
    }
}

async function handleRfidReplace(event) {
    if (event) event.preventDefault();

    const student_id = document.getElementById('replace-student-id-display')?.value;
    const new_uid = document.getElementById('replace-new-uid-input')?.value || document.getElementById('rfid-uid-input')?.value;

    if (!student_id) {
        alert('Please search for a student card record first.');
        return;
    }
    if (!new_uid) {
        alert('Please scan or simulate a new RFID card UID.');
        return;
    }

    try {
        const res = await fetch(`${CM_API_BASE}/cards/replace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id, new_uid })
        });
        const data = await res.json();

        if (res.ok) {
            alert(`Success! Card replaced for ${data.card.name}. New UID is ${data.card.uid}.`);
            await loadRegisteredCards();
            await loadExtendedCards();
        } else {
            alert('Error: ' + (data.error || 'Failed to replace card.'));
        }
    } catch (err) {
        console.error('Replace Card Error:', err);
        alert('Server error while replacing card.');
    }
}

let _cardsCache = [];

async function loadRegisteredCards() {
    const bodies = [
        document.getElementById('cards-table-body'),
        document.getElementById('replace-cards-table-body')
    ].filter(Boolean);

    if (bodies.length === 0) return;

    try {
        const res = await fetch(`${CM_API_BASE}/cards/all`);
        if (!res.ok) throw new Error('Failed to fetch cards');
        _cardsCache = await res.json();

        bodies.forEach(body => {
            if (_cardsCache.length === 0) {
                body.innerHTML = '<tr><td colspan="6" class="text-center">No registered RFID cards found.</td></tr>';
                return;
            }

            body.innerHTML = _cardsCache.map((c, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><code>${c.uid}</code></td>
                    <td><strong>${c.student_id}</strong></td>
                    <td>${c.name}</td>
                    <td>${c.created_at || 'N/A'}</td>
                    <td>
                        <button onclick="deleteRfidCard('${c.student_id}', '${(c.name || '').replace(/'/g, "\\'")}')" style="background:#ef4444; color:#fff; border:none; padding:4px 10px; border-radius:5px; cursor:pointer; font-weight:600;">
                            <i class="fa-solid fa-trash-can"></i> Revoke
                        </button>
                    </td>
                </tr>
            `).join('');
        });
    } catch (err) {
        console.error('Load Cards Error:', err);
        bodies.forEach(b => b.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load cards. Make sure backend is running.</td></tr>');
    }
}

async function loadExtendedCards() {
    const body = document.getElementById('extended-cards-table-body');
    if (!body) return;

    try {
        const res = await fetch(`${CM_API_BASE}/cards/all`);
        if (!res.ok) throw new Error('Failed to fetch cards');
        _cardsCache = await res.json();

        renderExtendedCardsTable(_cardsCache);
    } catch (err) {
        console.error('Load Extended Cards Error:', err);
        body.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Failed to load cards. Make sure backend is running.</td></tr>';
    }
}

function renderExtendedCardsTable(cards) {
    const body = document.getElementById('extended-cards-table-body');
    if (!body) return;

    if (!cards || cards.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 24px; color: #64748b; font-weight: 500;">
                    <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; color: #94a3b8; display: block; margin-bottom: 8px;"></i>
                    No matching registered cards found.
                </td>
            </tr>`;
        return;
    }

    body.innerHTML = cards.map((c, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><code class="uid-tag">${c.uid}</code></td>
            <td><strong class="student-id-tag">${c.student_id}</strong></td>
            <td><strong>${c.name || 'N/A'}</strong></td>
            <td>${formatClassName(c.class_name) || 'N/A'}</td>
            <td>${formatSectionName(c.section) || 'N/A'}</td>
            <td>${c.shift || 'N/A'}</td>
            <td><small style="color:#64748b;">${c.created_at || 'N/A'}</small></td>
            <td style="text-align:center;">
                <button onclick="deleteRfidCard('${c.student_id}', '${(c.name || '').replace(/'/g, "\\'")}')" class="btn-delete-sm">
                    <i class="fa-solid fa-trash-can"></i> Revoke
                </button>
            </td>
        </tr>
    `).join('');
}

let _searchDebounceTimer = null;
function filterRegisteredCards() {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => {
        const query = (document.getElementById('search-registered-cards')?.value || '').toLowerCase().trim();
        if (!query) {
            renderExtendedCardsTable(_cardsCache);
            return;
        }

        const filtered = _cardsCache.filter(c => 
            (c.student_id || '').toLowerCase().includes(query) ||
            (c.name || '').toLowerCase().includes(query) ||
            (c.uid || '').toLowerCase().includes(query) ||
            (c.class_name || '').toLowerCase().includes(query) ||
            (c.section || '').toLowerCase().includes(query)
        );
        renderExtendedCardsTable(filtered);
    }, 120);
}

async function deleteRfidCard(studentId, name = '') {
    if (!confirm(`Are you sure you want to revoke/delete RFID card for ${name ? `"${name}" (${studentId})` : studentId}?`)) return;

    try {
        const res = await fetch(`${CM_API_BASE}/cards/${studentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            alert('Card revoked successfully.');
            await loadRegisteredCards();
            await loadExtendedCards();
        } else {
            alert('Error: ' + (data.error || 'Failed to delete card.'));
        }
    } catch (err) {
        console.error('Delete RFID Card Error:', err);
        alert('Server error while revoking card.');
    }
}

// =========================================================================
// DASHBOARD ANALYTICS & VISUAL CHARTS (Chart.js Integration)
// =========================================================================
let currentAnalyticsDays = 7;
let trendsChartInstance = null;
let genderChartInstance = null;
let classChartInstance = null;

async function loadAnalyticsDashboard(days = currentAnalyticsDays) {
    currentAnalyticsDays = days;
    const daysSelect = document.getElementById('analytics-days-select');
    if (daysSelect) daysSelect.value = days;

    const periodTag = document.getElementById('trends-period-tag');
    if (periodTag) periodTag.textContent = `Last ${days} Days`;

    try {
        const response = await fetch(`${getApiHost()}/api/analytics/dashboard?days=${days}`);
        if (!response.ok) throw new Error('Failed to load analytics dashboard data');
        const data = await response.json();

        updateAnalyticsKpis(data.summary);
        renderAttendanceTrendsChart(data.trends || []);
        renderGenderDistributionChart(data.genderDistribution || {});
        renderClassWiseAttendanceChart(data.classWise || []);
    } catch (err) {
        console.error('Analytics dashboard load error:', err);
    }
}

function changeAnalyticsDays(days) {
    loadAnalyticsDashboard(parseInt(days) || 7);
}

function refreshAnalyticsDashboard() {
    loadAnalyticsDashboard(currentAnalyticsDays);
}

function updateAnalyticsKpis(summary) {
    if (!summary) return;
    const totalStudentsElem = document.getElementById('kpi-total-students');
    const presentTodayElem = document.getElementById('kpi-present-today');
    const attendanceRateElem = document.getElementById('kpi-attendance-rate');
    const totalTeachersElem = document.getElementById('kpi-total-teachers');

    if (totalStudentsElem) totalStudentsElem.textContent = summary.totalStudents ?? 0;
    if (presentTodayElem) presentTodayElem.textContent = summary.presentToday ?? 0;
    if (attendanceRateElem) attendanceRateElem.textContent = `${summary.attendanceRate ?? 0}%`;
    if (totalTeachersElem) totalTeachersElem.textContent = summary.totalTeachers ?? 0;
}

function renderAttendanceTrendsChart(trendsData) {
    const canvas = document.getElementById('attendanceTrendsChart');
    if (!canvas) return;

    if (trendsChartInstance) {
        trendsChartInstance.destroy();
        trendsChartInstance = null;
    }

    const labels = trendsData.map(d => d.date_label || d.date);
    const counts = trendsData.map(d => parseInt(d.present_count) || 0);

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(2, 132, 199, 0.30)');
    gradient.addColorStop(1, 'rgba(2, 132, 199, 0.01)');

    trendsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length > 0 ? labels : ['No Data'],
            datasets: [{
                label: 'Present Students',
                data: counts.length > 0 ? counts : [0],
                borderColor: '#0284c7',
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#0284c7',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            return ` Present: ${context.parsed.y} Students`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Open Sans', size: 12 }, color: '#64748b' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { family: 'Open Sans', size: 12 },
                        color: '#64748b'
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });
}

function renderGenderDistributionChart(genderData) {
    const canvas = document.getElementById('genderDistributionChart');
    if (!canvas) return;

    if (genderChartInstance) {
        genderChartInstance.destroy();
        genderChartInstance = null;
    }

    const overallList = genderData.overall || [];
    let maleCount = 0;
    let femaleCount = 0;
    let otherCount = 0;

    overallList.forEach(item => {
        const g = (item.gender || '').toLowerCase();
        const cnt = parseInt(item.count) || 0;
        if (g.includes('male') && !g.includes('female')) maleCount += cnt;
        else if (g.includes('female')) femaleCount += cnt;
        else otherCount += cnt;
    });

    const labels = [];
    const values = [];
    const colors = [];

    if (maleCount > 0) { labels.push('Male'); values.push(maleCount); colors.push('#0284c7'); }
    if (femaleCount > 0) { labels.push('Female'); values.push(femaleCount); colors.push('#ec4899'); }
    if (otherCount > 0) { labels.push('Other/Unspecified'); values.push(otherCount); colors.push('#94a3b8'); }

    if (values.length === 0) {
        labels.push('No Data');
        values.push(1);
        colors.push('#cbd5e1');
    }

    const ctx = canvas.getContext('2d');
    genderChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: 'Open Sans', size: 13, weight: '600' },
                        padding: 16,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${val} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '68%'
        }
    });
}

function renderClassWiseAttendanceChart(classData) {
    const canvas = document.getElementById('classWiseAttendanceChart');
    if (!canvas) return;

    if (classChartInstance) {
        classChartInstance.destroy();
        classChartInstance = null;
    }

    const labels = classData.map(c => `Class ${c.class_name}`);
    const rates = classData.map(c => parseFloat(c.attendance_rate) || 0);

    const ctx = canvas.getContext('2d');
    classChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['No Classes'],
            datasets: [{
                label: 'Attendance Rate (%)',
                data: rates.length > 0 ? rates : [0],
                backgroundColor: '#10b981',
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 24
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const raw = classData[context.dataIndex];
                            if (raw) {
                                return ` Rate: ${raw.attendance_rate}% (${raw.present_students}/${raw.total_students} Present)`;
                            }
                            return ` Rate: ${context.parsed.y}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Open Sans', size: 12 }, color: '#64748b' }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        font: { family: 'Open Sans', size: 12 },
                        color: '#64748b',
                        callback: function(val) { return val + '%'; }
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });
}
