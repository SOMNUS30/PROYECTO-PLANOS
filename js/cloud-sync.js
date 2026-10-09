/* ==========================================================================
   ECOSOL PLANOS - Real-time Multi-Device Cloud Synchronization System
   ========================================================================== */

// Primary & Fallback Cloud Database Endpoints
const PRIMARY_CLOUD_DB = "https://crudcrud.com/api/9e68681e40f749a5af0380ea67e003a9";
const FIREBASE_CLOUD_DB = "https://ecosol-planos-app-default-rtdb.firebaseio.com";

let isSyncing = false;

function normalizeArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean);
    if (typeof data === "object") return Object.values(data).filter(Boolean);
    return [];
}

// 1. ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// 2. Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// 3. Upload Raw PDF Binary to Cloud Storage
async function syncPdfBinaryToCloud(docId, arrayBuffer) {
    try {
        const base64Data = arrayBufferToBase64(arrayBuffer);
        const payload = JSON.stringify({ docId: docId, base64: base64Data, updatedAt: new Date().toISOString() });
        
        await fetch(`${PRIMARY_CLOUD_DB}/pdf_binaries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload
        }).catch(() => null);

        await fetch(`${FIREBASE_CLOUD_DB}/pdf_binaries/${docId}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: payload
        }).catch(() => null);

        console.log("PDF Binario enviado a la nube para:", docId);
    } catch (err) {
        console.warn("Error al subir PDF a la nube:", err);
    }
}

// 4. Download Raw PDF Binary from Cloud Storage
async function fetchPdfBinaryFromCloud(docId) {
    try {
        // Try Primary Cloud DB
        let res = await fetch(`${PRIMARY_CLOUD_DB}/pdf_binaries`).catch(() => null);
        if (res && res.ok) {
            const list = await res.json();
            const found = list.find(item => item.docId === docId);
            if (found && found.base64) {
                const buffer = base64ToArrayBuffer(found.base64);
                if (window.savePdfBinary) await window.savePdfBinary(docId, buffer);
                return buffer;
            }
        }

        // Try Firebase Cloud DB
        res = await fetch(`${FIREBASE_CLOUD_DB}/pdf_binaries/${docId}.json`).catch(() => null);
        if (res && res.ok) {
            const data = await res.json();
            if (data && data.base64) {
                const buffer = base64ToArrayBuffer(data.base64);
                if (window.savePdfBinary) await window.savePdfBinary(docId, buffer);
                return buffer;
            }
        }
    } catch (err) {
        console.warn("Error al descargar PDF de la nube:", err);
    }
    return null;
}

// 5. Delete PDF Binary from Cloud
async function deletePdfBinaryFromCloud(docId) {
    try {
        await fetch(`${FIREBASE_CLOUD_DB}/pdf_binaries/${docId}.json`, { method: "DELETE" }).catch(() => null);
    } catch (err) {}
}

// 6. Sync Users Array to Cloud
async function syncUsersToCloud(users) {
    try {
        const payload = JSON.stringify(users);
        await fetch(`${FIREBASE_CLOUD_DB}/users.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: payload
        }).catch(() => null);

        // Also POST to primary REST DB if needed
        users.forEach(async (u) => {
            await fetch(`${PRIMARY_CLOUD_DB}/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(u)
            }).catch(() => null);
        });
    } catch (err) {
        console.warn("Error al sincronizar usuarios en la nube:", err);
    }
}

// 7. Sync Documents Array to Cloud
async function syncDocumentsToCloud(documents) {
    try {
        const payload = JSON.stringify(documents);
        await fetch(`${FIREBASE_CLOUD_DB}/documents.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: payload
        }).catch(() => null);
    } catch (err) {
        console.warn("Error al sincronizar documentos en la nube:", err);
    }
}

// 8. Sync Audit Logs Array to Cloud
async function syncAuditLogsToCloud(logs) {
    try {
        const payload = JSON.stringify(logs);
        await fetch(`${FIREBASE_CLOUD_DB}/audit_logs.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: payload
        }).catch(() => null);
    } catch (err) {
        console.warn("Error al sincronizar auditoría en la nube:", err);
    }
}

// 9. Fetch All Cloud Data and Sync Local Storage
async function fetchCloudData() {
    if (isSyncing) return;
    isSyncing = true;
    try {
        // Try Firebase & Primary REST endpoints
        let cloudUsers = [];
        let cloudDocs = [];
        let cloudLogs = [];

        // 1. Fetch Users
        let res = await fetch(`${FIREBASE_CLOUD_DB}/users.json`).catch(() => null);
        if (res && res.ok) {
            const raw = await res.json();
            cloudUsers = normalizeArray(raw);
        }
        if (cloudUsers.length === 0) {
            res = await fetch(`${PRIMARY_CLOUD_DB}/users`).catch(() => null);
            if (res && res.ok) {
                const raw = await res.json();
                cloudUsers = normalizeArray(raw);
            }
        }

        if (cloudUsers.length > 0) {
            localStorage.setItem("planos_users", JSON.stringify(cloudUsers));
            const savedSession = localStorage.getItem("planos_active_session");
            if (savedSession) {
                try {
                    const currentUser = JSON.parse(savedSession);
                    const updatedUser = cloudUsers.find(u => u.id === currentUser.id || u.username === currentUser.username);
                    if (updatedUser) {
                        localStorage.setItem("planos_active_session", JSON.stringify(updatedUser));
                    }
                } catch (e) {}
            }
        } else {
            const localUsers = JSON.parse(localStorage.getItem("planos_users") || "[]");
            if (localUsers.length > 0) syncUsersToCloud(localUsers);
        }

        // 2. Fetch Documents
        res = await fetch(`${FIREBASE_CLOUD_DB}/documents.json`).catch(() => null);
        if (res && res.ok) {
            const raw = await res.json();
            cloudDocs = normalizeArray(raw);
        }
        if (cloudDocs.length > 0) {
            localStorage.setItem("planos_documents", JSON.stringify(cloudDocs));
        } else {
            const localDocs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
            if (localDocs.length > 0) syncDocumentsToCloud(localDocs);
        }

        // 3. Fetch Audit Logs
        res = await fetch(`${FIREBASE_CLOUD_DB}/audit_logs.json`).catch(() => null);
        if (res && res.ok) {
            const raw = await res.json();
            cloudLogs = normalizeArray(raw);
        }
        if (cloudLogs.length > 0) {
            localStorage.setItem("planos_audit_logs", JSON.stringify(cloudLogs));
        } else {
            const localLogs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");
            if (localLogs.length > 0) syncAuditLogsToCloud(localLogs);
        }

        // Re-render UI views
        if (typeof updateUserUI === "function") updateUserUI();
        if (typeof renderDocumentsLibrary === "function") renderDocumentsLibrary();
        if (typeof renderAdminDashboard === "function") renderAdminDashboard();
        if (typeof renderAuditLogs === "function") renderAuditLogs();

    } catch (err) {
        console.warn("Error descargando datos de la nube:", err);
    } finally {
        isSyncing = false;
    }
}

// 10. Initialize Cloud Sync & Interval Polling
function initCloudSync() {
    fetchCloudData();
    setInterval(fetchCloudData, 4000);
    window.addEventListener("focus", fetchCloudData);
}
