/* ==========================================================================
   ECOSOL PLANOS - Render Server Central Backend Synchronizer
   ========================================================================== */

const API_BASE = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") || window.location.origin.includes("onrender.com")
    ? window.location.origin
    : "https://ecosol-planos.onrender.com";

let isSyncing = false;

// ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Upload Raw PDF Binary to Render Server
async function syncPdfBinaryToCloud(docId, arrayBuffer) {
    try {
        const base64Data = arrayBufferToBase64(arrayBuffer);
        await fetch(`${API_BASE}/api/upload_pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: docId, base64: base64Data })
        });
    } catch (err) {
        console.warn("Error enviando PDF al servidor Render:", err);
    }
}

// Download Raw PDF Binary from Render Server
async function fetchPdfBinaryFromCloud(docId) {
    try {
        const res = await fetch(`${API_BASE}/uploads/${docId}.pdf`);
        if (res.ok) {
            const buffer = await res.arrayBuffer();
            if (window.savePdfBinary) {
                await window.savePdfBinary(docId, buffer);
            }
            return buffer;
        }
    } catch (err) {
        console.warn("Error descargando PDF del servidor Render:", err);
    }
    return null;
}

// Sync Users Array to Render Server
async function syncUsersToCloud(users) {
    try {
        await fetch(`${API_BASE}/api/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(users)
        });
    } catch (err) {}
}

// Sync Documents Array to Render Server
async function syncDocumentsToCloud(documents) {
    try {
        await fetch(`${API_BASE}/api/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(documents)
        });
    } catch (err) {}
}

// Sync Audit Logs Array to Render Server
async function syncAuditLogsToCloud(logs) {
    try {
        await fetch(`${API_BASE}/api/audit_logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(logs)
        });
    } catch (err) {}
}

// Fetch All Central Data from Render Server
async function fetchCloudData() {
    if (isSyncing) return;
    isSyncing = true;
    try {
        const [usersRes, docsRes, logsRes] = await Promise.all([
            fetch(`${API_BASE}/api/users`).catch(() => null),
            fetch(`${API_BASE}/api/documents`).catch(() => null),
            fetch(`${API_BASE}/api/audit_logs`).catch(() => null)
        ]);

        if (usersRes && usersRes.ok) {
            const cloudUsers = await usersRes.json();
            if (Array.isArray(cloudUsers) && cloudUsers.length > 0) {
                localStorage.setItem("planos_users", JSON.stringify(cloudUsers));
            }
        }

        if (docsRes && docsRes.ok) {
            const cloudDocs = await docsRes.json();
            if (Array.isArray(cloudDocs) && cloudDocs.length > 0) {
                localStorage.setItem("planos_documents", JSON.stringify(cloudDocs));
            }
        }

        if (logsRes && logsRes.ok) {
            const cloudLogs = await logsRes.json();
            if (Array.isArray(cloudLogs) && cloudLogs.length > 0) {
                localStorage.setItem("planos_audit_logs", JSON.stringify(cloudLogs));
            }
        }

        // Refresh UI
        if (typeof updateUserUI === "function") updateUserUI();
        if (typeof renderDocumentsLibrary === "function") renderDocumentsLibrary();
        if (typeof renderAdminDashboard === "function") renderAdminDashboard();
        if (typeof renderAuditLogs === "function") renderAuditLogs();

    } catch (err) {
    } finally {
        isSyncing = false;
    }
}

function initCloudSync() {
    fetchCloudData();
    setInterval(fetchCloudData, 5000);
    window.addEventListener("focus", fetchCloudData);
}
