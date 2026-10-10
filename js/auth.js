/* ==========================================================================
   PlanosDoc Pro - Authentication & User Session Module
   ========================================================================== */

let currentUser = null;

function getCurrentUser() {
    return currentUser;
}

function getUsersFromStorage() {
    return JSON.parse(localStorage.getItem("planos_users") || "[]");
}

function saveUsersToStorage(users) {
    localStorage.setItem("planos_users", JSON.stringify(users));
    if (typeof syncUsersToCloud === "function") syncUsersToCloud(users);
}

function addAuditLog(actionType, description, details = "") {
    const logs = JSON.parse(localStorage.getItem("planos_audit_logs") || "[]");
    const newLog = {
        id: "log_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        username: currentUser ? currentUser.username : "invitado",
        userRole: currentUser ? currentUser.role : "DESCONOCIDO",
        actionType: actionType,
        description: description,
        details: details
    };
    logs.unshift(newLog); // latest on top
    localStorage.setItem("planos_audit_logs", JSON.stringify(logs));
    if (typeof syncAuditLogsToCloud === "function") syncAuditLogsToCloud(logs);
}

function checkSessionOnLoad() {
    const savedSession = sessionStorage.getItem("planos_active_session");
    if (savedSession) {
        try {
            const user = JSON.parse(savedSession);
            // Verify user still exists and is active
            const users = getUsersFromStorage();
            const validUser = users.find(u => u.id === user.id && u.status === "ACTIVE");
            if (validUser) {
                currentUser = validUser;
                closeAuthModal();
                updateUserUI();
                return;
            }
        } catch (e) {
            console.error("Error restoration session", e);
        }
    }
    // Clear old persistent sessions and demand login credentials
    localStorage.removeItem("planos_active_session");
    sessionStorage.removeItem("planos_active_session");
    currentUser = null;
    openAuthModal();
}

function openAuthModal() {
    document.getElementById("auth-modal").classList.remove("hidden");
}

function closeAuthModal() {
    document.getElementById("auth-modal").classList.add("hidden");
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById("login-form");
    const regForm = document.getElementById("register-form");
    const loginBtn = document.getElementById("tab-login-btn");
    const regBtn = document.getElementById("tab-register-btn");

    if (tab === 'login' || !regForm) {
        if (loginForm) loginForm.classList.add("active-form");
        if (regForm) regForm.classList.remove("active-form");
        if (loginBtn) loginBtn.classList.add("active");
        if (regBtn) regBtn.classList.remove("active");
    } else {
        if (regForm) regForm.classList.add("active-form");
        if (loginForm) loginForm.classList.remove("active-form");
        if (regBtn) regBtn.classList.add("active");
        if (loginBtn) loginBtn.classList.remove("active");
    }
    hideAuthAlert();
}

function showAuthAlert(msg, type = "error") {
    const alertBox = document.getElementById("auth-alert");
    alertBox.textContent = msg;
    alertBox.className = `alert-box alert-${type}`;
    alertBox.classList.remove("hidden");
}

function hideAuthAlert() {
    document.getElementById("auth-alert").classList.add("hidden");
}

async function handleLogin(event) {
    event.preventDefault();
    hideAuthAlert();

    const usernameInput = document.getElementById("login-username").value.trim().toLowerCase();
    const passwordInput = document.getElementById("login-password").value;

    let users = getUsersFromStorage();
    let user = users.find(u => (u.username.toLowerCase() === usernameInput || u.email.toLowerCase() === usernameInput) && u.passwordHash === passwordInput);

    // If user not found in local memory, Render server might be waking up from sleep; force sync & re-check!
    if (!user && typeof fetchCloudData === "function") {
        showToast("Verificando credenciales con el servidor en la nube...", "info");
        await fetchCloudData();
        users = getUsersFromStorage();
        user = users.find(u => (u.username.toLowerCase() === usernameInput || u.email.toLowerCase() === usernameInput) && u.passwordHash === passwordInput);
    }

    if (!user) {
        showAuthAlert("Usuario o contraseña incorrectos. Por favor intenta nuevamente.");
        return;
    }

    if (user.status === "SUSPENDED") {
        showAuthAlert("Tu cuenta ha sido suspendida por el administrador.");
        return;
    }

    // Update lastLogin timestamp & save
    user.lastLogin = new Date().toISOString();
    saveUsersToStorage(users);

    // Set Active Session (Session-scoped for security)
    currentUser = user;
    sessionStorage.setItem("planos_active_session", JSON.stringify(user));
    localStorage.removeItem("planos_active_session");

    // Audit Log
    addAuditLog("LOGIN", "Conexión / Inicio de Sesión exitoso", `Usuario ${user.name} (${user.role}) inició sesión`);

    closeAuthModal();
    updateUserUI();
    showToast(`Bienvenido de nuevo, ${user.name}!`, "success");
}

// Helper to safely render avatar image or initial letter
function renderAvatarHtml(containerEl, user) {
    if (!containerEl) return;
    const initial = (user && user.name) ? user.name.charAt(0).toUpperCase() : "?";
    if (user && user.avatarUrl) {
        containerEl.innerHTML = `<img src="${user.avatarUrl}" alt="${user.name || 'Avatar'}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" onerror="this.onerror=null; this.parentNode.textContent='${initial}';" />`;
    } else {
        containerEl.textContent = initial;
    }
}

// Compress profile picture image to Data URL with canvas optimization & raw format fallback
function compressImageToDataUrl(file, maxWidth = 160, maxHeight = 160) {
    return new Promise((resolve) => {
        if (!file) {
            resolve(null);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const rawDataUrl = e.target.result;
            if (!rawDataUrl) {
                resolve(null);
                return;
            }

            // Attempt canvas compression for high-res raster images
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    const minDim = Math.min(img.width, img.height);
                    const sx = (img.width - minDim) / 2;
                    const sy = (img.height - minDim) / 2;

                    canvas.width = maxWidth;
                    canvas.height = maxHeight;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxWidth, maxHeight);
                    const compressed = canvas.toDataURL("image/jpeg", 0.85);
                    resolve(compressed || rawDataUrl);
                } catch (err) {
                    resolve(rawDataUrl);
                }
            };
            img.onerror = () => {
                // Resolve raw Data URL if HTML Image loading fails (SVG, unsupported format, etc.)
                resolve(rawDataUrl);
            };
            img.src = rawDataUrl;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

async function handleRegister(event) {
    event.preventDefault();
    hideAuthAlert();

    const name = document.getElementById("reg-name").value.trim();
    const username = document.getElementById("reg-username").value.trim().toLowerCase();
    const email = document.getElementById("reg-email").value.trim().toLowerCase();
    const password = document.getElementById("reg-password").value;
    const inviteCode = document.getElementById("reg-invite-code").value.trim();
    const avatarInput = document.getElementById("reg-avatar");

    const users = getUsersFromStorage();

    // Check unique username or email
    if (users.some(u => u.username.toLowerCase() === username)) {
        showAuthAlert("El nombre de usuario ya está registrado.");
        return;
    }

    if (users.some(u => u.email.toLowerCase() === email)) {
        showAuthAlert("El correo electrónico ya está registrado.");
        return;
    }

    // Role selection based on invite code or default
    let assignedRole = "USER";
    if (inviteCode === "ADMIN-SUPER-2026") {
        assignedRole = "ADMIN";
    }

    let avatarUrl = null;
    if (avatarInput && avatarInput.files && avatarInput.files[0]) {
        avatarUrl = await compressImageToDataUrl(avatarInput.files[0]);
    }

    const newUser = {
        id: "usr_" + Date.now(),
        username: username,
        passwordHash: password,
        name: name,
        email: email,
        role: assignedRole,
        status: "ACTIVE",
        avatarUrl: avatarUrl,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        editsCount: 0
    };

    users.push(newUser);
    saveUsersToStorage(users);

    // Set Active Session
    currentUser = newUser;
    localStorage.setItem("planos_active_session", JSON.stringify(newUser));

    addAuditLog("REGISTER", "Registro de nuevo usuario", `Se registró ${name} (${username}) con rol ${assignedRole}`);

    // Reset input fields
    const nameInput = document.getElementById("reg-name");
    const usernameInputEl = document.getElementById("reg-username");
    const emailInputEl = document.getElementById("reg-email");
    const passwordInputEl = document.getElementById("reg-password");
    const inviteCodeEl = document.getElementById("reg-invite-code");
    
    if (nameInput) nameInput.value = "";
    if (usernameInputEl) usernameInputEl.value = "";
    if (emailInputEl) emailInputEl.value = "";
    if (passwordInputEl) passwordInputEl.value = "";
    if (inviteCodeEl) inviteCodeEl.value = "";
    if (avatarInput) avatarInput.value = "";

    closeAuthModal();
    updateUserUI();
    showToast(`¡Cuenta creada con éxito! Bienvenido, ${name}`, "success");
}

function fillDemoCredentials(username, password) {
    switchAuthTab('login');
    document.getElementById("login-username").value = username;
    document.getElementById("login-password").value = password;
    document.getElementById("login-form").dispatchEvent(new Event('submit'));
}

function handleLogout() {
    if (currentUser) {
        addAuditLog("LOGOUT", "Cierre de sesión de usuario", `Usuario ${currentUser.username} cerró sesión`);
    }
    currentUser = null;
    sessionStorage.removeItem("planos_active_session");
    localStorage.removeItem("planos_active_session");
    openAuthModal();
    showToast("Sesión cerrada correctamente.", "info");
}

function updateUserUI() {
    if (!currentUser) return;

    const sidebarAvatar = document.getElementById("sidebar-avatar");
    const navAvatar = document.getElementById("nav-avatar");

    renderAvatarHtml(sidebarAvatar, currentUser);
    renderAvatarHtml(navAvatar, currentUser);

    if (sidebarAvatar) {
        sidebarAvatar.style.cursor = "pointer";
        sidebarAvatar.title = "Ver mi Perfil de Usuario";
        sidebarAvatar.onclick = openUserProfileModal;
    }

    const sidebarCard = document.querySelector(".user-card-small");
    if (sidebarCard) {
        sidebarCard.style.cursor = "pointer";
        sidebarCard.title = "Ver mi Perfil de Usuario";
        sidebarCard.onclick = openUserProfileModal;
    }

    document.getElementById("sidebar-username").textContent = currentUser.name;
    document.getElementById("nav-username").textContent = currentUser.username;

    const roleBadge = document.getElementById("sidebar-userrole");
    if (currentUser.role === "ADMIN") {
        roleBadge.textContent = "ADMINISTRADOR";
        roleBadge.className = "user-role badge badge-admin";
        document.querySelectorAll(".admin-only").forEach(el => el.style.display = "flex");
        document.querySelectorAll(".admin-only-section").forEach(el => el.style.display = "block");
    } else {
        roleBadge.textContent = "USUARIO ESTÁNDAR";
        roleBadge.className = "user-role badge badge-user";
        document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
        document.querySelectorAll(".admin-only-section").forEach(el => el.style.display = "none");
        
        // If non-admin is currently on admin tab, switch to documents
        const currentActiveView = document.querySelector(".app-view.active-view");
        if (currentActiveView && (currentActiveView.id === "view-admin-users" || currentActiveView.id === "view-admin-audit")) {
            navigateTo('documents');
        }
    }

    if (window.renderDocumentsLibrary) window.renderDocumentsLibrary();
    if (window.renderAdminDashboard) window.renderAdminDashboard();
    if (window.renderAuditLogs) window.renderAuditLogs();
}

// USER PROFILE MODAL HANDLERS
function openUserProfileModal() {
    if (!currentUser) return;
    const modal = document.getElementById("user-profile-modal");
    if (!modal) return;

    const modalAvatar = document.getElementById("profile-modal-avatar");
    renderAvatarHtml(modalAvatar, currentUser);

    document.getElementById("profile-modal-name").textContent = currentUser.name;
    document.getElementById("profile-modal-username").textContent = "@" + currentUser.username;
    document.getElementById("profile-modal-email").textContent = currentUser.email;
    document.getElementById("profile-modal-created").textContent = (typeof formatDateShort === 'function') ? formatDateShort(currentUser.createdAt) : currentUser.createdAt;
    document.getElementById("profile-modal-edits").textContent = currentUser.editsCount || 0;

    const roleEl = document.getElementById("profile-modal-role");
    if (roleEl) {
        roleEl.textContent = currentUser.role === "ADMIN" ? "ADMINISTRADOR" : "USUARIO ESTÁNDAR";
        roleEl.className = currentUser.role === "ADMIN" ? "badge badge-admin" : "badge badge-user";
    }

    const statusEl = document.getElementById("profile-modal-status");
    if (statusEl) {
        statusEl.textContent = currentUser.status === "ACTIVE" ? "ACTIVO" : "SUSPENDIDO";
        statusEl.className = currentUser.status === "ACTIVE" ? "badge badge-success" : "badge badge-danger";
    }

    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
}

const toggleUserMenu = openUserProfileModal;

function closeUserProfileModal() {
    const modal = document.getElementById("user-profile-modal");
    if (modal) modal.classList.add("hidden");
}

function triggerAvatarFileInput() {
    const input = document.getElementById("change-avatar-input");
    if (input) input.click();
}

// QUICK AVATAR UPDATE HANDLER
async function handleUserAvatarChange(event) {
    const file = event.target.files[0];
    if (!file || !currentUser) return;

    showToast("Actualizando foto de perfil...", "info");
    const avatarUrl = await compressImageToDataUrl(file);

    if (avatarUrl) {
        currentUser.avatarUrl = avatarUrl;

        // Update in planos_users storage
        const users = getUsersFromStorage();
        const uIdx = users.findIndex(u => u.id === currentUser.id);
        if (uIdx !== -1) {
            users[uIdx].avatarUrl = avatarUrl;
            saveUsersToStorage(users);
        }

        // Update active session
        sessionStorage.setItem("planos_active_session", JSON.stringify(currentUser));
        localStorage.removeItem("planos_active_session");

        updateUserUI();

        // Refresh profile modal if open
        const profileModal = document.getElementById("user-profile-modal");
        if (profileModal && !profileModal.classList.contains("hidden")) {
            openUserProfileModal();
        }

        showToast("¡Foto de perfil actualizada con éxito!", "success");
    } else {
        showToast("Error al procesar la imagen seleccionada.", "error");
    }
    event.target.value = "";
}
