/* ==========================================================================
   ECOSOL PLANOS - Render Server Central Backend Synchronizer
   ========================================================================== */

const RENDER_BACKEND = "https://proyecto-planos.onrender.com";

const API_BASE = (window.location.origin && window.location.origin.includes("onrender.com"))
    ? window.location.origin
    : RENDER_BACKEND;

let isSyncing = false;

// ArrayBuffer to Base64 (Chunked to prevent call stack limits)
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return window.btoa(binary);
}
window.arrayBufferToBase64 = arrayBufferToBase64;

// Upload Raw PDF Binary to Render Server
async function syncPdfBinaryToCloud(docId, arrayBuffer) {
    try {
        // Send raw binary ArrayBuffer directly for ultra-fast, lightweight upload
        const res = await fetch(`${API_BASE}/api/upload_pdf?docId=${docId}`, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: arrayBuffer
        });
        if (res.ok) {
            console.log("PDF binario subido y guardado exitosamente en Render:", docId);
        } else {
            // Fallback to Base64 payload if raw binary POST is blocked
            const base64Data = arrayBufferToBase64(arrayBuffer);
            await fetch(`${API_BASE}/api/upload_pdf`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docId: docId, base64: base64Data })
            });
        }
    } catch (err) {
        console.warn("Error enviando PDF al servidor Render:", err);
    }
}

// Download Raw PDF Binary from Render Server
async function fetchPdfBinaryFromCloud(docId) {
    try {
        let res = await fetch(`${API_BASE}/api/pdf_binary/${docId}`);
        if (!res.ok) {
            res = await fetch(`${API_BASE}/uploads/${docId}.pdf`);
        }
        if (res.ok) {
            const buffer = await res.arrayBuffer();
            if (buffer && buffer.byteLength > 0) {
                if (window.savePdfBinary) {
                    await window.savePdfBinary(docId, buffer);
                }
                return buffer;
            }
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
        // Strip large inline pdfDataUrl from metadata payload so /api/documents stays lightweight & fast (~20KB)
        const cleanDocs = documents.map(doc => {
            const { pdfDataUrl, ...rest } = doc;
            return rest;
        });
        await fetch(`${API_BASE}/api/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanDocs)
        });
    } catch (err) {
        console.warn("Error enviando lista de documentos a Render:", err);
    }
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

// Delete Raw PDF Binary from Render Server
async function deletePdfBinaryFromCloud(docId) {
    try {
        await fetch(`${API_BASE}/api/delete_pdf?docId=${docId}`, {
            method: "DELETE"
        });
    } catch (err) {
        console.warn("Error eliminando PDF del servidor Render:", err);
    }
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
            if (Array.isArray(cloudDocs)) {
                const localDocs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
                const deletedIds = JSON.parse(localStorage.getItem("planos_deleted_docs") || "[]");

                const docMap = new Map();

                // 1. Keep local documents that were not explicitly deleted by admin
                localDocs.forEach(d => {
                    if (d && d.id && !deletedIds.includes(d.id)) {
                        docMap.set(d.id, d);
                    }
                });

                // 2. Merge cloud documents
                cloudDocs.forEach(cDoc => {
                    if (!cDoc || !cDoc.id || deletedIds.includes(cDoc.id)) return;
                    if (!docMap.has(cDoc.id)) {
                        docMap.set(cDoc.id, cDoc);
                    } else {
                        const localDoc = docMap.get(cDoc.id);
                        const localTime = new Date(localDoc.lastEditedAt || localDoc.uploadedAt || 0).getTime();
                        const cloudTime = new Date(cDoc.lastEditedAt || cDoc.uploadedAt || 0).getTime();
                        
                        const mergedAnnotations = (cDoc.annotations && cDoc.annotations.length >= (localDoc.annotations?.length || 0))
                            ? cDoc.annotations
                            : (localDoc.annotations || []);

                        docMap.set(cDoc.id, {
                            ...localDoc,
                            ...cDoc,
                            annotations: mergedAnnotations,
                            lastEditedAt: cloudTime > localTime ? cDoc.lastEditedAt : localDoc.lastEditedAt,
                            editsCount: Math.max(localDoc.editsCount || 0, cDoc.editsCount || 0)
                        });
                    }
                });

                const mergedDocs = Array.from(docMap.values());
                localStorage.setItem("planos_documents", JSON.stringify(mergedDocs));

                // If local had uploaded docs that cloud server didn't have yet, push them to cloud
                if (mergedDocs.length > cloudDocs.length) {
                    syncDocumentsToCloud(mergedDocs);
                }
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
