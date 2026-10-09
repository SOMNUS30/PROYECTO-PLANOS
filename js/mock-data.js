/* ==========================================================================
   PlanosDoc Pro - Seed Mock Data & Local Storage Initializer
   ========================================================================== */

const INITIAL_USERS = [
    {
        id: "usr_admin_01",
        username: "admin",
        passwordHash: "admin123", // In a real backend this is hashed
        name: "Administrador General",
        email: "admin@planosdoc.com",
        role: "ADMIN", // ADMIN or USER
        status: "ACTIVE", // ACTIVE or SUSPENDED
        createdAt: "2026-09-01T10:00:00Z",
        lastLogin: new Date().toISOString(),
        editsCount: 14
    },
    {
        id: "usr_user_02",
        username: "usuario1",
        passwordHash: "user123",
        name: "Arq. Carlos Mendoza",
        email: "carlos@arquitectura.com",
        role: "USER",
        status: "ACTIVE",
        createdAt: "2026-09-15T14:30:00Z",
        lastLogin: new Date(Date.now() - 3600000 * 4).toISOString(), // 4 hours ago
        editsCount: 8
    },
    {
        id: "usr_user_03",
        username: "maria_ing",
        passwordHash: "user123",
        name: "Ing. María Fernández",
        email: "maria.ing@estructuras.pe",
        role: "USER",
        status: "ACTIVE",
        createdAt: "2026-09-20T09:15:00Z",
        lastLogin: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
        editsCount: 22
    }
];

const INITIAL_DOCUMENTS = [
    {
        id: "doc_plano_01",
        name: "Plano_Arquitectonico_Nivel1.pdf",
        uploadedBy: "admin",
        uploadedByName: "Administrador General",
        uploadedAt: "2026-10-01T08:30:00Z",
        lastEditedAt: "2026-10-07T16:20:00Z",
        editsCount: 5,
        fileSize: "2.4 MB",
        // Preset sample PDF base64 or inline preview SVG canvas data
        sampleType: "blueprint-arch",
        annotations: [
            {
                id: "ann_1",
                type: "rect",
                page: 1,
                x: 120,
                y: 100,
                width: 180,
                height: 110,
                color: "#ef4444",
                fillColor: "rgba(239, 68, 68, 0.2)",
                strokeWidth: 3,
                label: "Zona de Expansión"
            },
            {
                id: "ann_2",
                type: "stamp",
                page: 1,
                x: 350,
                y: 80,
                text: "APROBADO",
                color: "#10b981"
            },
            {
                id: "ann_3",
                type: "text",
                page: 1,
                x: 130,
                y: 220,
                text: "⚠️ Verificar columnas estructurales",
                color: "#f59e0b",
                fontSize: 16
            }
        ]
    },
    {
        id: "doc_plano_02",
        name: "Plano_Instalaciones_Electricas.pdf",
        uploadedBy: "maria_ing",
        uploadedByName: "Ing. María Fernández",
        uploadedAt: "2026-10-03T11:45:00Z",
        lastEditedAt: "2026-10-06T14:10:00Z",
        editsCount: 12,
        fileSize: "3.8 MB",
        sampleType: "blueprint-elec",
        annotations: [
            {
                id: "ann_4",
                type: "circle",
                page: 1,
                x: 240,
                y: 180,
                radius: 45,
                color: "#3b82f6",
                fillColor: "rgba(59, 130, 246, 0.25)",
                strokeWidth: 3
            },
            {
                id: "ann_5",
                type: "stamp",
                page: 1,
                x: 400,
                y: 50,
                text: "REVISAR",
                color: "#f59e0b"
            }
        ]
    },
    {
        id: "doc_plano_03",
        name: "Detalle_Estructura_Cimentaciones.pdf",
        uploadedBy: "usuario1",
        uploadedByName: "Arq. Carlos Mendoza",
        uploadedAt: "2026-10-05T09:10:00Z",
        lastEditedAt: "2026-10-05T09:10:00Z",
        editsCount: 0,
        fileSize: "1.9 MB",
        sampleType: "blueprint-struct",
        annotations: []
    }
];

const INITIAL_AUDIT_LOGS = [
    {
        id: "log_01",
        timestamp: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
        username: "admin",
        userRole: "ADMIN",
        actionType: "LOGIN",
        description: "Inicio de sesión exitoso en el sistema",
        details: "IP: 192.168.1.45 - Navegador Chrome"
    },
    {
        id: "log_02",
        timestamp: new Date(Date.now() - 3600000 * 20).toISOString(),
        username: "maria_ing",
        userRole: "USER",
        actionType: "PDF_EDIT",
        description: "Modificación de plano: Plano_Instalaciones_Electricas.pdf",
        details: "Insertadas 3 formas de color azul y 1 sello 'REVISAR'"
    },
    {
        id: "log_03",
        timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
        username: "admin",
        userRole: "ADMIN",
        actionType: "USER_INVITE",
        description: "Invitación generada para nuevo usuario",
        details: "Código: INV-8842 para rol USUARIO"
    },
    {
        id: "log_04",
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        username: "usuario1",
        userRole: "USER",
        actionType: "LOGIN",
        description: "Inicio de sesión exitoso",
        details: "IP: 192.168.1.89"
    }
];

// Document storage helper with cloud sync
function saveDocumentsToStorage(docs) {
    localStorage.setItem("planos_documents", JSON.stringify(docs));
    if (typeof syncDocumentsToCloud === "function") syncDocumentsToCloud(docs);
}

// Initialize Storage Helper
function initLocalStorage() {
    if (!localStorage.getItem("planos_users")) {
        localStorage.setItem("planos_users", JSON.stringify(INITIAL_USERS));
    }
    if (!localStorage.getItem("planos_documents")) {
        localStorage.setItem("planos_documents", JSON.stringify(INITIAL_DOCUMENTS));
    }
    if (!localStorage.getItem("planos_audit_logs")) {
        localStorage.setItem("planos_audit_logs", JSON.stringify(INITIAL_AUDIT_LOGS));
    }
}

initLocalStorage();
