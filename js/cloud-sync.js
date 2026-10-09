/* ==========================================================================
   ECOSOL PLANOS - Cloud Sync Module (Real-time Cloud Database Integration)
   ========================================================================== */

const CLOUD_DB_URL = "https://ecosol-planos-app-default-rtdb.firebaseio.com";

let isSyncing = false;

// Sync Users to Cloud
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

// Sync Documents to Cloud
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

// Sync Audit Logs to Cloud
async function syncAuditLogsToCloud(logs) {
    try {
        await fetch(`${CLOUD_DB_URL}/audit_logs.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(logs)
        });
    } catch (err) {
        console.warn("Error al sincronizar historial de auditoría en la nube:", err);
    }
}

// Fetch Latest Data from Cloud & Merge LocalStorage
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
                
                // Update active user session if profile changed in cloud
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
                // If cloud is empty, seed initial users to cloud
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

        // Re-render UI views if visible
        if (typeof updateUserUI === "function") updateUserUI();
        if (typeof renderDocumentsLibrary === "function") renderDocumentsLibrary();
        if (typeof renderAdminDashboard === "function") renderAdminDashboard();
        if (typeof renderAuditLogs === "function") renderAuditLogs();

    } catch (err) {
        console.warn("Error al descargar datos de la nube:", err);
    } finally {
        isSyncing = false;
    }
}

// Initialize Cloud Sync & Background Refresh
function initCloudSync() {
    // Initial fetch from cloud
    fetchCloudData();

    // Auto refresh every 6 seconds across devices
    setInterval(fetchCloudData, 6000);

    // Refresh when window gains focus
    window.addEventListener("focus", fetchCloudData);
}
