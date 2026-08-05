// Server Base API URL
const API_BASE_URL = 'http://localhost:3000/api/rfid';
const STUDENT_API_BASE_URL = 'http://localhost:3000/api/student';

function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const allMenus = document.querySelectorAll('.sidebar-menu-content');
    
    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('active');
        }
    });

    if (menu) {
        menu.classList.toggle('active');
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

// Global Variables
let lastScannedUid = null;
let pollInterval = null;
let currentPhotoBase64 = null;

// Initialize Page Features on Document Load
document.addEventListener('DOMContentLoaded', async () => {
    if (document.getElementById('cards-table-body')) {
        loadRegisteredCards();
    }
    // Fetch initial latest scan to set lastScannedUid without auto-filling old scan
    try {
        const response = await fetch(`${API_BASE_URL}/latest-scan`);
        if (response.ok) {
            const initialScan = await response.json();
            if (initialScan && initialScan.uid) {
                lastScannedUid = initialScan.uid; // Ignore old cached scan on load
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
            const response = await fetch(`${API_BASE_URL}/latest-scan`);
            if (!response.ok) return;

            const scanData = await response.json();
            
            // Check for RFID Register Page
            const uidInput = document.getElementById('rfid-uid-input');
            if (uidInput && scanData && scanData.uid && scanData.uid !== lastScannedUid) {
                lastScannedUid = scanData.uid;
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
            if (searchInput && scanData && scanData.uid && scanData.uid !== lastScannedUid) {
                lastScannedUid = scanData.uid;
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
            document.getElementById('summary-student-id').innerText = data.student_id;
            document.getElementById('summary-card-uid').innerText = data.uid;
            document.getElementById('summary-card-name').innerText = data.card_name;
            document.getElementById('student-id-hidden').value = data.student_id;

            // Populate Personal Data Form
            document.getElementById('first-name-input').value = data.first_name || '';
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

            if (personalSection) personalSection.style.display = 'block';
        } else {
            if (editStatusText) editStatusText.innerText = `Not Found: "${searchTerm}"`;
            if (editStatusBadge) editStatusBadge.className = 'live-status-badge warning';
            alert(`Not Found: ${data.error}`);
            if (personalSection) personalSection.style.display = 'none';
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
