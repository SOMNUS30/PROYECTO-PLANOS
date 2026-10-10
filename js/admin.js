/* ==========================================================================
   PlanosDoc Pro - Admin User Management & Audit Log Module
   ========================================================================== */

function renderAdminDashboard() {
    renderUserStats();
    renderUsersTable();
}

function renderUserStats() {
    const users = JSON.parse(localStorage.getItem("planos_users") || "[]");
    const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
    const logs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");

    const totalUsers = users.length;
    
    // Active in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const activeUsers = users.filter(u => u.lastLogin && new Date(u.lastLogin) > sevenDaysAgo).length;

    const totalEdits = users.reduce((acc, u) => acc + (u.editsCount || 0), 0);
    const pendingInvites = logs.filter(l => l.actionType === "USER_INVITE").length;

    document.getElementById("stat-total-users").textContent = totalUsers;
    document.getElementById("stat-active-users").textContent = activeUsers;
    document.getElementById("stat-total-edits").textContent = totalEdits;
    document.getElementById("stat-pending-invites").textContent = pendingInvites;
    document.getElementById("badge-users-count").textContent = totalUsers;
}

function renderUsersTable(filterText = "") {
    const tbody = document.getElementById("users-table-body");
    if (!tbody) return;

    let users = JSON.parse(localStorage.getItem("planos_users") || "[]");

    if (filterText) {
        const query = filterText.toLowerCase();
        users = users.filter(u => u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || u.email.toLowerCase().includes(query));
    }

    tbody.innerHTML = "";

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No se encontraron usuarios.</td></tr>`;
        return;
    }

    users.forEach(user => {
        const tr = document.createElement("tr");

        const isCurrentAdmin = (user.id === getCurrentUser()?.id);
        const roleBadgeClass = user.role === "ADMIN" ? "badge-admin" : "badge-user";
        const roleText = user.role === "ADMIN" ? "ADMINISTRADOR" : "USUARIO";
        const statusBadge = user.status === "ACTIVE" ? `<span class="badge badge-success">ACTIVO</span>` : `<span class="badge badge-danger">SUSPENDIDO</span>`;

        const formattedLastLogin = formatTimeAgo(user.lastLogin);
        const formattedCreatedAt = formatDateShort(user.createdAt);

        const initial = user.name ? user.name.charAt(0).toUpperCase() : "?";
        const avatarHtml = user.avatarUrl 
            ? `<div class="avatar avatar-sm"><img src="${user.avatarUrl}" alt="${user.name}" onerror="this.onerror=null; this.parentNode.textContent='${initial}';" /></div>`
            : `<div class="avatar avatar-sm">${initial}</div>`;

        tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    ${avatarHtml}
                    <div>
                        <strong style="display:block;">${user.name}</strong>
                        <span style="font-size:0.78rem; color:var(--text-muted);">@${user.username} • ${user.email}</span>
                    </div>
                </div>
            </td>
            <td><span class="badge ${roleBadgeClass}">${roleText}</span></td>
            <td>${statusBadge}</td>
            <td style="font-size:0.82rem; color:var(--text-muted);">${formattedCreatedAt}</td>
            <td>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:500; font-size:0.85rem;">${formattedLastLogin}</span>
                    <span style="font-size:0.72rem; color:var(--text-dim);">${formatFullDate(user.lastLogin)}</span>
                </div>
            </td>
            <td style="font-weight:600; text-align:center;">${user.editsCount || 0}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-icon btn-sm btn-secondary" title="Editar Datos de Usuario" onclick="openEditUserModal('${user.id}')">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn btn-icon btn-sm btn-secondary" title="Cambiar Rol (Admin/Usuario)" onclick="toggleUserRole('${user.id}')" ${isCurrentAdmin ? 'disabled' : ''}>
                        <i data-lucide="shield"></i>
                    </button>
                    <button class="btn btn-icon btn-sm btn-secondary" title="${user.status === 'ACTIVE' ? 'Suspender Acceso' : 'Activar Acceso'}" onclick="toggleUserStatus('${user.id}')" ${isCurrentAdmin ? 'disabled' : ''}>
                        <i data-lucide="${user.status === 'ACTIVE' ? 'user-x' : 'user-check'}"></i>
                    </button>
                    <button class="btn btn-icon btn-sm btn-outline-danger" title="Eliminar Usuario" onclick="deleteUser('${user.id}')" ${isCurrentAdmin ? 'disabled' : ''}>
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
}

function filterUsersTable(val) {
    renderUsersTable(val);
}

function toggleUserRole(userId) {
    const users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");
    const u = users.find(user => user.id === userId);
    if (!u) return;

    u.role = (u.role === "ADMIN") ? "USER" : "ADMIN";
    
    if (typeof saveUsersToStorage === "function") {
        saveUsersToStorage(users);
    } else {
        localStorage.setItem("planos_users", JSON.stringify(users));
        if (typeof syncUsersToCloud === "function") syncUsersToCloud(users);
    }

    addAuditLog("USER_ROLE_CHANGE", `Rol actualizado para usuario ${u.username}`, `Nuevo rol asignado: ${u.role}`);
    showToast(`Rol de ${u.name} cambiado a ${u.role}`, "info");
    renderAdminDashboard();
}

function toggleUserStatus(userId) {
    const users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");
    const u = users.find(user => user.id === userId);
    if (!u) return;

    u.status = (u.status === "ACTIVE") ? "SUSPENDED" : "ACTIVE";
    
    if (typeof saveUsersToStorage === "function") {
        saveUsersToStorage(users);
    } else {
        localStorage.setItem("planos_users", JSON.stringify(users));
        if (typeof syncUsersToCloud === "function") syncUsersToCloud(users);
    }

    addAuditLog("USER_STATUS_CHANGE", `Estado de usuario modificado: ${u.username}`, `Estado cambiado a: ${u.status}`);
    showToast(`Usuario ${u.name} ${u.status === 'ACTIVE' ? 'activado' : 'suspendido'}`, "info");
    renderAdminDashboard();
}

function deleteUser(userId) {
    if (!confirm("¿Estás seguro de que deseas eliminar este usuario del sistema?")) return;

    let users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");
        
    const deletedUser = users.find(u => u.id === userId);
    users = users.filter(u => u.id !== userId);

    if (typeof saveUsersToStorage === "function") {
        saveUsersToStorage(users);
    } else {
        localStorage.setItem("planos_users", JSON.stringify(users));
        if (typeof syncUsersToCloud === "function") syncUsersToCloud(users);
    }

    if (deletedUser) {
        addAuditLog("USER_DELETE", `Usuario eliminado: ${deletedUser.username}`, `El usuario ${deletedUser.name} fue removido del sistema`);
    }

    showToast("Usuario eliminado correctamente.", "success");
    renderAdminDashboard();
}

function openInviteUserModal() {
    const nameEl = document.getElementById("inv-fullname");
    const usernameEl = document.getElementById("inv-username");
    const emailEl = document.getElementById("inv-email");
    const passwordEl = document.getElementById("inv-password");
    const avatarInput = document.getElementById("inv-avatar");

    if (nameEl) nameEl.value = "";
    if (usernameEl) usernameEl.value = "";
    if (emailEl) emailEl.value = "";
    if (passwordEl) passwordEl.value = "";
    if (avatarInput) avatarInput.value = "";

    document.getElementById("invite-user-modal").classList.remove("hidden");
}

function closeInviteUserModal() {
    document.getElementById("invite-user-modal").classList.add("hidden");
}

async function handleCreateUserAdmin(event) {
    event.preventDefault();

    const nameEl = document.getElementById("inv-fullname");
    const usernameEl = document.getElementById("inv-username");
    const emailEl = document.getElementById("inv-email");
    const passwordEl = document.getElementById("inv-password");
    const roleEl = document.getElementById("inv-role");
    const avatarInput = document.getElementById("inv-avatar");

    const name = nameEl.value.trim();
    const username = usernameEl.value.trim().toLowerCase();
    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    const role = roleEl.value;

    const users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");

    if (users.some(u => u.username === username || u.email === email)) {
        showToast("El usuario o correo electrónico ya existe.", "error");
        return;
    }

    let avatarUrl = "";
    if (avatarInput && avatarInput.files && avatarInput.files[0]) {
        try {
            avatarUrl = await compressImageToDataUrl(avatarInput.files[0]);
        } catch (err) {
            console.error("Error al procesar foto de perfil:", err);
        }
    }

    const newUser = {
        id: "usr_" + Date.now(),
        username: username,
        passwordHash: password,
        name: name,
        email: email,
        avatarUrl: avatarUrl,
        role: role,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        lastLogin: null,
        editsCount: 0
    };

    users.push(newUser);
    if (typeof saveUsersToStorage === "function") {
        saveUsersToStorage(users);
    } else {
        localStorage.setItem("planos_users", JSON.stringify(users));
    }

    addAuditLog("USER_INVITE", `Nuevo usuario creado por administrador`, `Usuario: ${username} (${name}) con rol ${role}`);

    // Reset input fields
    if (nameEl) nameEl.value = "";
    if (usernameEl) usernameEl.value = "";
    if (emailEl) emailEl.value = "";
    if (passwordEl) passwordEl.value = "";
    if (avatarInput) avatarInput.value = "";

    closeInviteUserModal();
    showToast(`Usuario ${name} registrado e invitado con éxito!`, "success");
    renderAdminDashboard();
}

function openEditUserModal(userId) {
    const users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");
    const u = users.find(user => user.id === userId);
    if (!u) return;

    document.getElementById("edit-user-id").value = u.id;
    document.getElementById("edit-fullname").value = u.name || "";
    document.getElementById("edit-username").value = u.username || "";
    document.getElementById("edit-email").value = u.email || "";
    document.getElementById("edit-password").value = "";
    document.getElementById("edit-role").value = u.role || "USER";
    document.getElementById("edit-status").value = u.status || "ACTIVE";

    document.getElementById("edit-user-modal").classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
}

function closeEditUserModal() {
    document.getElementById("edit-user-modal").classList.add("hidden");
}

async function handleSaveUserEditAdmin(event) {
    event.preventDefault();

    const userId = document.getElementById("edit-user-id").value;
    const name = document.getElementById("edit-fullname").value.trim();
    const username = document.getElementById("edit-username").value.trim().toLowerCase();
    const email = document.getElementById("edit-email").value.trim().toLowerCase();
    const password = document.getElementById("edit-password").value;
    const role = document.getElementById("edit-role").value;
    const status = document.getElementById("edit-status").value;

    let users = (typeof getUsersFromStorage === "function") 
        ? getUsersFromStorage() 
        : JSON.parse(localStorage.getItem("planos_users") || "[]");

    const uIndex = users.findIndex(user => user.id === userId);
    if (uIndex === -1) {
        showToast("Usuario no encontrado.", "error");
        return;
    }

    // Check collision with another user's username or email
    const existsCollision = users.some(u => u.id !== userId && (u.username.toLowerCase() === username || u.email.toLowerCase() === email));
    if (existsCollision) {
        showToast("El nombre de usuario o correo electrónico ya está en uso por otro usuario.", "error");
        return;
    }

    users[uIndex].name = name;
    users[uIndex].username = username;
    users[uIndex].email = email;
    users[uIndex].role = role;
    users[uIndex].status = status;
    if (password && password.trim() !== "") {
        users[uIndex].passwordHash = password;
    }

    if (typeof saveUsersToStorage === "function") {
        saveUsersToStorage(users);
    } else {
        localStorage.setItem("planos_users", JSON.stringify(users));
        if (typeof syncUsersToCloud === "function") syncUsersToCloud(users);
    }

    // Update active session if editing current user
    const curr = getCurrentUser();
    if (curr && curr.id === userId) {
        currentUser = users[uIndex];
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("planos_active_session", JSON.stringify(currentUser));
        }
        if (typeof updateUserUI === "function") updateUserUI();
    }

    addAuditLog("USER_EDIT", `Datos de usuario modificados por administrador`, `Usuario: ${username} (${name}) - Rol: ${role}`);

    closeEditUserModal();
    showToast(`Datos de ${name} actualizados con éxito!`, "success");
    renderAdminDashboard();
}

function clearAuditLogs() {
    if (!confirm("¿Estás seguro de que deseas eliminar todo el historial de auditoría? Esta acción no se puede deshacer.")) return;

    localStorage.setItem("planos_audit_logs", "[]");
    if (typeof syncAuditLogsToCloud === "function") {
        syncAuditLogsToCloud([]);
    }

    showToast("Historial de auditoría eliminado correctamente.", "info");
    renderAuditLogs();
}

// AUDIT LOGS TIMELINE RENDERER
function renderAuditLogs() {
    const timelineContainer = document.getElementById("audit-timeline");
    if (!timelineContainer) return;

    let logs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");

    // Filter selectors
    const userFilter = document.getElementById("audit-filter-user")?.value || "all";
    const actionFilter = document.getElementById("audit-filter-action")?.value || "all";

    // Populate user filter dropdown if empty
    const userSelect = document.getElementById("audit-filter-user");
    if (userSelect && userSelect.options.length <= 1) {
        const users = JSON.parse(localStorage.getItem("planos_users") || "[]");
        users.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.username;
            opt.textContent = `${u.name} (@${u.username})`;
            userSelect.appendChild(opt);
        });
    }

    if (userFilter !== "all") {
        logs = logs.filter(l => l.username === userFilter);
    }
    if (actionFilter !== "all") {
        logs = logs.filter(l => l.actionType === actionFilter);
    }

    timelineContainer.innerHTML = "";

    if (logs.length === 0) {
        timelineContainer.innerHTML = `<p style="text-align:center; padding:30px; color:var(--text-muted);">No hay registros de auditoría que coincidan con los filtros.</p>`;
        return;
    }

    logs.forEach(log => {
        const item = document.createElement("div");
        item.className = "audit-item";

        let icon = "activity";
        let colorClass = "var(--primary)";
        if (log.actionType === "LOGIN") { icon = "log-in"; colorClass = "#10b981"; }
        if (log.actionType === "PDF_EDIT") { icon = "edit-3"; colorClass = "#3b82f6"; }
        if (log.actionType === "PDF_UPLOAD") { icon = "upload-cloud"; colorClass = "#8b5cf6"; }
        if (log.actionType === "USER_INVITE") { icon = "user-plus"; colorClass = "#f59e0b"; }

        item.innerHTML = `
            <div class="audit-badge" style="border-color:${colorClass}; color:${colorClass};">
                <i data-lucide="${icon}"></i>
            </div>
            <div class="audit-content">
                <div class="audit-meta">
                    <span class="audit-user">@${log.username} <small style="color:var(--text-muted); font-weight:normal;">(${log.userRole})</small></span>
                    <span class="audit-time">${formatFullDate(log.timestamp)}</span>
                </div>
                <div class="audit-description">${log.description}</div>
                ${log.details ? `<div class="audit-details-tag">${log.details}</div>` : ''}
            </div>
        `;
        timelineContainer.appendChild(item);
    });

    if (window.lucide) lucide.createIcons();
}

function exportAuditLogsCSV() {
    const logs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");
    let csvContent = "data:text/csv;charset=utf-8,ID,FechaHora,Usuario,Rol,TipoAccion,Descripcion,Detalles\n";

    logs.forEach(l => {
        const row = [
            l.id,
            `"${l.timestamp}"`,
            `"${l.username}"`,
            `"${l.userRole}"`,
            `"${l.actionType}"`,
            `"${l.description.replace(/"/g, '""')}"`,
            `"${(l.details || '').replace(/"/g, '""')}"`
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Auditoria_PlanosDoc_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Historial exportado en formato CSV.", "success");
}

// Date Formatting Helpers
function formatTimeAgo(isoString) {
    if (!isoString) return "Nunca";
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return "Hace un momento";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Hace ${days} días`;
    return date.toLocaleDateString('es-ES');
}

function formatDateShort(isoString) {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatFullDate(isoString) {
    if (!isoString) return "No registrado";
    const d = new Date(isoString);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + " " + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
