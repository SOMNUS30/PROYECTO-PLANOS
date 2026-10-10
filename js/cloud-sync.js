/* ==========================================================================
   ECOSOL PLANOS - Supabase Cloud Synchronizer (100% Serverless & Realtime)
   ========================================================================== */

let isSyncing = false;
let realtimeChannel = null;

// Helper: ArrayBuffer to Base64
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

// 1. Upload Raw PDF Binary directly to Supabase Storage
async function syncPdfBinaryToCloud(docId, arrayBuffer) {
    if (!window.supabaseClient) {
        console.warn("Supabase no inicializado, omitiendo subida a la nube.");
        return null;
    }
    try {
        const fileBlob = new Blob([arrayBuffer], { type: "application/pdf" });
        const filePath = `${docId}.pdf`;

        const { data, error } = await window.supabaseClient.storage
            .from("planos")
            .upload(filePath, fileBlob, {
                contentType: "application/pdf",
                upsert: true
            });

        if (error) {
            console.warn("Error subiendo PDF a Supabase Storage:", error.message || error);
            return null;
        }

        const { data: publicUrlData } = window.supabaseClient.storage
            .from("planos")
            .getPublicUrl(filePath);

        const publicUrl = publicUrlData ? publicUrlData.publicUrl : "";
        console.log("PDF guardado permanentemente en Supabase Storage:", docId, publicUrl);
        return publicUrl;
    } catch (err) {
        console.warn("Error enviando PDF a Supabase Storage:", err);
        return null;
    }
}
window.syncPdfBinaryToCloud = syncPdfBinaryToCloud;

// 2. Download Raw PDF Binary directly from Supabase Storage
async function fetchPdfBinaryFromCloud(docId) {
    if (!window.supabaseClient) return null;
    try {
        const filePath = `${docId}.pdf`;
        const { data, error } = await window.supabaseClient.storage
            .from("planos")
            .download(filePath);

        if (error || !data) {
            console.warn("PDF no encontrado en Supabase Storage:", error?.message || "Sin datos");
            return null;
        }

        const buffer = await data.arrayBuffer();
        if (buffer && buffer.byteLength > 0) {
            if (window.savePdfBinary) {
                await window.savePdfBinary(docId, buffer);
            }
            return buffer;
        }
    } catch (err) {
        console.warn("Error descargando PDF de Supabase Storage:", err);
    }
    return null;
}
window.fetchPdfBinaryFromCloud = fetchPdfBinaryFromCloud;

// 3. Delete Raw PDF Binary from Supabase Storage
async function deletePdfBinaryFromCloud(docId) {
    if (!window.supabaseClient) return;
    try {
        const filePath = `${docId}.pdf`;
        const { error } = await window.supabaseClient.storage
            .from("planos")
            .remove([filePath]);

        if (error) {
            console.warn("Error eliminando PDF en Supabase Storage:", error.message || error);
        } else {
            console.log("PDF eliminado de Supabase Storage:", docId);
        }
    } catch (err) {
        console.warn("Error en deletePdfBinaryFromCloud:", err);
    }
}
window.deletePdfBinaryFromCloud = deletePdfBinaryFromCloud;

// 4. Sync Users Array to Supabase Database (profiles table)
async function syncUsersToCloud(users) {
    if (!window.supabaseClient || !Array.isArray(users)) return;
    try {
        const rows = users.map(user => ({
            id: String(user.id),
            username: user.username,
            name: user.name,
            email: user.email,
            password: user.passwordHash || user.password || "",
            role: user.role || "USER",
            status: user.status || "ACTIVE",
            avatar_url: user.avatarUrl || null,
            created_at: user.createdAt || new Date().toISOString(),
            last_login: user.lastLogin || new Date().toISOString(),
            edits_count: user.editsCount || 0
        }));

        const { error } = await window.supabaseClient
            .from("profiles")
            .upsert(rows, { onConflict: "id" });

        if (error) {
            console.warn("Error sincronizando perfiles en Supabase:", error.message || error);
        }
    } catch (err) {
        console.warn("Error en syncUsersToCloud:", err);
    }
}
window.syncUsersToCloud = syncUsersToCloud;

// 5. Sync Documents Array to Supabase Database (documents table)
async function syncDocumentsToCloud(documents) {
    if (!window.supabaseClient || !Array.isArray(documents)) return;
    try {
        const rows = documents.map(doc => {
            let storageUrl = doc.pdfUrl || "";
            if (!storageUrl && window.supabaseClient) {
                const { data } = window.supabaseClient.storage.from("planos").getPublicUrl(`${doc.id}.pdf`);
                if (data) storageUrl = data.publicUrl;
            }

            return {
                id: String(doc.id),
                name: doc.name,
                file_size: doc.fileSize || null,
                sample_type: doc.sampleType || "blueprint-arch",
                pdf_url: storageUrl,
                thumbnail_url: doc.thumbnailUrl || null,
                annotations: doc.annotations || [],
                uploaded_by: doc.uploadedBy ? String(doc.uploadedBy) : null,
                uploaded_by_name: doc.uploadedByName || null,
                uploaded_at: doc.uploadedAt || new Date().toISOString(),
                last_edited_at: doc.lastEditedAt || new Date().toISOString(),
                edits_count: doc.editsCount || 0
            };
        });

        const { error } = await window.supabaseClient
            .from("documents")
            .upsert(rows, { onConflict: "id" });

        if (error) {
            console.warn("Error sincronizando documentos en Supabase:", error.message || error);
        }
    } catch (err) {
        console.warn("Error en syncDocumentsToCloud:", err);
    }
}
window.syncDocumentsToCloud = syncDocumentsToCloud;

// 6. Sync Audit Logs Array to Supabase Database (audit_logs table)
async function syncAuditLogsToCloud(logs) {
    if (!window.supabaseClient || !Array.isArray(logs)) return;
    try {
        const rows = logs.slice(0, 100).map(log => ({
            id: String(log.id),
            timestamp: log.timestamp || new Date().toISOString(),
            username: log.username || "invitado",
            user_role: log.userRole || "DESCONOCIDO",
            action_type: log.actionType || "INFO",
            description: log.description || "",
            details: log.details || null
        }));

        const { error } = await window.supabaseClient
            .from("audit_logs")
            .upsert(rows, { onConflict: "id" });

        if (error) {
            console.warn("Error sincronizando audit_logs en Supabase:", error.message || error);
        }
    } catch (err) {
        console.warn("Error en syncAuditLogsToCloud:", err);
    }
}
window.syncAuditLogsToCloud = syncAuditLogsToCloud;

// 7. Fetch All Central Data from Supabase Database
async function fetchCloudData() {
    if (!window.supabaseClient || isSyncing) return;
    isSyncing = true;
    try {
        const [usersRes, docsRes, logsRes] = await Promise.all([
            window.supabaseClient.from("profiles").select("*"),
            window.supabaseClient.from("documents").select("*"),
            window.supabaseClient.from("audit_logs").select("*").order("timestamp", { ascending: false }).limit(100)
        ]);

        // 1. Process Users / Profiles
        if (usersRes && !usersRes.error && Array.isArray(usersRes.data)) {
            if (usersRes.data.length === 0 && typeof INITIAL_USERS !== "undefined") {
                // Auto-seed initial users if table is empty
                console.log("Sembrando usuarios iniciales en Supabase...");
                await syncUsersToCloud(INITIAL_USERS);
            } else if (usersRes.data.length > 0) {
                const mappedUsers = usersRes.data.map(u => ({
                    id: u.id,
                    username: u.username,
                    name: u.name,
                    email: u.email,
                    passwordHash: u.password,
                    role: u.role,
                    status: u.status,
                    avatarUrl: u.avatar_url,
                    createdAt: u.created_at,
                    lastLogin: u.last_login,
                    editsCount: u.edits_count || 0
                }));
                localStorage.setItem("planos_users", JSON.stringify(mappedUsers));
            }
        }

        // 2. Process Documents
        if (docsRes && !docsRes.error && Array.isArray(docsRes.data)) {
            if (docsRes.data.length === 0 && typeof INITIAL_DOCUMENTS !== "undefined") {
                // Auto-seed initial sample blueprints if table is empty
                console.log("Sembrando planos iniciales en Supabase...");
                await syncDocumentsToCloud(INITIAL_DOCUMENTS);
            } else if (docsRes.data.length > 0) {
                const mappedDocs = docsRes.data.map(d => ({
                    id: d.id,
                    name: d.name,
                    fileSize: d.file_size || "1.5 MB",
                    sampleType: d.sample_type || "blueprint-arch",
                    pdfUrl: d.pdf_url || "",
                    thumbnailUrl: d.thumbnail_url || null,
                    annotations: Array.isArray(d.annotations) ? d.annotations : [],
                    uploadedBy: d.uploaded_by || "anónimo",
                    uploadedByName: d.uploaded_by_name || "Usuario",
                    uploadedAt: d.uploaded_at,
                    lastEditedAt: d.last_edited_at,
                    editsCount: d.edits_count || 0,
                    hasBinary: true
                }));
                localStorage.setItem("planos_documents", JSON.stringify(mappedDocs));
            }
        }

        // 3. Process Audit Logs
        if (logsRes && !logsRes.error && Array.isArray(logsRes.data)) {
            if (logsRes.data.length === 0 && typeof INITIAL_AUDIT_LOGS !== "undefined") {
                console.log("Sembrando logs iniciales en Supabase...");
                await syncAuditLogsToCloud(INITIAL_AUDIT_LOGS);
            } else if (logsRes.data.length > 0) {
                const mappedLogs = logsRes.data.map(l => ({
                    id: l.id,
                    timestamp: l.timestamp,
                    username: l.username,
                    userRole: l.user_role,
                    actionType: l.action_type,
                    description: l.description,
                    details: l.details || ""
                }));
                localStorage.setItem("planos_audit_logs", JSON.stringify(mappedLogs));
            }
        }

        // Refresh UI components
        if (typeof updateUserUI === "function") updateUserUI();
        if (typeof renderDocumentsLibrary === "function") renderDocumentsLibrary();
        if (typeof renderAdminDashboard === "function") renderAdminDashboard();
        if (typeof renderAuditLogs === "function") renderAuditLogs();

    } catch (err) {
        console.warn("Error sincronizando datos con Supabase:", err);
    } finally {
        isSyncing = false;
    }
}
window.fetchCloudData = fetchCloudData;

// 8. Realtime Channel Subscription & Lifecycle Initializer
function initCloudSync() {
    fetchCloudData();

    // Setup Supabase Realtime for instant multi-user synchronization
    if (window.supabaseClient && !realtimeChannel) {
        try {
            realtimeChannel = window.supabaseClient
                .channel("realtime-planos-sync")
                .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => {
                    console.log("Cambio detectado en documentos vía Supabase Realtime");
                    fetchCloudData();
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
                    console.log("Cambio detectado en perfiles vía Supabase Realtime");
                    fetchCloudData();
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "audit_logs" }, () => {
                    console.log("Cambio detectado en auditoría vía Supabase Realtime");
                    fetchCloudData();
                })
                .subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                        console.log("Canal Supabase Realtime suscrito con éxito.");
                    }
                });
        } catch (e) {
            console.warn("No se pudo iniciar canal Realtime de Supabase:", e);
        }
    }

    // Refresh on window focus (efficient, no spammy 5s polling needed)
    window.addEventListener("focus", fetchCloudData);
    
    // Periodic safety check every 30 seconds
    setInterval(fetchCloudData, 30000);
}
window.initCloudSync = initCloudSync;
