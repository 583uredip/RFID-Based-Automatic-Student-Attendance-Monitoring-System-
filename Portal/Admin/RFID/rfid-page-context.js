/**
 * rfid-page-context.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Include this script in every Student Management page (and any other page
 * where you do NOT want the RFID reader to log attendance automatically).
 *
 * How it works:
 *  - Every 4 seconds it POSTs a heartbeat to /api/rfid/page-context so the
 *    server knows a Student Management page is open.
 *  - On page unload (or tab hidden) it sends a DELETE to clear the context so
 *    the RFID reader goes back to attendance mode instantly.
 *  - The server auto-expires the context after 6 seconds of no heartbeat
 *    (e.g. if the user closes the tab without firing the unload event).
 *
 * Usage — add ONE line near the end of <body> in each Student Mgmt HTML file:
 *   <script src="../RFID/rfid-page-context.js" data-page-name="Edit Student"></script>
 *
 * The data-page-name attribute is optional; it sets the label shown on the
 * RFID reader OLED display.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
    const SERVER = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.includes('http'))
        ? window.location.origin
        : 'http://localhost:3000';
    const ENDPOINT = SERVER + '/api/rfid/page-context';
    const HEARTBEAT_MS = 4000; // must be less than PAGE_CONTEXT_EXPIRE_MS (6000) on server

    // Derive a nice page name from the script tag's data attribute or the page title
    const scriptTag = document.currentScript;
    const pageName = (scriptTag && scriptTag.dataset.pageName)
        ? scriptTag.dataset.pageName
        : (document.title || 'Student Management');

    let heartbeatTimer = null;
    let active = false;

    // ── Send heartbeat ───────────────────────────────────────────────────────
    function sendHeartbeat() {
        fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 'student_management', pageName }),
            keepalive: true   // works even during page unload
        }).catch(() => { /* silent — offline or server down */ });
    }

    // ── Clear context (call when leaving the page) ───────────────────────────
    function clearContext() {
        if (!active) return;
        active = false;
        clearInterval(heartbeatTimer);
        // Use keepalive so the request survives a page navigation
        fetch(ENDPOINT, { method: 'DELETE', keepalive: true })
            .catch(() => {});
    }

    // ── Start heartbeat ──────────────────────────────────────────────────────
    function startHeartbeat() {
        if (active) return;
        active = true;
        sendHeartbeat();                              // immediate first beat
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    }

    // ── Visibility-aware logic ───────────────────────────────────────────────
    // Stop heartbeat when tab is hidden (user switches to another tab)
    // so the RFID reader can take attendance while the tab is in background.
    function handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            startHeartbeat();
        } else {
            clearContext();
        }
    }

    // ── Wire up events ───────────────────────────────────────────────────────
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clear on navigation away / tab close
    window.addEventListener('beforeunload', clearContext);
    window.addEventListener('pagehide', clearContext);

    // Start immediately if the page is already visible
    if (document.visibilityState === 'visible') {
        startHeartbeat();
    }

    // ── Expose for manual control (optional) ────────────────────────────────
    window.rfidPageContext = { start: startHeartbeat, stop: clearContext };
})();
