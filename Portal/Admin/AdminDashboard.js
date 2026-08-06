// Server Base API URL
const API_BASE_URL = 'http://localhost:3000/api/rfid';
const STUDENT_API_BASE_URL = 'http://localhost:3000/api/student';

function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const allMenus = document.querySelectorAll('.sidebar-menu-content');
    const allBtns = document.querySelectorAll('.sidebar-btn');
    
    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('active');
        }
    });

    allBtns.forEach(btn => {
        if (!btn.getAttribute('onclick').includes(menuId)) {
            btn.classList.remove('active');
        }
    });

    if (menu) {
        menu.classList.toggle('active');
        const btn = document.querySelector(`button[onclick*="${menuId}"]`);
        if (btn) {
            btn.classList.toggle('active');
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

// Global Variables
let lastScannedUid = null;
let pollInterval = null;
let currentPhotoBase64 = null;

// Initialize Page Features on Document Load
document.addEventListener('DOMContentLoaded', async () => {
    if (document.getElementById('cards-table-body')) {
        loadRegisteredCards();
    }
    if (document.getElementById('extended-cards-table-body')) {
        loadExtendedRegisteredCards();
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
            // Check if any admin page is currently waiting for a scan
            const isWaitingForScan = document.getElementById('rfid-uid-input') || 
                                     document.getElementById('search-query-input') || 
                                     document.getElementById('scan-uid') ||
                                     document.getElementById('search-student-user');
                                     
            const endpoint = isWaitingForScan ? `${API_BASE_URL}/latest-scan?active=true` : `${API_BASE_URL}/latest-scan`;
            const response = await fetch(endpoint);
            if (!response.ok) return;

            const scanData = await response.json();
            
            // Check for RFID Register Page
            const uidInput = document.getElementById('rfid-uid-input');
            const rfidSection = document.getElementById('rfid-section');
            if (rfidSection && rfidSection.style.display !== 'none' && uidInput && scanData && scanData.uid && scanData.uid !== lastScannedUid) {
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
            // Assuming Edit Student page is wrapped in an element we can check visibility for, but we'll just check if it's visible if we can.
            // Actually, we'll just add the Make Student User check.
            const makeUserSection = document.getElementById('make-student-user-section');
            const makeUserSearchInput = document.getElementById('search-student-user');
            
            if (makeUserSection && makeUserSection.style.display === 'block' && makeUserSearchInput && scanData && scanData.uid && scanData.uid !== lastScannedUid) {
                lastScannedUid = scanData.uid;
                makeUserSearchInput.value = scanData.uid;
                searchStudentForUser();
            } else if (searchInput && scanData && scanData.uid && scanData.uid !== lastScannedUid) {
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
                const response = await fetch('http://localhost:3000/api/teacher/personal-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok) {
                    alert('Success: Teacher Personal Data saved successfully!');
                    form.reset();
                    photoPreview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Teacher Photo</span>';
                    currentPhotoBase64 = null;
                } else {
                    alert('Error: ' + (data.error || 'Failed to save teacher data'));
                }
            } catch (err) {
                console.error('Submission Error:', err);
                alert('Server connection error. Make sure the Node.js backend is running!');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Teacher Data';
            }
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const section = urlParams.get('section');
    if (section) {
        showDashboardSection(section);
    }
});
function showDashboardSection(sectionId) {
    const rfidSection = document.getElementById('rfid-section');
    const teacherSection = document.getElementById('add-teacher-section');
    const makeStudentUserSection = document.getElementById('make-student-user-section');
    const teacherListSection = document.getElementById('teacher-list-section');
    const classManagementSection = document.getElementById('class-management-section');
    
    if (rfidSection) rfidSection.style.display = 'none';
    if (teacherSection) teacherSection.style.display = 'none';
    if (makeStudentUserSection) makeStudentUserSection.style.display = 'none';
    if (teacherListSection) teacherListSection.style.display = 'none';
    if (classManagementSection) classManagementSection.style.display = 'none';

    const target = document.getElementById(sectionId);
    if (target) {
        target.style.display = 'block';
        if (sectionId === 'add-teacher-section') {
            generateTeacherId();
        } else if (sectionId === 'teacher-list-section') {
            loadTeacherList();
        } else if (sectionId === 'class-management-section') {
            // Default: show Add Class tab
            switchClassTab('add-class');
            loadTeachersForAssign();
        }
    }
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
        const response = await fetch('http://localhost:3000/api/teacher/all');
        if (!response.ok) throw new Error('Network response was not ok');
        const teachers = await response.json();
        
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
                            <li><strong>Designation:</strong> ${designation}</li>
                            <li><strong>Join Date:</strong> ${joinDate}</li>
                            <li><strong>Mobile:</strong> ${mobile}</li>
                            <li><strong>Mail:</strong> ${mail}</li>
                            <li><strong>Address:</strong> ${address}</li>
                        </ul>
                        <div class="teacher-action">
                            <button class="btn-details">Details</button>
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

// --- localStorage keys ---
const CM_CLASSES_KEY = 'kshs_classes';
const CM_ASSIGNMENTS_KEY = 'kshs_teacher_assignments';

// ---- Helpers ----
function cmGetClasses() {
    try { return JSON.parse(localStorage.getItem(CM_CLASSES_KEY)) || []; } catch { return []; }
}
function cmSaveClasses(arr) {
    localStorage.setItem(CM_CLASSES_KEY, JSON.stringify(arr));
}
function cmGetAssignments() {
    try { return JSON.parse(localStorage.getItem(CM_ASSIGNMENTS_KEY)) || []; } catch { return []; }
}
function cmSaveAssignments(arr) {
    localStorage.setItem(CM_ASSIGNMENTS_KEY, JSON.stringify(arr));
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

// ---- Tab Switching ----
function switchClassTab(tab) {
    // tab: 'add-class' | 'edit-class' | 'assign-teacher'
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

    if (tab === 'edit-class')      loadClassList();
    if (tab === 'assign-teacher') { loadTeachersForAssign(); loadClassSelectForAssign(); loadAssignmentsTable(); }
}

// ---- Add / Edit / Delete Class ----
function handleSaveClass(event) {
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
        // Preserve teacher assignment when editing
        const existing = classes.find(c => c.id === editId);
        if (existing) {
            classData.assigned_teacher_id   = existing.assigned_teacher_id   || '';
            classData.assigned_teacher_name = existing.assigned_teacher_name || '';
        }
        const idx = classes.findIndex(c => c.id === editId);
        if (idx !== -1) classes[idx] = classData;
    } else {
        classes.push(classData);
    }

    cmSaveClasses(classes);
    showCmToast(editId ? 'Class updated successfully!' : 'Class added successfully!', 'success');
    resetClassForm();
    // Refresh assign dropdowns if open
    loadClassSelectForAssign();
}

function editClass(classId) {
    const classes = cmGetClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return;

    // Switch to Add Class tab
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

    // Restore day checkboxes
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

function deleteClass(classId) {
    if (!confirm('Are you sure you want to delete this class? This will also remove any teacher assignment for it.')) return;
    let classes = cmGetClasses();
    classes = classes.filter(c => c.id !== classId);
    cmSaveClasses(classes);

    // Remove any assignments for this class
    let assignments = cmGetAssignments();
    assignments = assignments.filter(a => a.class_id !== classId);
    cmSaveAssignments(assignments);

    showCmToast('Class deleted.', 'success');
    loadClassList();
    loadClassSelectForAssign();
    loadAssignmentsTable();
}

// ---- All Classes Table ----
let _allClassesCache = [];

function loadClassList() {
    const tbody = document.getElementById('cm-classes-tbody');
    if (!tbody) return;
    _allClassesCache = cmGetClasses();
    renderClassTable(_allClassesCache);
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

        return `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${cls.class_name}</strong></td>
            <td><span class="section-pill">${cls.section}</span></td>
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
        const response = await fetch('http://localhost:3000/api/teacher/all');
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
        // Fallback: show empty state
        select.innerHTML = '<option value="" disabled selected>Could not load teachers (server offline)</option>';
    }
}

function loadClassSelectForAssign() {
    const select = document.getElementById('at-class-select');
    if (!select) return;
    const classes = cmGetClasses();

    if (classes.length === 0) {
        select.innerHTML = '<option value="" disabled selected>No classes found — add a class first</option>';
        return;
    }

    select.innerHTML = '<option value="" disabled selected>Select a class...</option>' +
        classes.map(c => `<option value="${c.id}">${c.class_name} ${c.section} — ${c.subject} | ${cmFormatTime(c.start_time)}–${cmFormatTime(c.end_time)} | Room ${c.room_number}</option>`).join('');
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

    // Check if already assigned
    const alreadyAssigned = assignments.find(a => a.teacher_id === teacherId && a.class_id === classId);
    if (alreadyAssigned) {
        conflictDiv.style.display = 'flex';
        conflictMsg.textContent   = 'This teacher is already assigned to this class.';
        previewDiv.style.display  = 'none';
        if (assignBtn) assignBtn.disabled = true;
        return;
    }

    // Check time conflicts
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

        // Overlap: new starts before existing ends AND new ends after existing starts
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

    // No conflict — show preview
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

function handleAssignTeacher(event) {
    event.preventDefault();

    const teacherId   = document.getElementById('at-teacher-select').value;
    const classId     = document.getElementById('at-class-select').value;
    const teacherName = document.getElementById('at-teacher-select').selectedOptions[0]?.text.split(' — ')[0] || teacherId;

    // Re-run conflict check (safety guard)
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

    // Save assignment
    assignments.push({ teacher_id: teacherId, class_id: classId, teacher_name: teacherName });
    cmSaveAssignments(assignments);

    // Update class record with teacher name
    const classIdx = classes.findIndex(c => c.id === classId);
    if (classIdx !== -1) {
        classes[classIdx].assigned_teacher_id   = teacherId;
        classes[classIdx].assigned_teacher_name = teacherName;
    }
    cmSaveClasses(classes);

    showCmToast(`Teacher "${teacherName}" successfully assigned!`, 'success');
    document.getElementById('assign-teacher-form').reset();
    clearAssignPreview();
    loadTeachersForAssign();
    loadClassSelectForAssign();
    loadAssignmentsTable();
}

function removeAssignment(teacherId, classId) {
    if (!confirm('Remove this teacher assignment?')) return;

    let assignments = cmGetAssignments();
    assignments = assignments.filter(a => !(a.teacher_id === teacherId && a.class_id === classId));
    cmSaveAssignments(assignments);

    // Clear teacher from class record
    const classes = cmGetClasses();
    const idx = classes.findIndex(c => c.id === classId);
    if (idx !== -1) {
        classes[idx].assigned_teacher_id   = '';
        classes[idx].assigned_teacher_name = '';
    }
    cmSaveClasses(classes);

    showCmToast('Assignment removed.', 'success');
    loadAssignmentsTable();
    loadClassList();
    checkAssignConflict();
}

function loadAssignmentsTable() {
    const tbody = document.getElementById('at-assignments-tbody');
    if (!tbody) return;

    const assignments = cmGetAssignments();
    const classes     = cmGetClasses();

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
            <td><strong>${cls.class_name}</strong> <span class="section-pill">${cls.section}</span></td>
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

// ---- Toast Notification ----
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
