/* ==========================================================================
   PlanosDoc Pro - Main Application Router & Event Handlers
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Theme (Default White / Light Theme)
    initTheme();

    // Initialize Real-time Cloud Sync across all devices
    if (typeof initCloudSync === "function") initCloudSync();

    // Initialize Lucide Icons
    if (window.lucide) lucide.createIcons();

    // Check Active Session
    checkSessionOnLoad();

    // Init Engine
    initPdfEditorEngine();

    // Render Initial Views
    renderDocumentsLibrary();

    // Setup Drag and Drop
    setupDropzone();

    // Attach click listeners to all nav items for reliable navigation
    document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const viewId = btn.getAttribute("data-view");
            if (viewId) navigateTo(viewId);
        });
    });
});

// View Navigation Router
function navigateTo(viewId) {
    // Check permission for admin views
    const user = getCurrentUser();
    if ((viewId === 'admin-users' || viewId === 'admin-audit') && user?.role !== 'ADMIN') {
        showToast("Acceso restringido solo a Administradores.", "error");
        return;
    }

    // Always exit fullscreen mode when navigating to any section
    const editorView = document.getElementById("view-editor");
    if (editorView && editorView.classList.contains("fullscreen")) {
        editorView.classList.remove("fullscreen");
        const fsIcon = document.getElementById("fullscreen-toggle-icon");
        if (fsIcon) fsIcon.setAttribute("data-lucide", "expand");
    }

    // Hide all views and show target view
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active-view"));
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) {
        targetView.classList.add("active-view");
    }

    // Highlight active sidebar item
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.dataset.view === viewId) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    // Update Header Title & Layout Mode
    const titleEl = document.getElementById("page-title");
    if (viewId === "documents") {
        document.body.classList.remove("in-editor-mode");
        if (titleEl) titleEl.innerHTML = `<i data-lucide="folder-open"></i> Mis Documentos y Planos`;
        if (window.renderDocumentsLibrary) renderDocumentsLibrary();
    } else if (viewId === "editor") {
        document.body.classList.add("in-editor-mode");
        if (titleEl) titleEl.innerHTML = `<i data-lucide="edit-3"></i> Editor de PDF & Formas de Colores`;
        
        // Auto-load a document if none is active
        if (typeof activeDocument !== "undefined" && !activeDocument) {
            const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
            if (docs.length > 0) {
                loadDocumentInEditor(docs[0].id);
            }
        }
    } else if (viewId === "admin-users") {
        document.body.classList.remove("in-editor-mode");
        if (titleEl) titleEl.innerHTML = `<i data-lucide="users"></i> Gestión de Usuarios & Permisos`;
        if (window.renderAdminDashboard) renderAdminDashboard();
    } else if (viewId === "admin-audit") {
        document.body.classList.remove("in-editor-mode");
        if (titleEl) titleEl.innerHTML = `<i data-lucide="shield-alert"></i> Historial de Auditoría & Conexiones`;
        if (window.renderAuditLogs) renderAuditLogs();
    }

    if (window.lucide) lucide.createIcons();
}

// DOCUMENTS LIBRARY RENDERER
let activeDocFilter = 'all';

function getSampleBlueprintThumbnail(sampleType) {
    if (sampleType === 'blueprint-elec') {
        return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220" style="background:%230f172a;"><rect x="15" y="15" width="330" height="190" fill="none" stroke="%233b82f6" stroke-width="2"/><line x1="15" y1="110" x2="345" y2="110" stroke="%233b82f6" stroke-width="1.5" stroke-dasharray="6,6"/><circle cx="180" cy="110" r="35" fill="none" stroke="%2360a5fa" stroke-width="2"/><text x="30" y="45" fill="%2393c5fd" font-family="sans-serif" font-size="13" font-weight="bold">PLANO ELÉCTRICO UNIFILAR</text></svg>`;
    } else if (sampleType === 'blueprint-struct') {
        return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220" style="background:%230f172a;"><rect x="15" y="15" width="330" height="190" fill="none" stroke="%23f59e0b" stroke-width="2"/><rect x="45" y="55" width="90" height="120" fill="none" stroke="%23f59e0b" stroke-width="1.5"/><rect x="225" y="55" width="90" height="120" fill="none" stroke="%23f59e0b" stroke-width="1.5"/><text x="30" y="45" fill="%23fcd34d" font-family="sans-serif" font-size="13" font-weight="bold">DETALLE DE CIMENTACIONES</text></svg>`;
    } else {
        return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220" style="background:%230f172a;"><rect x="15" y="15" width="330" height="190" fill="none" stroke="%2394a3b8" stroke-width="2"/><line x1="160" y1="15" x2="160" y2="205" stroke="%2394a3b8" stroke-width="1.5"/><line x1="160" y1="120" x2="345" y2="120" stroke="%2394a3b8" stroke-width="1.5"/><text x="30" y="45" fill="%23cbd5e1" font-family="sans-serif" font-size="13" font-weight="bold">PLANO ARQUITECTÓNICO</text></svg>`;
    }
}

function renderDocumentsLibrary() {
    const container = document.getElementById("docs-container");
    if (!container) return;

    let docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
    const user = getCurrentUser();

    document.getElementById("badge-doc-count").textContent = docs.length;
    document.getElementById("count-all-docs").textContent = docs.length;

    if (activeDocFilter === 'my' && user) {
        docs = docs.filter(d => d.uploadedBy === user.username);
    } else if (activeDocFilter === 'edited') {
        docs = docs.filter(d => (d.editsCount || 0) > 0);
    }

    container.innerHTML = "";

    if (docs.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding: 40px;" class="glass-panel">
                <i data-lucide="file-x" style="width:48px; height:48px; color:var(--text-muted); margin-bottom:12px;"></i>
                <h3>No hay documentos en esta sección</h3>
                <p style="color:var(--text-muted);">Sube tu primer plano o documento PDF utilizando el botón superior.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    docs.forEach(doc => {
        const card = document.createElement("div");
        card.className = "doc-card";

        const formattedDate = formatDateShort(doc.lastEditedAt || doc.uploadedAt);
        const iconType = doc.sampleType === 'blueprint-elec' ? 'zap' : (doc.sampleType === 'blueprint-struct' ? 'grid' : 'layout');

        // Render Thumbnail Preview
        let thumbContent = "";
        if (doc.thumbnailUrl) {
            thumbContent = `<img src="${doc.thumbnailUrl}" alt="${doc.name}" class="doc-preview-img" style="width:100%; height:100%; object-fit:cover;" />`;
        } else if (doc.sampleType) {
            const sampleThumb = getSampleBlueprintThumbnail(doc.sampleType);
            thumbContent = `<img src="${sampleThumb}" alt="${doc.name}" class="doc-preview-img" style="width:100%; height:100%; object-fit:cover;" />`;
        } else {
            thumbContent = `<i data-lucide="${iconType}"></i>`;

            // Asynchronously generate thumbnail for binary docs if not cached yet
            if (window.getPdfBinary && window.generatePdfThumbnail && (doc.hasBinary || doc.pdfDataUrl)) {
                setTimeout(async () => {
                    let buffer = await getPdfBinary(doc.id);
                    if (!buffer && doc.pdfDataUrl) {
                        buffer = await fetch(doc.pdfDataUrl).then(res => res.arrayBuffer()).catch(() => null);
                    }
                    if (buffer) {
                        const thumb = await generatePdfThumbnail(buffer);
                        if (thumb) {
                            doc.thumbnailUrl = thumb;
                            const allDocs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
                            const dIdx = allDocs.findIndex(d => d.id === doc.id);
                            if (dIdx !== -1) {
                                allDocs[dIdx].thumbnailUrl = thumb;
                                saveDocumentsToStorage(allDocs);
                            }
                            const thumbEl = card.querySelector(".doc-thumbnail");
                            if (thumbEl) {
                                thumbEl.innerHTML = `
                                    <img src="${thumb}" alt="${doc.name}" class="doc-preview-img" style="width:100%; height:100%; object-fit:cover;" />
                                    <span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.7); padding:2px 8px; border-radius:4px; font-size:0.7rem; color:#fff;">${doc.fileSize || '2 MB'}</span>
                                `;
                            }
                        }
                    }
                }, 100);
            }
        }

        card.innerHTML = `
            <div class="doc-thumbnail" style="cursor: pointer;" onclick="loadDocumentInEditor('${doc.id}')">
                ${thumbContent}
                <span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.7); padding:2px 8px; border-radius:4px; font-size:0.7rem; color:#fff;">${doc.fileSize || '2 MB'}</span>
            </div>
            <div class="doc-info" style="cursor: pointer;" onclick="loadDocumentInEditor('${doc.id}')">
                <h4 title="${doc.name}">${doc.name}</h4>
                <div class="doc-meta">
                    <span><i data-lucide="user" style="width:12px;"></i> Subido por: ${doc.uploadedByName || doc.uploadedBy}</span>
                    <span><i data-lucide="clock" style="width:12px;"></i> Modificado: ${formattedDate}</span>
                    <span><i data-lucide="layers" style="width:12px;"></i> ${doc.annotations ? doc.annotations.length : 0} formas agregadas</span>
                </div>
            </div>
            <div class="doc-actions">
                <button class="btn btn-primary btn-sm btn-block" onclick="loadDocumentInEditor('${doc.id}')">
                    <i data-lucide="edit-2"></i> Abrir & Editar
                </button>
                <button class="btn btn-icon btn-sm btn-outline-danger" title="Eliminar Plano" onclick="deleteDocument('${doc.id}')">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        container.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

function filterDocs(filterType) {
    activeDocFilter = filterType;
    document.querySelectorAll(".filter-tab").forEach(tab => tab.classList.remove("active"));
    event.target.classList.add("active");
    renderDocumentsLibrary();
}

function deleteDocument(docId) {
    if (!confirm("¿Deseas eliminar este plano? Esta acción no se puede deshacer.")) return;

    let docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
    const docToDelete = docs.find(d => d.id === docId);
    docs = docs.filter(d => d.id !== docId);

    saveDocumentsToStorage(docs);

    if (window.deletePdfBinary) {
        deletePdfBinary(docId);
    }
    if (typeof deletePdfBinaryFromCloud === "function") {
        deletePdfBinaryFromCloud(docId);
    }

    if (docToDelete) {
        addAuditLog("PDF_DELETE", `Plano eliminado: ${docToDelete.name}`, `Eliminado por el usuario ${getCurrentUser()?.username}`);
    }

    showToast("Documento eliminado correctamente.", "info");
    renderDocumentsLibrary();
}

// DRAG & DROP PDF UPLOAD HANDLER
function setupDropzone() {
    const dropzone = document.getElementById("dropzone");
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0 && files[0].type === "application/pdf") {
            processPdfFile(files[0]);
        } else {
            showToast("Por favor sube un archivo con formato .PDF", "error");
        }
    });
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.type !== "application/pdf") {
            showToast("Solo se permiten archivos en formato PDF.", "error");
            return;
        }
        processPdfFile(file);
        // Reset file input element so selecting files again triggers change event
        event.target.value = "";
    }
}

function processPdfFile(file) {
    if (!file || file.type !== "application/pdf") {
        showToast("Por favor sube un archivo con formato .PDF", "error");
        return;
    }

    const user = getCurrentUser();
    showToast("Procesando y guardando archivo PDF...", "info");

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const arrayBuffer = e.target.result;
            const docId = "doc_" + Date.now();
            const sizeFormatted = (file.size / (1024 * 1024)).toFixed(1) + " MB";

            // Convert ArrayBuffer to Data URL for instant cross-device PDF rendering
            let pdfDataUrl = null;
            try {
                const b64 = window.arrayBufferToBase64 
                    ? window.arrayBufferToBase64(arrayBuffer)
                    : btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuffer)));
                pdfDataUrl = "data:application/pdf;base64," + b64;
            } catch (e) {
                console.warn("No se pudo generar pdfDataUrl inline:", e);
            }

            // Store raw PDF binary into IndexedDB & Cloud Storage
            if (window.savePdfBinary) {
                await window.savePdfBinary(docId, arrayBuffer);
            }
            if (typeof syncPdfBinaryToCloud === "function") {
                await syncPdfBinaryToCloud(docId, arrayBuffer);
            }

            // Generate real PDF page 1 thumbnail preview
            let thumbnailUrl = null;
            if (window.generatePdfThumbnail) {
                thumbnailUrl = await window.generatePdfThumbnail(arrayBuffer);
            }

            const newDoc = {
                id: docId,
                name: file.name,
                uploadedBy: user ? user.username : "anónimo",
                uploadedByName: user ? user.name : "Usuario",
                uploadedAt: new Date().toISOString(),
                lastEditedAt: new Date().toISOString(),
                editsCount: 0,
                fileSize: sizeFormatted,
                hasBinary: true,
                thumbnailUrl: thumbnailUrl,
                pdfDataUrl: pdfDataUrl,
                annotations: []
            };

            const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
            docs.unshift(newDoc);
            saveDocumentsToStorage(docs);

            addAuditLog("PDF_UPLOAD", `Nuevo PDF subido: ${file.name}`, `Tamaño: ${sizeFormatted} por ${user?.name || 'Usuario'}`);

            showToast("PDF subido con éxito. Abriendo editor...", "success");
            if (window.renderDocumentsLibrary) renderDocumentsLibrary();
            loadDocumentInEditor(newDoc.id);
        } catch (err) {
            console.error("Error saving PDF:", err);
            showToast("Error al guardar archivo PDF: " + err.message, "error");
        }
    };

    reader.readAsArrayBuffer(file);
}

// TOAST NOTIFICATIONS SYSTEM
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let iconName = "info";
    if (type === "success") iconName = "check-circle";
    if (type === "error") iconName = "alert-circle";
    if (type === "warning") iconName = "alert-triangle";

    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// THEME MANAGEMENT (Default to White / Light Theme)
function initTheme() {
    const savedTheme = localStorage.getItem("planos_theme") || "light";
    const body = document.body;
    const icon = document.getElementById("theme-icon");

    if (savedTheme === "dark") {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
        if (icon) icon.setAttribute("data-lucide", "moon");
    } else {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
        if (icon) icon.setAttribute("data-lucide", "sun");
    }
    if (window.lucide) lucide.createIcons();
}

function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById("theme-icon");
    if (body.classList.contains("dark-theme")) {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
        if (icon) icon.setAttribute("data-lucide", "sun");
        localStorage.setItem("planos_theme", "light");
    } else {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
        if (icon) icon.setAttribute("data-lucide", "moon");
        localStorage.setItem("planos_theme", "dark");
    }
    if (window.lucide) lucide.createIcons();
}

// GLOBAL SEARCH BAR
function handleGlobalSearch(query) {
    if (!query) return;
    const q = query.toLowerCase();

    // Check if on Admin page
    const activeView = document.querySelector(".app-view.active-view");
    if (activeView && activeView.id === "view-admin-users") {
        renderUsersTable(q);
    } else if (activeView && activeView.id === "view-documents") {
        const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
        const filtered = docs.filter(d => d.name.toLowerCase().includes(q) || d.uploadedByName.toLowerCase().includes(q));
        const container = document.getElementById("docs-container");
        container.innerHTML = "";
        filtered.forEach(doc => {
            // Render filtered doc card
        });
    }
}
