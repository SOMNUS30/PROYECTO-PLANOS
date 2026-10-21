/* ==========================================================================
   ECOSOL PLANOS - PWA Desktop Installation Handler
   ========================================================================== */

let deferredInstallPrompt = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(reg => {
                console.log('✅ PWA Service Worker registrado con éxito en el ámbito:', reg.scope);
            })
            .catch(err => {
                console.warn('⚠️ Error al registrar Service Worker PWA:', err);
            });
    });
}

// Check if currently running as an installed standalone app
function isRunningStandalone() {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://')
    );
}

// Handle PWA Install Prompt Event
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar or auto prompt
    e.preventDefault();
    deferredInstallPrompt = e;
    window.deferredInstallPrompt = e;
    console.log('💡 Evento beforeinstallprompt capturado. Mostrando opción de instalación.');

    // If already in standalone mode, do not show button
    if (isRunningStandalone()) {
        hideInstallButtons();
        return;
    }

    // Display the install buttons in Top Navbar & Sidebar
    showInstallButtons();
    if (window.lucide) lucide.createIcons();
});

// App installed successfully
window.addEventListener('appinstalled', (evt) => {
    console.log('🎉 ECOSOL PLANOS ha sido instalado como aplicación de escritorio.');
    deferredInstallPrompt = null;
    hideInstallButtons();
    if (typeof showToast === 'function') {
        showToast('¡ECOSOL PLANOS se instaló correctamente en tu PC!', 'success');
    }
});

function showInstallButtons() {
    const navBtn = document.getElementById('btn-install-pwa');
    const sidebarBtn = document.getElementById('sidebar-install-pwa');
    if (navBtn) navBtn.style.display = 'inline-flex';
    if (sidebarBtn) sidebarBtn.style.display = 'flex';
}

function hideInstallButtons() {
    const navBtn = document.getElementById('btn-install-pwa');
    const sidebarBtn = document.getElementById('sidebar-install-pwa');
    if (navBtn) navBtn.style.display = 'none';
    if (sidebarBtn) sidebarBtn.style.display = 'none';
}

// Trigger installation flow
async function installPwaApp() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
            console.log('El usuario aceptó la instalación de la app');
            if (typeof showToast === 'function') {
                showToast('Instalando ECOSOL PLANOS en tu PC...', 'info');
            }
        } else {
            console.log('El usuario canceló la instalación');
        }
        deferredInstallPrompt = null;
        hideInstallButtons();
    } else {
        // Fallback: If browser already displays the icon in the address bar (Chrome/Edge), show guidance modal
        openInstallHelpModal();
    }
}
window.installPwaApp = installPwaApp;

function openInstallHelpModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) {
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    } else {
        alert("Para instalar en tu PC:\n\n1. Haz clic en el ícono de pantalla con flecha (Instalar) ubicado a la derecha de la barra de direcciones de tu navegador.\n2. O haz clic en el menú del navegador (tres puntos ⋮) y selecciona 'Instalar ECOSOL PLANOS'.");
    }
}
window.openInstallHelpModal = openInstallHelpModal;

function closeInstallHelpModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}
window.closeInstallHelpModal = closeInstallHelpModal;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    if (isRunningStandalone()) {
        hideInstallButtons();
    } else {
        // Show install button so user always has access to install or instructions
        showInstallButtons();
    }
});
