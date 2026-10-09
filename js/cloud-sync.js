/* ==========================================================================
   ECOSOL PLANOS - Firebase Realtime Cloud Engine & PDF Binary Storage
   ========================================================================== */

const CLOUD_DB_URL = "https://ecosol-planos-app-default-rtdb.firebaseio.com";

let isSyncing = false;

// 1. ArrayBuffer to Base64 String
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// 2. Base64 String to ArrayBuffer
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
        await fetch(`${CLOUD_DB_URL}/pdf_binaries/${docId}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: base64Data, updatedAt: new Date().toISOString() })
        });
        console.log("PDF Binario sincronizado en la nube para:", docId);
    } catch (err) {
        console.warn("Error al subir PDF a la nube:", err);
    }
}

// 4. Download Raw PDF Binary from Cloud Storage
async function fetchPdfBinaryFromCloud(docId) {
    try {
        const res = await fetch(`${CLOUD_DB_URL}/pdf_binaries/${docId}.json`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.base64) {
                const buffer = base64ToArrayBuffer(data.base64);
                // Save locally to IndexedDB for fast subsequent renders
                if (window.savePdfBinary) {
                    await window.savePdfBinary(docId, buffer);
                }
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
        await fetch(`${CLOUD_DB_URL}/pdf_binaries/${docId}.json`, {
            method: "DELETE"
        });
    } catch (err) {
        console.warn("Error al eliminar PDF de la nube:", err);
    }
}

// 6. Sync Users Array to Cloud
async function syncUsersToCloud(users) {
    try {
        await fetch(`${CLOUD_DB_URL}/users.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(users)
        });
    } catch (err) {
        console.warn("Error al sincronizar usuarios en la nube:", err);
    }
}

// 7. Sync Documents Array to Cloud
async function syncDocumentsToCloud(documents) {
    try {
        await fetch(`${CLOUD_DB_URL}/documents.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(documents)
        });
    } catch (err) {
        console.warn("Error al sincronizar documentos en la nube:", err);
    }
}

// 8. Sync Audit Logs Array to Cloud
async function syncAuditLogsToCloud(logs) {
    try {
        await fetch(`${CLOUD_DB_URL}/audit_logs.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(logs)
        });
    } catch (err) {
        console.warn("Error al sincronizar auditoría en la nube:", err);
    }
}

// 9. Fetch All Cloud Data and Sync Local Storage
async function fetchCloudData() {
    if (isSyncing) return;
    isSyncing = true;
    try {
        const [usersRes, docsRes, logsRes] = await Promise.all([
            fetch(`${CLOUD_DB_URL}/users.json`),
            fetch(`${CLOUD_DB_URL}/documents.json`),
            fetch(`${CLOUD_DB_URL}/audit_logs.json`)
        ]);

        if (usersRes.ok) {
            const cloudUsers = await usersRes.json();
            if (cloudUsers && Array.isArray(cloudUsers) && cloudUsers.length > 0) {
                localStorage.setItem("planos_users", JSON.stringify(cloudUsers));
                
                const savedSession = localStorage.getItem("planos_active_session");
                if (savedSession) {
                    try {
                        const currentUser = JSON.parse(savedSession);
                        const updatedUser = cloudUsers.find(u => u.id === currentUser.id);
                        if (updatedUser) {
                            localStorage.setItem("planos_active_session", JSON.stringify(updatedUser));
                        }
                    } catch (e) {}
                }
            } else {
                const localUsers = JSON.parse(localStorage.getItem("planos_users") || "[]");
                if (localUsers.length > 0) syncUsersToCloud(localUsers);
            }
        }

        if (docsRes.ok) {
            const cloudDocs = await docsRes.json();
            if (cloudDocs && Array.isArray(cloudDocs) && cloudDocs.length > 0) {
                localStorage.setItem("planos_documents", JSON.stringify(cloudDocs));
            } else {
                const localDocs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
                if (localDocs.length > 0) syncDocumentsToCloud(localDocs);
            }
        }

        if (logsRes.ok) {
            const cloudLogs = await logsRes.json();
            if (cloudLogs && Array.isArray(cloudLogs) && cloudLogs.length > 0) {
                localStorage.setItem("planos_audit_logs", JSON.stringify(cloudLogs));
            } else {
                const localLogs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");
                if (localLogs.length > 0) syncAuditLogsToCloud(localLogs);
            }
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

    // Refresh every 5 seconds across devices
    setInterval(fetchCloudData, 5000);

    // Refresh on focus
    window.addEventListener("focus", fetchCloudData);
}
